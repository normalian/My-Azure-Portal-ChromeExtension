'use strict';

const subscriptionIDs = [];
const ARM_SCOPE = 'https://management.azure.com/user_impersonation';
const AUTH_ALARM_NAME = 'refresh-arm-token';
const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000;

console.log('[Azure Portal Extention] start background.js');

chrome.runtime.onInstalled.addListener(() => {
    initializeTokenRefreshAlarm();
});

chrome.runtime.onStartup.addListener(() => {
    initializeTokenRefreshAlarm();
});

function storageGet(area, keys) {
    return new Promise((resolve) => chrome.storage[area].get(keys, resolve));
}

function storageSet(area, values) {
    return new Promise((resolve) => chrome.storage[area].set(values, resolve));
}

function storageRemove(area, keys) {
    return new Promise((resolve) => chrome.storage[area].remove(keys, resolve));
}

async function getOAuthConfig() {
    const config = await storageGet('local', {
        oauthTenantId: 'organizations',
        oauthClientId: ''
    });

    return {
        tenantId: (config.oauthTenantId || 'organizations').trim(),
        clientId: (config.oauthClientId || '').trim()
    };
}

function ensureOAuthConfig(config) {
    if (!config.clientId) {
        throw new Error('Entra ID Client ID is not set. Please enter it in the extension settings.');
    }
    if (!config.tenantId) {
        throw new Error('Entra ID Tenant ID is not set. Please enter it in the extension settings.');
    }
}

function getRedirectUri() {
    return chrome.identity.getRedirectURL();
}

function base64UrlEncode(bytes) {
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function createRandomString(length = 64) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const random = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(random, (v) => chars[v % chars.length]).join('');
}

async function createCodeChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64UrlEncode(new Uint8Array(digest));
}

function buildAuthorizeUrl(config, codeChallenge) {
    const authorizeUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/authorize`);
    authorizeUrl.searchParams.set('client_id', config.clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', getRedirectUri());
    authorizeUrl.searchParams.set('response_mode', 'query');
    authorizeUrl.searchParams.set('scope', `openid profile offline_access ${ARM_SCOPE}`);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('prompt', 'select_account');
    return authorizeUrl.toString();
}

async function exchangeAuthorizationCode(config, code, codeVerifier) {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: getRedirectUri(),
        scope: `openid profile offline_access ${ARM_SCOPE}`,
        code_verifier: codeVerifier
    });

    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });

    const payload = await res.json();
    if (!res.ok || payload.error) {
        throw new Error(payload.error_description || payload.error || 'Failed to acquire token.');
    }
    return payload;
}

async function refreshAccessToken(config, refreshToken) {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: `openid profile offline_access ${ARM_SCOPE}`,
        redirect_uri: getRedirectUri()
    });

    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });

    const payload = await res.json();
    if (!res.ok || payload.error) {
        throw new Error(payload.error_description || payload.error || 'Failed to refresh token.');
    }
    return payload;
}

async function saveTokenPayload(payload) {
    const expiresAt = Date.now() + (Number(payload.expires_in) * 1000);
    const tokenCache = {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresAt,
        scope: payload.scope,
        tokenType: payload.token_type || 'Bearer'
    };
    await storageSet('local', { oauthTokenCache: tokenCache });
    scheduleTokenRefresh(expiresAt);
    return tokenCache;
}

function scheduleTokenRefresh(expiresAt) {
    const refreshAt = Math.max(Date.now() + 60 * 1000, expiresAt - TOKEN_SAFETY_WINDOW_MS);
    chrome.alarms.create(AUTH_ALARM_NAME, { when: refreshAt });
}

async function clearTokenCache() {
    await storageRemove('local', ['oauthTokenCache']);
    await chrome.alarms.clear(AUTH_ALARM_NAME);
}

function parseAuthResponse(redirectedTo) {
    const redirectedUrl = new URL(redirectedTo);
    const authCode = redirectedUrl.searchParams.get('code');
    const authError = redirectedUrl.searchParams.get('error');
    const authErrorDescription = redirectedUrl.searchParams.get('error_description');

    if (authError) {
        throw new Error(authErrorDescription || authError);
    }

    if (!authCode) {
        throw new Error('Authorization code could not be obtained.');
    }
    return authCode;
}

async function loginInteractiveAndCacheToken() {
    const config = await getOAuthConfig();
    ensureOAuthConfig(config);

    const codeVerifier = createRandomString(96);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const authUrl = buildAuthorizeUrl(config, codeChallenge);

    const redirectedTo = await chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
    });

    if (!redirectedTo) {
        throw new Error('Sign-in was canceled or interrupted.');
    }

    const code = parseAuthResponse(redirectedTo);
    const tokenPayload = await exchangeAuthorizationCode(config, code, codeVerifier);
    const tokenCache = await saveTokenPayload(tokenPayload);
    return tokenCache.accessToken;
}

async function acquireAccessToken({ interactiveFallback }) {
    const { oauthTokenCache } = await storageGet('local', { oauthTokenCache: null });
    const config = await getOAuthConfig();
    ensureOAuthConfig(config);

    if (oauthTokenCache?.accessToken && oauthTokenCache?.expiresAt && (oauthTokenCache.expiresAt - Date.now()) > TOKEN_SAFETY_WINDOW_MS) {
        return oauthTokenCache.accessToken;
    }

    if (oauthTokenCache?.refreshToken) {
        try {
            const refreshed = await refreshAccessToken(config, oauthTokenCache.refreshToken);
            const tokenCache = await saveTokenPayload(refreshed);
            return tokenCache.accessToken;
        } catch (error) {
            console.warn('[Azure Portal Extention] refresh token failed:', error);
            await clearTokenCache();
        }
    }

    if (interactiveFallback) {
        return loginInteractiveAndCacheToken();
    }

    throw new Error('No access token is available. Please sign in from the extension popup.');
}

async function initializeTokenRefreshAlarm() {
    const { oauthTokenCache } = await storageGet('local', { oauthTokenCache: null });
    if (oauthTokenCache?.expiresAt) {
        scheduleTokenRefresh(oauthTokenCache.expiresAt);
    }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== AUTH_ALARM_NAME) {
        return;
    }

    try {
        await acquireAccessToken({ interactiveFallback: false });
    } catch (error) {
        console.warn('[Azure Portal Extention] silent token refresh failed:', error);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message?.name === 'oauth-config-get') {
            const config = await getOAuthConfig();
            sendResponse({ ok: true, config });
            return;
        }

        if (message?.name === 'oauth-config-set') {
            await storageSet('local', {
                oauthTenantId: (message.tenantId || '').trim(),
                oauthClientId: (message.clientId || '').trim()
            });
            sendResponse({ ok: true });
            return;
        }

        if (message?.name === 'auth-login') {
            const accessToken = await loginInteractiveAndCacheToken();
            sendResponse({ ok: true, accessToken });
            return;
        }

        if (message?.name === 'auth-logout') {
            await clearTokenCache();
            sendResponse({ ok: true });
            return;
        }

        if (message?.name === 'auth-status') {
            const { oauthTokenCache } = await storageGet('local', { oauthTokenCache: null });
            const config = await getOAuthConfig();
            const now = Date.now();

            sendResponse({
                ok: true,
                signedIn: Boolean(oauthTokenCache?.accessToken && oauthTokenCache?.expiresAt > now),
                expiresAt: oauthTokenCache?.expiresAt || null,
                tenantId: config.tenantId,
                clientId: config.clientId
            });
            return;
        }

        sendResponse({ ok: false, error: 'unsupported-message' });
    })().catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
    });

    return true;
});

// return subscriptionList to scripts.js
chrome.runtime.onConnect.addListener( port => {
	console.log('[Azure Portal Extention] background.js#addListener: ' + port.name);
	port.onMessage.addListener( async arg => {
        try {
            if( arg.name == "get-subscriptions-accesstoken" ){
                const token = await acquireAccessToken({ interactiveFallback: false });
                subscriptionIDs.length = 0;
                var res = await fetch( "https://management.azure.com/subscriptions?api-version=2022-12-01", {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ` + token,
                        'Content-Type': 'application/json'
                    },
                });
                	var idArray = await res.json();

                	if( idArray.error){
                    	console.log( idArray.error ); //TODO: Need to update to notify users this error
                    	port.postMessage( {
                        	name: "get-access-function",
                        	error: idArray.error
                    	});
                    	return false;
                	}else{
                    	//console.log(subscriptionIds);
                    	for( var i=0; i<idArray.value.length ; i++){
                            // example of each subscriptionID item
                            // {
                            //     "id": "/subscriptions/xxxxxxxx-xxxx-xxxx-xxxx-9c21fc881226",
                            //     "authorizationSource": "RoleBased",
                            //     "managedByTenants": [],
                            //     "subscriptionId": "xxxxxxxx-xxxx-xxxx-xxxx-9c21fc881226",
                            //     "tenantId": "b7501d50-50bf-4080-bfaa-912394380b1a",
                            //     "displayName": "Microsoft Azure Enterprise",
                            //     "state": "Enabled",
                            //     "subscriptionPolicies": {
                            //         "locationPlacementId": "Public_2014-09-01",
                            //         "quotaId": "EnterpriseAgreement_2014-09-01",
                            //         "spendingLimit": "Off"
                            //     }
                            // }
                            	subscriptionIDs.push(idArray.value[i].subscriptionId);
                    	}
                    	port.postMessage( {
                        	name: "get-access-function",
                        	subscriptions: idArray.value
                    	});
                	}
                	return true;
            }

            if( arg.name=="get-empty-resourcegroups"){
                const token = await acquireAccessToken({ interactiveFallback: false });
                // console.log("################################# get-empty-resourcegroups");
                // REST API call to get empty resource grups with subscription name
                var data = {
                    "subscriptions" :subscriptionIDs,
                    "query" : "ResourceContainers | where type == 'microsoft.resources/subscriptions/resourcegroups' | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | join kind=leftouter (Resources | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | summarize count() by rgAndSub ) on rgAndSub | where isnull(count_) | project-away rgAndSub1, count_ | join kind=leftouter (ResourceContainers | where type=='microsoft.resources/subscriptions' | project subscriptionName=name, subscriptionId) on subscriptionId | project-away subscriptionId1"
                };

                var res = await fetch('https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ` + token,
                        'Content-Type': 'application/json'
                    },
                    dataType: 'json',
                    body : JSON.stringify(data) // required to pass parameters as json body
                });
                	var rgArray = await res.json();
                	port.postMessage( {
                    	name : "get-empty-resourcegroups",
                    	emptyResourcegroups: rgArray
                	});
                return true;
            }
        } catch (error) {
            port.postMessage({
                name: 'get-access-function',
                error: error.message || String(error)
            });
        }
	});
});