'use strict';

import './shared.js';

const { messages, storageGet, storageSet, storageRemove } = AzureExtension;
const AZURE_ENDPOINTS = {
	arm: 'https://management.azure.com',
	graph: 'https://graph.microsoft.com/v1.0',
	authority: 'https://login.microsoftonline.com'
} as const;
const API_VERSIONS = {
	subscriptions: '2022-12-01',
	resourceGroups: '2021-04-01',
	authorization: '2022-04-01',
	resourceGraph: '2021-03-01'
} as const;
const ARM_SCOPE = `${AZURE_ENDPOINTS.arm}/user_impersonation`;
const GRAPH_SCOPE = 'https://graph.microsoft.com/User.ReadBasic.All';
const OAUTH_BASE_SCOPES = 'openid profile offline_access';
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_TELEMETRY_ENDPOINT = 'https://dc.services.visualstudio.com/';
const MAX_FEATURE_NAME_LENGTH = 120;
const EMPTY_RESOURCE_GROUP_QUERY = [
	"ResourceContainers | where type == 'microsoft.resources/subscriptions/resourcegroups'",
	"| extend rgAndSub = strcat(resourceGroup, '--', subscriptionId)",
	"| join kind=leftouter (Resources | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | summarize count() by rgAndSub ) on rgAndSub",
	"| where isnull(count_) | project-away rgAndSub1, count_",
	"| join kind=leftouter (ResourceContainers | where type=='microsoft.resources/subscriptions' | project subscriptionName=name, subscriptionId) on subscriptionId",
	"| project-away subscriptionId1"
].join(' ');
const GRAPH_TOKEN_CACHE_KEY = 'graphOAuthTokenCache';
const AUTH_ALARM_NAME = 'refresh-arm-token';
const TOKEN_SAFETY_WINDOW_MS = 5 * MILLISECONDS_PER_MINUTE;
const TELEMETRY_ALARM_NAME = 'telemetry-daily-upload';
const TELEMETRY_BUFFER_KEY = 'telemetryEventBuffer';
const TELEMETRY_SETTINGS_KEY = 'telemetrySettings';
const TELEMETRY_OPT_IN_KEY = AzureExtension.storageKeys.telemetryOptIn;
const FEATURE_LAST_USED_AT_KEY = 'featureLastUsedAt';
const FEATURE_LAST_USED_KEY = 'featureLastUsed';
const MAX_TELEMETRY_BUFFER_SIZE = 300;
const TELEMETRY_CONNECTION_STRING_PLACEHOLDER = '__APPINSIGHTS_CONNECTION_STRING__';
const TELEMETRY_FIXED_CONNECTION_STRING = TELEMETRY_CONNECTION_STRING_PLACEHOLDER;

console.log('[Azure Portal Extension] start background.js');

chrome.runtime.onInstalled.addListener(async (details) => {
    try {
        await initializeTokenRefreshAlarm();
        await initializeTelemetrySettings(details);
        await initializeTelemetryAlarm();
    } catch (error) {
        console.warn('[Azure Portal Extension] Installation initialization failed:', error);
    }
});

chrome.runtime.onStartup.addListener(async () => {
    try {
        await initializeTokenRefreshAlarm();
        await initializeTelemetryAlarm();
        await registerStartupGapTelemetry();
    } catch (error) {
        console.warn('[Azure Portal Extension] Startup initialization failed:', error);
    }
});

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
        chrome.alarms.create(TELEMETRY_ALARM_NAME, { periodInMinutes: MINUTES_PER_DAY });
    }
}

function parseConnectionString(connectionString) {
    const map: Record<string, string> = {};
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
        ingestionEndpoint: map.ingestionendpoint || DEFAULT_TELEMETRY_ENDPOINT
    };
}

function getTelemetryEndpoint(ingestionEndpoint) {
    const endpoint = (ingestionEndpoint || DEFAULT_TELEMETRY_ENDPOINT).replace(/\/+$/, '');
    if (endpoint.toLowerCase().endsWith('/v2/track')) {
        return endpoint;
    }
    return endpoint + '/v2/track';
}

function getExtensionVersion() {
    return chrome.runtime.getManifest().version || '0.0.0';
}

function getStartupGapBucket(msGap) {
    const hours = Math.floor(msGap / MILLISECONDS_PER_HOUR);
    if (hours < 1) return 'lt1h';
    if (hours < 6) return 'lt6h';
    if (hours < 24) return 'lt24h';
    if (hours < 24 * 3) return 'lt72h';
    if (hours < 24 * 7) return 'lt7d';
    return 'gte7d';
}

async function appendTelemetryEvent(featureName, count) {
    const telemetrySettings = await getTelemetrySettings();
    if (!telemetrySettings.enabled) {
        return;
    }

    const safeFeatureName = (featureName || '').trim().slice(0, MAX_FEATURE_NAME_LENGTH);
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
    } else {
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
            const featureName = 'startup-gap-' + latestFeature + '-' + getStartupGapBucket(gapMs);
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
        oauthTenantId: AzureExtension.defaultTenant,
        oauthClientId: ''
    });

    return {
        tenantId: (config.oauthTenantId || AzureExtension.defaultTenant).trim(),
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
    const authorizeUrl = new URL(getOAuthEndpoint(config.tenantId, 'authorize'));
    authorizeUrl.searchParams.set('client_id', config.clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', getRedirectUri());
    authorizeUrl.searchParams.set('response_mode', 'query');
    authorizeUrl.searchParams.set('scope', `${OAUTH_BASE_SCOPES} ${ARM_SCOPE}`);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('prompt', 'select_account');
    return authorizeUrl.toString();
}

function getOAuthEndpoint(tenantId: string, action: 'authorize' | 'token'): string {
    return `${AZURE_ENDPOINTS.authority}/${encodeURIComponent(tenantId)}/oauth2/v2.0/${action}`;
}

async function exchangeAuthorizationCode(config, code, codeVerifier) {
    const tokenUrl = getOAuthEndpoint(config.tenantId, 'token');
    const body = new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: getRedirectUri(),
        scope: `${OAUTH_BASE_SCOPES} ${ARM_SCOPE}`,
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
    const tokenUrl = getOAuthEndpoint(config.tenantId, 'token');
    const body = new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: `${OAUTH_BASE_SCOPES} ${scope}`,
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
    const expiresAt = Date.now() + (Number(payload.expires_in) * MILLISECONDS_PER_SECOND);
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
    const refreshAt = Math.max(Date.now() + MILLISECONDS_PER_MINUTE, expiresAt - TOKEN_SAFETY_WINDOW_MS);
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
        } catch (error) {
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
    const expiresAt = Date.now() + (Number(payload.expires_in) * MILLISECONDS_PER_SECOND);
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
    return AZURE_ENDPOINTS.arm + '/subscriptions/' +
        encodeURIComponent(subscriptionId) +
        '/providers/Microsoft.Authorization/roleDefinitions/' +
        encodeURIComponent(roleId) +
        '?api-version=' + API_VERSIONS.authorization;
}

async function resolveUserNames(principalIds, graphToken) {
    const result = {};
    let failed = false;
    await Promise.all(principalIds.map(async (principalId) => {
        try {
            const response = await fetch(
                AZURE_ENDPOINTS.graph + '/users/' + encodeURIComponent(principalId) +
                '?$select=displayName,userPrincipalName,mail',
                {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${graphToken}` }
                }
            );
            if (!response.ok) {
                failed = true;
                return;
            }
            const user = await response.json();
            result[principalId] = user.userPrincipalName || user.mail || user.displayName || principalId;
        } catch (error) {
            failed = true;
            console.warn('[Azure Portal Extension] user name lookup failed:', principalId);
        }
    }));
    return { names: result, failed };
}

async function getDirectUserAssignments(subscriptionId, scopeUrl, token, roleNameCache) {
    const assignments = await fetchPagedValues(
        scopeUrl + '/providers/Microsoft.Authorization/roleAssignments?api-version=' +
            API_VERSIONS.authorization + '&%24filter=atScope()',
        token
    );
    const expectedScope = decodeURIComponent(new URL(scopeUrl).pathname)
        .replace(/\/+$/, '')
        .toLowerCase();
    const users = assignments.filter((assignment) =>
        assignment?.properties?.principalType === 'User' &&
        String(assignment?.properties?.scope || '')
            .replace(/\/+$/, '')
            .toLowerCase() === expectedScope
    );
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
            } else {
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
        } catch (error) {
            console.warn('[Azure Portal Extension] telemetry upload failed:', error);
        }
        return;
    }

    try {
        await acquireAccessToken({ interactiveFallback: false });
    } catch (error) {
        console.warn('[Azure Portal Extension] silent token refresh failed:', error);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message?.name === messages.getOAuthConfig) {
            const config = await getOAuthConfig();
            sendResponse({ ok: true, config });
            return;
        }

        if (message?.name === messages.setOAuthConfig) {
            await storageSet('local', {
                oauthTenantId: (message.tenantId || '').trim(),
                oauthClientId: (message.clientId || '').trim()
            });
            sendResponse({ ok: true });
            return;
        }

        if (message?.name === messages.signIn) {
            const accessToken = await loginInteractiveAndCacheToken();
            sendResponse({ ok: true, accessToken });
            return;
        }

        if (message?.name === messages.signOut) {
            await clearTokenCache();
            sendResponse({ ok: true });
            return;
        }

        if (message?.name === messages.authStatus) {
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

        if (message?.name === messages.getTelemetrySettings) {
            const telemetrySettings = await getTelemetrySettings();
            sendResponse({ ok: true, telemetrySettings });
            return;
        }

        if (message?.name === messages.setTelemetrySettings) {
            await setTelemetrySettings(message.telemetrySettings || {});
            sendResponse({ ok: true });
            return;
        }

        if (message?.name === messages.featureUse) {
            await appendTelemetryEvent(message.featureName, message.count || 1);
            sendResponse({ ok: true });
            return;
        }

        if (message?.name === messages.sendTelemetry) {
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

async function fetchSubscriptionList(token: string) {
    const response = await fetch(`${AZURE_ENDPOINTS.arm}/subscriptions?api-version=${API_VERSIONS.subscriptions}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
        throw new Error(payload.error?.message || `Subscription lookup failed (HTTP ${response.status}).`);
    }
    if (!Array.isArray(payload.value)) {
        throw new Error('Subscription lookup returned an invalid subscription list.');
    }
    return payload.value;
}

async function fetchEmptyResourceGroups(subscriptions, token: string) {
    const response = await fetch(
        `${AZURE_ENDPOINTS.arm}/providers/Microsoft.ResourceGraph/resources?api-version=${API_VERSIONS.resourceGraph}`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscriptions: subscriptions.map((subscription) => subscription.subscriptionId),
                query: EMPTY_RESOURCE_GROUP_QUERY
            })
        }
    );
    const payload = await response.json();
    if (!response.ok || payload.error) {
        throw new Error(payload.error?.message || `Empty resource group lookup failed (HTTP ${response.status}).`);
    }
    return payload;
}

chrome.runtime.onConnect.addListener(port => {
    let subscriptions = [];
    console.log('[Azure Portal Extension] background.js#addListener: ' + port.name);
	port.onMessage.addListener(async message => {
        try {
            if (message.name === messages.getSubscriptions) {
                const token = await acquireAccessToken({ interactiveFallback: false });
                subscriptions = [];
                subscriptions = await fetchSubscriptionList(token);
                port.postMessage({
                    name: messages.subscriptionsResult,
                    subscriptions
                });
                return;
            }

            if (message.name === messages.getDirectUserRbac) {
                const token = await acquireAccessToken({ interactiveFallback: false });
                let graphToken = null;
                try {
                    graphToken = await acquireGraphAccessToken();
                } catch (error) {
                    console.warn('[Azure Portal Extension] Graph user lookup unavailable:', error.message);
                }

                const roleNameCache = {};
                const tree = [];
                for (const subscription of subscriptions) {
                    const subscriptionId = subscription.subscriptionId;
                    const subscriptionScope = '/subscriptions/' + encodeURIComponent(subscriptionId);
                    const subscriptionAssignments = await getDirectUserAssignments(
                        subscriptionId,
                        AZURE_ENDPOINTS.arm + subscriptionScope,
                        token,
                        roleNameCache
                    );
                    const resourceGroups = await fetchPagedValues(
                        AZURE_ENDPOINTS.arm + subscriptionScope +
                        '/resourceGroups?api-version=' + API_VERSIONS.resourceGroups,
                        token
                    );
                    const resourceGroupNodes = [];
                    for (const resourceGroup of resourceGroups) {
                        const resourceGroupName = resourceGroup.name;
                        const resourceGroupScope = subscriptionScope +
                            '/resourceGroups/' + encodeURIComponent(resourceGroupName);
                        const assignments = await getDirectUserAssignments(
                            subscriptionId,
                            AZURE_ENDPOINTS.arm + resourceGroupScope,
                            token,
                            roleNameCache
                        );
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
                    const allAssignments = subscription.assignments.concat(
                        subscription.resourceGroups.flatMap((resourceGroup) => resourceGroup.assignments)
                    );
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
                    const allAssignments = subscription.assignments.concat(
                        subscription.resourceGroups.flatMap((resourceGroup) => resourceGroup.assignments)
                    );
                    allAssignments.forEach((assignment) => {
                        assignment.principalName = userNames[assignment.principalId] || assignment.principalId;
                    });
                });
                port.postMessage({
                    name: messages.getDirectUserRbac,
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

            if (message.name === messages.getEmptyResourceGroups) {
                const token = await acquireAccessToken({ interactiveFallback: false });
                const emptyResourceGroups = await fetchEmptyResourceGroups(subscriptions, token);
                port.postMessage({
                    name: messages.getEmptyResourceGroups,
                    emptyResourceGroups
                });
                return;
            }
        } catch (error) {
            try {
                port.postMessage({
                    name: message?.name === messages.getDirectUserRbac
                        ? messages.getDirectUserRbac
                        : messages.subscriptionsResult,
                    error: error.message || String(error)
                });
            }
            catch (portError) {
                console.debug('[Azure Portal Extension] Port disconnected before error response could be sent.');
            }
        }
	});
});