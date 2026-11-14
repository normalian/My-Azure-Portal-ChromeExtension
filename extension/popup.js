(() => {
'use strict';
const { messages, sendRuntimeMessage, readPortalSettings, serializePortalSettings, storageGet, storageSet } = AzureExtension;
const STATUS_COLORS = { neutral: '#333', success: '#0b6a0b', error: 'red' };
function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing settings element: ${id}`);
    }
    return element;
}
function setStatus(id, text, color = STATUS_COLORS.neutral) {
    const element = byId(id);
    element.textContent = text;
    element.style.color = color;
}
function updateAuthStatusText(result) {
    if (!result?.ok) {
        setStatus('authStatus', result?.error || 'Failed to get authentication status.', STATUS_COLORS.error);
        return;
    }
    if (!result.signedIn) {
        setStatus('authStatus', 'Not signed in');
        return;
    }
    const expiresDate = new Date(result.expiresAt);
    setStatus('authStatus', `Signed in (expires: ${expiresDate.toLocaleString()})`, STATUS_COLORS.success);
}
async function loadOAuthConfig() {
    const response = await sendRuntimeMessage({ name: messages.getOAuthConfig });
    if (response?.ok) {
        byId('tenantId').value = response.config.tenantId || AzureExtension.defaultTenant;
        byId('clientId').value = response.config.clientId || '';
    }
    else {
        throw new Error(response?.error || 'Failed to load OAuth settings.');
    }
}
async function saveOAuthConfig() {
    return sendRuntimeMessage({
        name: messages.setOAuthConfig,
        tenantId: byId('tenantId').value.trim() || AzureExtension.defaultTenant,
        clientId: byId('clientId').value.trim()
    });
}
async function refreshAuthStatus() {
    updateAuthStatusText(await sendRuntimeMessage({ name: messages.authStatus }));
}
async function loadTelemetrySettings() {
    const response = await sendRuntimeMessage({ name: messages.getTelemetrySettings });
    if (!response?.ok) {
        setStatus('telemetryStatus', response?.error || 'Failed to load telemetry settings.', STATUS_COLORS.error);
        return;
    }
    const enabled = Boolean(response.telemetrySettings?.enabled);
    byId('telemetryOptIn').checked = enabled;
    setStatus('telemetryStatus', enabled ? 'Telemetry is enabled.' : 'Telemetry is disabled.');
}
async function saveTelemetrySettings() {
    const enabled = byId('telemetryOptIn').checked;
    const response = await sendRuntimeMessage({
        name: messages.setTelemetrySettings,
        telemetrySettings: { enabled }
    });
    if (!response?.ok) {
        setStatus('telemetryStatus', response?.error || 'Failed to save telemetry settings.', STATUS_COLORS.error);
        return { ok: false };
    }
    setStatus('telemetryStatus', enabled ? 'Telemetry enabled.' : 'Telemetry disabled.', STATUS_COLORS.success);
    return { ok: true };
}
function getSelfManagementInfo() {
    return new Promise((resolve) => {
        if (!chrome.management?.getSelf) {
            resolve(null);
            return;
        }
        chrome.management.getSelf((info) => {
            if (chrome.runtime.lastError) {
                console.debug('[Azure Portal Extension] Unable to detect development installation:', chrome.runtime.lastError.message);
                resolve(null);
            }
            else {
                resolve(info || null);
            }
        });
    });
}
async function configureDevTelemetryTools() {
    const selfInfo = await getSelfManagementInfo();
    const tools = byId('telemetryDevTools');
    if (selfInfo?.installType !== 'development') {
        tools.hidden = true;
        return;
    }
    tools.hidden = false;
    const button = byId('sendTelemetryNowButton');
    registerPopupAction('sendTelemetryNowButton', async () => {
        setStatus('telemetryDevStatus', 'Sending buffered telemetry...');
        button.disabled = true;
        try {
            const result = await sendRuntimeMessage({ name: messages.sendTelemetry });
            if (!result?.ok) {
                setStatus('telemetryDevStatus', result?.reason === 'disabled'
                    ? 'Telemetry is disabled. Enable it and save before sending.'
                    : (result?.error || 'Failed to send telemetry.'), STATUS_COLORS.error);
            }
            else {
                setStatus('telemetryDevStatus', result.uploadedCount > 0
                    ? `Sent ${result.uploadedCount} buffered telemetry event(s).`
                    : 'Telemetry buffer is empty. Nothing was sent.');
            }
        }
        finally {
            button.disabled = false;
        }
    }, 'telemetryDevStatus');
}
function saveSettings() {
    const settings = {
        backgroundImageUrl: byId('backgroundImageUrl').value,
        backgroundOpacity: byId('backgroundOpacity').value,
        maskAccountName: byId('maskAccountName').checked,
        maskTenantName: byId('maskTenantName').checked,
        maskSubscriptionIds: byId('maskSubscriptionIds').checked,
        azureTabIcon: byId('azureTabIcon').checked,
        highlightEmptyResourceGroups: byId('highlightEmptyResourceGroups').checked,
        showDirectUserRbac: byId('showDirectUserRbac').checked,
        emptyResourceGroupSuffix: byId('emptyResourceGroupSuffix').value,
        emptyResourceGroupColor: byId('emptyResourceGroupColor').value
    };
    return storageSet('sync', serializePortalSettings(settings));
}
async function loadStoredSettings() {
    const settings = readPortalSettings(await storageGet('sync', null));
    for (const key of Object.keys(settings)) {
        const input = byId(key);
        const value = settings[key];
        if (typeof value === 'boolean') {
            input.checked = value;
        }
        else {
            input.value = String(value);
        }
    }
    byId('backgroundOpacityValue').textContent = String(settings.backgroundOpacity);
    updateEmptyResourceGroupControls();
}
function updateEmptyResourceGroupControls() {
    const disabled = !byId('highlightEmptyResourceGroups').checked;
    byId('emptyResourceGroupColor').disabled = disabled;
    byId('emptyResourceGroupSuffix').disabled = disabled;
}
class PopupSettingsController {
    initialize() {
        byId('redirectUri').value = chrome.identity.getRedirectURL();
        byId('redirectUri').readOnly = true;
        byId('redirectUri').disabled = true;
        const optionsButton = document.getElementById('manageSubscriptionBackgrounds');
        optionsButton?.addEventListener('click', () => chrome.runtime.openOptionsPage());
        registerPopupAction('saveSettingsButton', async () => {
            try {
                await saveSettings();
            }
            catch (error) {
                setStatus('authStatus', `Failed to save settings: ${error instanceof Error ? error.message : String(error)}`, STATUS_COLORS.error);
                return;
            }
            const saved = await saveOAuthConfig();
            if (!saved?.ok) {
                setStatus('authStatus', saved?.error || 'Failed to save OAuth settings.', STATUS_COLORS.error);
            }
            await saveTelemetrySettings();
        });
        loadStoredSettings().catch(showPopupError);
        loadOAuthConfig().then(refreshAuthStatus).catch(showPopupError);
        loadTelemetrySettings().catch(showPopupError);
        configureDevTelemetryTools().catch(showPopupError);
        byId('highlightEmptyResourceGroups')
            .addEventListener('change', updateEmptyResourceGroupControls);
        byId('backgroundOpacity').addEventListener('input', () => {
            byId('backgroundOpacityValue').textContent = byId('backgroundOpacity').value;
        });
        byId('telemetryOptIn').addEventListener('change', () => {
            setStatus('telemetryStatus', byId('telemetryOptIn').checked
                ? 'Telemetry will be enabled on save.'
                : 'Telemetry is disabled.');
        });
        registerPopupAction('signInButton', async () => {
            if (!byId('clientId').value.trim()) {
                setStatus('authStatus', 'Please enter Client ID.', STATUS_COLORS.error);
                return;
            }
            const saved = await saveOAuthConfig();
            if (!saved?.ok) {
                setStatus('authStatus', saved?.error || 'Failed to save OAuth settings.', STATUS_COLORS.error);
                return;
            }
            setStatus('authStatus', 'Signing in...');
            const result = await sendRuntimeMessage({ name: messages.signIn });
            if (!result?.ok) {
                setStatus('authStatus', result?.error || 'Sign-in failed.', STATUS_COLORS.error);
                return;
            }
            await refreshAuthStatus();
        });
        registerPopupAction('signOutButton', async () => {
            const result = await sendRuntimeMessage({ name: messages.signOut });
            if (!result?.ok) {
                setStatus('authStatus', result?.error || 'Sign-out failed.', STATUS_COLORS.error);
                return;
            }
            await refreshAuthStatus();
        });
    }
}
function showPopupError(error) {
    setStatus('authStatus', error instanceof Error ? error.message : String(error), STATUS_COLORS.error);
}
function registerPopupAction(id, action, statusId = 'authStatus') {
    byId(id).addEventListener('click', () => {
        action().catch((error) => {
            setStatus(statusId, error instanceof Error ? error.message : String(error), STATUS_COLORS.error);
        });
    });
}
document.addEventListener('DOMContentLoaded', () => {
    new PopupSettingsController().initialize();
});

})();
