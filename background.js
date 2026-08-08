'use strict';
const subscriptionIds = [];
let subscriptions = [];
const ARM_SCOPE = 'https://management.azure.com/user_impersonation';
const GRAPH_SCOPE = 'https://graph.microsoft.com/User.ReadBasic.All';
const GRAPH_TOKEN_CACHE_KEY = 'graphOAuthTokenCache';
const AUTH_ALARM_NAME = 'refresh-arm-token';
const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000;
const TELEMETRY_ALARM_NAME = 'telemetry-daily-upload';
const TELEMETRY_BUFFER_KEY = 'telemetryEventBuffer';
const TELEMETRY_SETTINGS_KEY = 'telemetrySettings';
const TELEMETRY_OPT_IN_KEY = 'telemetryOptIn';
const FEATURE_LAST_USED_AT_KEY = 'featureLastUsedAt';
const FEATURE_LAST_USED_KEY = 'featureLastUsed';
const MAX_TELEMETRY_BUFFER_SIZE = 300;
const TELEMETRY_CONNECTION_STRING_PLACEHOLDER = '__APPINSIGHTS_CONNECTION_STRING__';
const TELEMETRY_FIXED_CONNECTION_STRING = TELEMETRY_CONNECTION_STRING_PLACEHOLDER;
console.log('[Azure Portal Extension] start background.js');
chrome.runtime.onInstalled.addListener(async (details) => {
    initializeTokenRefreshAlarm();
    await initializeTelemetrySettings(details);
    await initializeTelemetryAlarm();
});
chrome.runtime.onStartup.addListener(async () => {
    initializeTokenRefreshAlarm();
    await initializeTelemetryAlarm();
    await registerStartupGapTelemetry();
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
async function getTelemetrySettings() {
    const defaults = {
        enabled: false,
        appInsightsConnectionString: TELEMETRY_FIXED_CONNECTION_STRING
    };
    const result = await storageGet('local', {
        [TELEMETRY_SETTINGS_KEY]: defaults,
        [TELEMETRY_OPT_IN_KEY]: false
    });
    const settings = result[TELEMETRY_SETTINGS_KEY] || defaults;
    const enabled = Boolean(result[TELEMETRY_OPT_IN_KEY] || settings.enabled);
    const appInsightsConnectionString = TELEMETRY_FIXED_CONNECTION_STRING;
    return {
        enabled,
        appInsightsConnectionString
    };
}
async function setTelemetrySettings(input) {
    const enabled = Boolean(input?.enabled);
    await storageSet('local', {
        [TELEMETRY_OPT_IN_KEY]: enabled,
        [TELEMETRY_SETTINGS_KEY]: {
            enabled,
            appInsightsConnectionString: TELEMETRY_FIXED_CONNECTION_STRING
        }
    });
    if (!enabled) {
        await storageSet('local', {
            [TELEMETRY_BUFFER_KEY]: []
        });
    }
}
async function initializeTelemetrySettings(details) {
    const current = await storageGet('local', {
        [TELEMETRY_SETTINGS_KEY]: null,
        [TELEMETRY_OPT_IN_KEY]: null
    });
    if (current[TELEMETRY_SETTINGS_KEY] === null || current[TELEMETRY_OPT_IN_KEY] === null) {
        await storageSet('local', {
            [TELEMETRY_OPT_IN_KEY]: false,
            [TELEMETRY_SETTINGS_KEY]: {
                enabled: false,
                appInsightsConnectionString: TELEMETRY_FIXED_CONNECTION_STRING
            }
        });
    }
    if (details?.reason === 'install') {
        await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    }
}
async function initializeTelemetryAlarm() {
    const alarm = await chrome.alarms.get(TELEMETRY_ALARM_NAME);
    if (!alarm) {
        chrome.alarms.create(TELEMETRY_ALARM_NAME, { periodInMinutes: 1440 });
    }
}
function parseConnectionString(connectionString) {
    const map = {};
    connectionString.split(';').forEach((part) => {
        const pair = part.split('=');
        if (pair.length >= 2) {
            const key = pair[0].trim().toLowerCase();
            const value = pair.slice(1).join('=').trim();
            map[key] = value;
        }
    });
    return {
        instrumentationKey: map.instrumentationkey || '',
        ingestionEndpoint: map.ingestionendpoint || 'https://dc.services.visualstudio.com/'
    };
}
function getTelemetryEndpoint(ingestionEndpoint) {
    const endpoint = (ingestionEndpoint || 'https://dc.services.visualstudio.com/').replace(/\/+$/, '');
    if (endpoint.toLowerCase().endsWith('/v2/track')) {
        return endpoint;
    }
    return endpoint + '/v2/track';
}
function getExtensionVersion() {
    return chrome.runtime.getManifest().version || '0.0.0';
}
function startupGapBucket(msGap) {
    const hours = Math.floor(msGap / (60 * 60 * 1000));
    if (hours < 1)
        return 'lt1h';
    if (hours < 6)
        return 'lt6h';
    if (hours < 24)
        return 'lt24h';
    if (hours < 24 * 3)
        return 'lt72h';
    if (hours < 24 * 7)
        return 'lt7d';
    return 'gte7d';
}
async function appendTelemetryEvent(featureName, count) {
    const telemetrySettings = await getTelemetrySettings();
    if (!telemetrySettings.enabled) {
        return;
    }
    const safeFeatureName = (featureName || '').trim().slice(0, 120);
    if (!safeFeatureName) {
        return;
    }
    const amount = Number(count || 1);
    if (!Number.isFinite(amount) || amount <= 0) {
        return;
    }
    const now = Date.now();
    const current = await storageGet('local', {
        [TELEMETRY_BUFFER_KEY]: [],
        [FEATURE_LAST_USED_AT_KEY]: {},
        [FEATURE_LAST_USED_KEY]: null
    });
    const buffer = Array.isArray(current[TELEMETRY_BUFFER_KEY]) ? current[TELEMETRY_BUFFER_KEY] : [];
    const existing = buffer.find((item) => item && item.featureName === safeFeatureName);
    if (existing) {
        existing.count += amount;
        existing.lastUpdatedAt = now;
    }
    else {
        buffer.push({
            featureName: safeFeatureName,
            count: amount,
            firstRecordedAt: now,
            lastUpdatedAt: now
        });
    }
    const trimmed = buffer.slice(-MAX_TELEMETRY_BUFFER_SIZE);
    const featureLastUsedAt = current[FEATURE_LAST_USED_AT_KEY] || {};
    featureLastUsedAt[safeFeatureName] = now;
    await storageSet('local', {
        [TELEMETRY_BUFFER_KEY]: trimmed,
        [FEATURE_LAST_USED_AT_KEY]: featureLastUsedAt,
        [FEATURE_LAST_USED_KEY]: safeFeatureName
    });
}
async function registerStartupGapTelemetry() {
    const now = Date.now();
    const current = await storageGet('local', {
        [FEATURE_LAST_USED_AT_KEY]: {},
        [FEATURE_LAST_USED_KEY]: null
    });
    const featureLastUsedAt = current[FEATURE_LAST_USED_AT_KEY] || {};
    let latestFeature = '';
    let latestUsedAt = 0;
    Object.keys(featureLastUsedAt).forEach((featureName) => {
        const usedAt = Number(featureLastUsedAt[featureName] || 0);
        if (usedAt > latestUsedAt) {
            latestUsedAt = usedAt;
            latestFeature = featureName;
        }
    });
    if (!latestFeature && current[FEATURE_LAST_USED_KEY]) {
        latestFeature = current[FEATURE_LAST_USED_KEY];
    }
    if (latestFeature && latestUsedAt > 0) {
        const gapMs = now - latestUsedAt;
        if (gapMs > 0) {
            const featureName = 'startup-gap-' + latestFeature + '-' + startupGapBucket(gapMs);
            await appendTelemetryEvent(featureName, 1);
        }
    }
}
async function sendBufferedTelemetry() {
    const telemetrySettings = await getTelemetrySettings();
    if (!telemetrySettings.enabled) {
        return { ok: false, reason: 'disabled', uploadedCount: 0 };
    }
    const parsed = parseConnectionString(telemetrySettings.appInsightsConnectionString || '');
    if (!parsed.instrumentationKey) {
        return { ok: false, reason: 'missing-instrumentation-key', uploadedCount: 0 };
    }
    const current = await storageGet('local', {
        [TELEMETRY_BUFFER_KEY]: []
    });
    const buffer = Array.isArray(current[TELEMETRY_BUFFER_KEY]) ? current[TELEMETRY_BUFFER_KEY] : [];
    if (buffer.length === 0) {
        return { ok: true, reason: 'empty-buffer', uploadedCount: 0 };
    }
    const version = getExtensionVersion();
    const payload = buffer.map((entry) => ({
        name: 'Microsoft.ApplicationInsights.Event',
        time: new Date().toISOString(),
        iKey: parsed.instrumentationKey,
        data: {
            baseType: 'EventData',
            baseData: {
                ver: 2,
                name: 'extension_feature_usage',
                properties: {
                    featureName: entry.featureName,
                    extensionVersion: version
                },
                measurements: {
                    count: Number(entry.count || 0)
                }
            }
        }
    }));
    const endpoint = getTelemetryEndpoint(parsed.ingestionEndpoint);
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error('Telemetry upload failed with status ' + response.status);
    }
    await storageSet('local', {
        [TELEMETRY_BUFFER_KEY]: []
    });
    return { ok: true, reason: 'uploaded', uploadedCount: buffer.length };
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
async function refreshAccessToken(config, refreshToken, scope = ARM_SCOPE) {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: `openid profile offline_access ${scope}`,
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
    await storageRemove('local', ['oauthTokenCache', GRAPH_TOKEN_CACHE_KEY]);
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
        }
        catch (error) {
            console.warn('[Azure Portal Extension] refresh token failed:', error);
            await clearTokenCache();
        }
    }
    if (interactiveFallback) {
        return loginInteractiveAndCacheToken();
    }
    throw new Error('No access token is available. Please sign in from the extension popup.');
}
async function acquireGraphAccessToken() {
    const current = await storageGet('local', {
        oauthTokenCache: null,
        [GRAPH_TOKEN_CACHE_KEY]: null
    });
    const graphCache = current[GRAPH_TOKEN_CACHE_KEY];
    const armCache = current.oauthTokenCache;
    const config = await getOAuthConfig();
    ensureOAuthConfig(config);
    if (graphCache?.accessToken && graphCache?.expiresAt &&
        (graphCache.expiresAt - Date.now()) > TOKEN_SAFETY_WINDOW_MS) {
        return graphCache.accessToken;
    }
    if (!armCache?.refreshToken) {
        throw new Error('No refresh token is available for Microsoft Graph.');
    }
    const payload = await refreshAccessToken(config, armCache.refreshToken, GRAPH_SCOPE);
    const expiresAt = Date.now() + (Number(payload.expires_in) * 1000);
    await storageSet('local', {
        [GRAPH_TOKEN_CACHE_KEY]: {
            accessToken: payload.access_token,
            refreshToken: payload.refresh_token || armCache.refreshToken,
            expiresAt,
            scope: payload.scope,
            tokenType: payload.token_type || 'Bearer'
        }
    });
    return payload.access_token;
}
async function fetchPagedValues(url, token) {
    const values = [];
    let nextUrl = url;
    while (nextUrl) {
        const response = await fetch(nextUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error('Azure API request failed (HTTP ' + response.status + ').');
        }
        const payload = await response.json();
        if (Array.isArray(payload.value)) {
            values.push(...payload.value);
        }
        nextUrl = payload.nextLink || '';
    }
    return values;
}
function getRoleDefinitionUrl(subscriptionId, roleDefinitionId) {
    const roleId = String(roleDefinitionId || '').split('/').pop();
    return 'https://management.azure.com/subscriptions/' +
        encodeURIComponent(subscriptionId) +
        '/providers/Microsoft.Authorization/roleDefinitions/' +
        encodeURIComponent(roleId) +
        '?api-version=2022-04-01';
}
async function resolveUserNames(principalIds, graphToken) {
    const result = {};
    let failed = false;
    await Promise.all(principalIds.map(async (principalId) => {
        try {
            const response = await fetch('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(principalId) +
                '?$select=displayName,userPrincipalName,mail', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${graphToken}` }
            });
            if (!response.ok) {
                failed = true;
                return;
            }
            const user = await response.json();
            result[principalId] = user.userPrincipalName || user.mail || user.displayName || principalId;
        }
        catch (error) {
            failed = true;
            console.warn('[Azure Portal Extension] user name lookup failed:', principalId);
        }
    }));
    return { names: result, failed };
}
async function getDirectUserAssignments(subscriptionId, scopeUrl, token, roleNameCache) {
    const assignments = await fetchPagedValues(scopeUrl + '/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&%24filter=atScope()', token);
    const expectedScope = decodeURIComponent(new URL(scopeUrl).pathname)
        .replace(/\/+$/, '')
        .toLowerCase();
    const users = assignments.filter((assignment) => assignment?.properties?.principalType === 'User' &&
        String(assignment?.properties?.scope || '')
            .replace(/\/+$/, '')
            .toLowerCase() === expectedScope);
    return Promise.all(users.map(async (assignment) => {
        const properties = assignment.properties;
        const roleDefinitionId = properties.roleDefinitionId || '';
        const roleKey = roleDefinitionId.toLowerCase();
        if (!roleNameCache[roleKey]) {
            const response = await fetch(getRoleDefinitionUrl(subscriptionId, roleDefinitionId), {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (response.ok) {
                const roleDefinition = await response.json();
                roleNameCache[roleKey] =
                    roleDefinition?.properties?.roleName || roleDefinition?.name || roleDefinitionId;
            }
            else {
                roleNameCache[roleKey] = roleDefinitionId;
            }
        }
        return {
            principalId: properties.principalId,
            roleName: roleNameCache[roleKey],
            scope: properties.scope
        };
    }));
}
async function initializeTokenRefreshAlarm() {
    const { oauthTokenCache } = await storageGet('local', { oauthTokenCache: null });
    if (oauthTokenCache?.expiresAt) {
        scheduleTokenRefresh(oauthTokenCache.expiresAt);
    }
}
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== AUTH_ALARM_NAME) {
        if (alarm.name !== TELEMETRY_ALARM_NAME) {
            return;
        }
        try {
            await sendBufferedTelemetry();
        }
        catch (error) {
            console.warn('[Azure Portal Extension] telemetry upload failed:', error);
        }
        return;
    }
    try {
        await acquireAccessToken({ interactiveFallback: false });
    }
    catch (error) {
        console.warn('[Azure Portal Extension] silent token refresh failed:', error);
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
        if (message?.name === 'telemetry-settings-get') {
            const telemetrySettings = await getTelemetrySettings();
            sendResponse({ ok: true, telemetrySettings });
            return;
        }
        if (message?.name === 'telemetry-settings-set') {
            await setTelemetrySettings(message.telemetrySettings || {});
            sendResponse({ ok: true });
            return;
        }
        if (message?.name === 'telemetry-feature-use') {
            await appendTelemetryEvent(message.featureName, message.count || 1);
            sendResponse({ ok: true });
            return;
        }
        if (message?.name === 'telemetry-send-now') {
            const result = await sendBufferedTelemetry();
            sendResponse(result);
            return;
        }
        sendResponse({ ok: false, error: 'unsupported-message' });
    })().catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
});
// return subscriptionList to scripts.js
chrome.runtime.onConnect.addListener(port => {
    console.log('[Azure Portal Extension] background.js#addListener: ' + port.name);
    port.onMessage.addListener(async (arg) => {
        try {
            if (arg.name == "get-subscriptions-accesstoken") {
                const token = await acquireAccessToken({ interactiveFallback: false });
                subscriptionIds.length = 0;
                subscriptions = [];
                var res = await fetch("https://management.azure.com/subscriptions?api-version=2022-12-01", {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ` + token,
                        'Content-Type': 'application/json'
                    },
                });
                var idArray = await res.json();
                if (idArray.error) {
                    console.log(idArray.error); //TODO: Need to update to notify users this error
                    port.postMessage({
                        name: "get-access-function",
                        error: idArray.error
                    });
                    return false;
                }
                else {
                    subscriptions = Array.isArray(idArray.value) ? idArray.value : [];
                    //console.log(subscriptionIds);
                    for (var i = 0; i < idArray.value.length; i++) {
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
                        subscriptionIds.push(idArray.value[i].subscriptionId);
                    }
                    port.postMessage({
                        name: "get-access-function",
                        subscriptions: idArray.value
                    });
                }
                return true;
            }
            if (arg.name === 'get-direct-user-rbac-tree') {
                const token = await acquireAccessToken({ interactiveFallback: false });
                let graphToken = null;
                try {
                    graphToken = await acquireGraphAccessToken();
                }
                catch (error) {
                    console.warn('[Azure Portal Extension] Graph user lookup unavailable:', error.message);
                }
                const roleNameCache = {};
                const tree = [];
                for (const subscription of subscriptions) {
                    const subscriptionId = subscription.subscriptionId;
                    const subscriptionScope = '/subscriptions/' + encodeURIComponent(subscriptionId);
                    const subscriptionAssignments = await getDirectUserAssignments(subscriptionId, 'https://management.azure.com' + subscriptionScope, token, roleNameCache);
                    const resourceGroups = await fetchPagedValues('https://management.azure.com' + subscriptionScope +
                        '/resourceGroups?api-version=2021-04-01', token);
                    const resourceGroupNodes = [];
                    for (const resourceGroup of resourceGroups) {
                        const resourceGroupName = resourceGroup.name;
                        const resourceGroupScope = subscriptionScope +
                            '/resourceGroups/' + encodeURIComponent(resourceGroupName);
                        const assignments = await getDirectUserAssignments(subscriptionId, 'https://management.azure.com' + resourceGroupScope, token, roleNameCache);
                        if (assignments.length > 0) {
                            resourceGroupNodes.push({
                                name: resourceGroupName,
                                assignments
                            });
                        }
                    }
                    if (subscriptionAssignments.length > 0 || resourceGroupNodes.length > 0) {
                        tree.push({
                            name: subscription.displayName || subscription.name || subscriptionId,
                            subscriptionId,
                            assignments: subscriptionAssignments,
                            resourceGroups: resourceGroupNodes
                        });
                    }
                }
                const principalIds = [];
                tree.forEach((subscription) => {
                    const allAssignments = subscription.assignments.concat(subscription.resourceGroups.flatMap((resourceGroup) => resourceGroup.assignments));
                    allAssignments.forEach((assignment) => {
                        if (assignment.principalId && !principalIds.includes(assignment.principalId)) {
                            principalIds.push(assignment.principalId);
                        }
                    });
                });
                const resolvedUsers = graphToken
                    ? await resolveUserNames(principalIds, graphToken)
                    : { names: {}, failed: principalIds.length > 0 };
                const userNames = resolvedUsers.names;
                tree.forEach((subscription) => {
                    const allAssignments = subscription.assignments.concat(subscription.resourceGroups.flatMap((resourceGroup) => resourceGroup.assignments));
                    allAssignments.forEach((assignment) => {
                        assignment.principalName = userNames[assignment.principalId] || assignment.principalId;
                    });
                });
                port.postMessage({
                    name: 'get-direct-user-rbac-tree',
                    rbacTree: {
                        tenantId: subscriptions[0]?.tenantId || '',
                        data: tree,
                        nameResolution: graphToken && !resolvedUsers.failed ? 'graph' : 'principalId',
                        nameResolutionWarning: resolvedUsers.failed && principalIds.length > 0
                            ? 'User names could not be resolved. Add User.ReadBasic.All as a Microsoft Graph delegated API permission to the App registration, grant admin consent, and sign in again.'
                            : ''
                    }
                });
                return true;
            }
            if (arg.name == "get-empty-resourcegroups") {
                const token = await acquireAccessToken({ interactiveFallback: false });
                // console.log("################################# get-empty-resourcegroups");
                // REST API call to get empty resource grups with subscription name
                var data = {
                    "subscriptions": subscriptionIds,
                    "query": "ResourceContainers | where type == 'microsoft.resources/subscriptions/resourcegroups' | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | join kind=leftouter (Resources | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | summarize count() by rgAndSub ) on rgAndSub | where isnull(count_) | project-away rgAndSub1, count_ | join kind=leftouter (ResourceContainers | where type=='microsoft.resources/subscriptions' | project subscriptionName=name, subscriptionId) on subscriptionId | project-away subscriptionId1"
                };
                var res = await fetch('https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ` + token,
                        'Content-Type': 'application/json'
                    },
                    dataType: 'json',
                    body: JSON.stringify(data) // required to pass parameters as json body
                });
                var rgArray = await res.json();
                port.postMessage({
                    name: "get-empty-resourcegroups",
                    emptyResourceGroups: rgArray
                });
                return true;
            }
        }
        catch (error) {
            try {
                port.postMessage({
                    name: arg?.name === 'get-direct-user-rbac-tree'
                        ? 'get-direct-user-rbac-tree'
                        : 'get-access-function',
                    error: error.message || String(error)
                });
            }
            catch (portError) {
                console.debug('[Azure Portal Extension] Port disconnected before error response could be sent.');
            }
        }
    });
});
