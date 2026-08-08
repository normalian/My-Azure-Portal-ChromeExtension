'use strict';
const DEFAULT_SETTINGS = {
    imgUrl: '',
    opacity: 0.8,
    maskAccountName: false,
    maskTenantName: false,
    maskSubscriptionIds: false,
    highlightEmptyResourceGroups: false,
    showDirectUserRbac: false,
    addText: ' - @@empty@@',
    color: '#ffff00'
};
function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing settings element: ${id}`);
    }
    return element;
}
function sendRuntimeMessage(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}
function setStatus(id, text, color = '#333') {
    const element = byId(id);
    element.textContent = text;
    element.style.color = color;
}
function updateAuthStatusText(result) {
    if (!result?.ok) {
        setStatus('authStatus', result?.error || 'Failed to get authentication status.', 'red');
        return;
    }
    if (!result.signedIn) {
        setStatus('authStatus', 'Not signed in');
        return;
    }
    const expiresDate = new Date(result.expiresAt);
    setStatus('authStatus', `Signed in (expires: ${expiresDate.toLocaleString()})`, '#0b6a0b');
}
async function loadOAuthConfig() {
    const response = await sendRuntimeMessage({ name: 'oauth-config-get' });
    if (response?.ok) {
        byId('tenantId').value = response.config.tenantId || 'organizations';
        byId('clientId').value = response.config.clientId || '';
    }
}
async function saveOAuthConfig() {
    return sendRuntimeMessage({
        name: 'oauth-config-set',
        tenantId: byId('tenantId').value.trim() || 'organizations',
        clientId: byId('clientId').value.trim()
    });
}
async function refreshAuthStatus() {
    updateAuthStatusText(await sendRuntimeMessage({ name: 'auth-status' }));
}
async function loadTelemetrySettings() {
    const response = await sendRuntimeMessage({ name: 'telemetry-settings-get' });
    if (!response?.ok) {
        setStatus('telemetryStatus', response?.error || 'Failed to load telemetry settings.', 'red');
        return;
    }
    const enabled = Boolean(response.telemetrySettings?.enabled);
    byId('telemetryOptIn').checked = enabled;
    setStatus('telemetryStatus', enabled ? 'Telemetry is enabled.' : 'Telemetry is disabled.');
}
async function saveTelemetrySettings() {
    const enabled = byId('telemetryOptIn').checked;
    const response = await sendRuntimeMessage({
        name: 'telemetry-settings-set',
        telemetrySettings: { enabled }
    });
    if (!response?.ok) {
        setStatus('telemetryStatus', response?.error || 'Failed to save telemetry settings.', 'red');
        return { ok: false };
    }
    setStatus('telemetryStatus', enabled ? 'Telemetry enabled.' : 'Telemetry disabled.', '#0b6a0b');
    return { ok: true };
}
function getSelfManagementInfo() {
    return new Promise((resolve) => {
        if (!chrome.management?.getSelf) {
            resolve(null);
            return;
        }
        chrome.management.getSelf((info) => resolve(chrome.runtime.lastError ? null : info || null));
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
    button.addEventListener('click', async () => {
        setStatus('telemetryDevStatus', 'Sending buffered telemetry...');
        button.disabled = true;
        const result = await sendRuntimeMessage({ name: 'telemetry-send-now' });
        if (!result?.ok) {
            setStatus('telemetryDevStatus', result?.reason === 'disabled'
                ? 'Telemetry is disabled. Enable it and save before sending.'
                : (result?.error || 'Failed to send telemetry.'), 'red');
        }
        else {
            setStatus('telemetryDevStatus', result.uploadedCount > 0
                ? `Sent ${result.uploadedCount} buffered telemetry event(s).`
                : 'Telemetry buffer is empty. Nothing was sent.');
        }
        button.disabled = false;
    });
}
function saveSettings() {
    const settings = {
        imgUrl: byId('imgurl').value,
        opacity: byId('opacity').value,
        maskAccountName: byId('maskAccountName').checked,
        maskTenantName: byId('maskTenantName').checked,
        maskSubscriptionIds: byId('maskSubscriptionIds').checked,
        highlightEmptyResourceGroups: byId('isHighlightEmptyRG').checked,
        showDirectUserRbac: byId('showDirectUserRbac').checked,
        addText: byId('addText').value,
        color: byId('color').value
    };
    return new Promise((resolve, reject) => chrome.storage.sync.set({
        imgUrl: settings.imgUrl,
        opacity: settings.opacity,
        maskAccountName: settings.maskAccountName,
        maskTenantName: settings.maskTenantName,
        maskSubscriptionIds: settings.maskSubscriptionIds,
        highlightEmptyResourceGroups: settings.highlightEmptyResourceGroups,
        showDirectUserRbac: settings.showDirectUserRbac,
        isUsernameBluer: settings.maskAccountName,
        isAADTenantBluer: settings.maskTenantName,
        isSubscriptionIdBluer: settings.maskSubscriptionIds,
        isHighlightEmptyRG: settings.highlightEmptyResourceGroups,
        isShowDirectUserRbac: settings.showDirectUserRbac,
        addText: settings.addText,
        color: settings.color
    }, () => {
        if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
        }
        resolve();
    }));
}
function loadStoredSettings() {
    chrome.storage.sync.get(null, (items) => {
        byId('imgurl').value = String(items.imgUrl || '');
        byId('opacity').value = String(items.opacity);
        byId('slider_val').textContent = String(items.opacity);
        byId('maskAccountName').checked =
            items.maskAccountName ?? items.isUsernameBluer ?? false;
        byId('maskTenantName').checked =
            items.maskTenantName ?? items.isAADTenantBluer ?? false;
        byId('maskSubscriptionIds').checked =
            items.maskSubscriptionIds ?? items.isSubscriptionIdBluer ?? false;
        byId('color').value = items.color;
        byId('addText').value = items.addText;
        byId('isHighlightEmptyRG').checked =
            items.highlightEmptyResourceGroups ?? items.isHighlightEmptyRG ?? false;
        byId('showDirectUserRbac').checked =
            items.showDirectUserRbac ?? items.isShowDirectUserRbac ?? false;
        updateEmptyResourceGroupControls();
    });
}
function updateEmptyResourceGroupControls() {
    const disabled = !byId('isHighlightEmptyRG').checked;
    byId('color').disabled = disabled;
    byId('addText').disabled = disabled;
}
class PopupSettingsController {
    initialize() {
        byId('redirectUri').value = chrome.identity.getRedirectURL();
        byId('redirectUri').readOnly = true;
        byId('redirectUri').disabled = true;
        byId('save_button').addEventListener('click', async () => {
            try {
                await saveSettings();
            }
            catch (error) {
                setStatus('authStatus', `Failed to save settings: ${error instanceof Error ? error.message : String(error)}`, 'red');
                return;
            }
            const saved = await saveOAuthConfig();
            if (!saved?.ok) {
                setStatus('authStatus', saved?.error || 'Failed to save OAuth settings.', 'red');
            }
            await saveTelemetrySettings();
        });
        loadStoredSettings();
        loadOAuthConfig().then(refreshAuthStatus);
        loadTelemetrySettings();
        configureDevTelemetryTools();
        byId('isHighlightEmptyRG')
            .addEventListener('change', updateEmptyResourceGroupControls);
        byId('opacity').addEventListener('input', () => {
            byId('slider_val').textContent = byId('opacity').value;
        });
        byId('telemetryOptIn').addEventListener('change', () => {
            setStatus('telemetryStatus', byId('telemetryOptIn').checked
                ? 'Telemetry will be enabled on save.'
                : 'Telemetry is disabled.');
        });
        byId('signin_button').addEventListener('click', async () => {
            if (!byId('clientId').value.trim()) {
                setStatus('authStatus', 'Please enter Client ID.', 'red');
                return;
            }
            const saved = await saveOAuthConfig();
            if (!saved?.ok) {
                setStatus('authStatus', saved?.error || 'Failed to save OAuth settings.', 'red');
                return;
            }
            setStatus('authStatus', 'Signing in...');
            const result = await sendRuntimeMessage({ name: 'auth-login' });
            if (!result?.ok) {
                setStatus('authStatus', result?.error || 'Sign-in failed.', 'red');
                return;
            }
            await refreshAuthStatus();
        });
        byId('signout_button').addEventListener('click', async () => {
            const result = await sendRuntimeMessage({ name: 'auth-logout' });
            if (!result?.ok) {
                setStatus('authStatus', result?.error || 'Sign-out failed.', 'red');
                return;
            }
            await refreshAuthStatus();
        });
    }
}
document.addEventListener('DOMContentLoaded', () => {
    new PopupSettingsController().initialize();
});
