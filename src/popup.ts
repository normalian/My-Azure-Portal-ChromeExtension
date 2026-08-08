'use strict';

interface StoredSettings {
	imgUrl: string;
	opacity: string | number;
	maskAccountName: boolean;
	maskTenantName: boolean;
	maskSubscriptionIds: boolean;
	highlightEmptyResourceGroups: boolean;
	showDirectUserRbac: boolean;
	addText: string;
	color: string;
}

const DEFAULT_SETTINGS: StoredSettings = {
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

function byId<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing settings element: ${id}`);
	}
	return element as T;
}

function sendRuntimeMessage<T = any>(message: object): Promise<T> {
	return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function setStatus(id: string, text: string, color = '#333'): void {
	const element = byId<HTMLElement>(id);
	element.textContent = text;
	element.style.color = color;
}

function updateAuthStatusText(result: any): void {
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

async function loadOAuthConfig(): Promise<void> {
	const response: any = await sendRuntimeMessage({ name: 'oauth-config-get' });
	if (response?.ok) {
		byId<HTMLInputElement>('tenantId').value = response.config.tenantId || 'organizations';
		byId<HTMLInputElement>('clientId').value = response.config.clientId || '';
	}
}

async function saveOAuthConfig(): Promise<any> {
	return sendRuntimeMessage({
		name: 'oauth-config-set',
		tenantId: byId<HTMLInputElement>('tenantId').value.trim() || 'organizations',
		clientId: byId<HTMLInputElement>('clientId').value.trim()
	});
}

async function refreshAuthStatus(): Promise<void> {
	updateAuthStatusText(await sendRuntimeMessage({ name: 'auth-status' }));
}

async function loadTelemetrySettings(): Promise<void> {
	const response: any = await sendRuntimeMessage({ name: 'telemetry-settings-get' });
	if (!response?.ok) {
		setStatus('telemetryStatus', response?.error || 'Failed to load telemetry settings.', 'red');
		return;
	}
	const enabled = Boolean(response.telemetrySettings?.enabled);
	byId<HTMLInputElement>('telemetryOptIn').checked = enabled;
	setStatus('telemetryStatus', enabled ? 'Telemetry is enabled.' : 'Telemetry is disabled.');
}

async function saveTelemetrySettings(): Promise<{ ok: boolean }> {
	const enabled = byId<HTMLInputElement>('telemetryOptIn').checked;
	const response: any = await sendRuntimeMessage({
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

function getSelfManagementInfo(): Promise<any> {
	return new Promise((resolve) => {
		if (!chrome.management?.getSelf) {
			resolve(null);
			return;
		}
		chrome.management.getSelf((info) => resolve(chrome.runtime.lastError ? null : info || null));
	});
}

async function configureDevTelemetryTools(): Promise<void> {
	const selfInfo = await getSelfManagementInfo();
	const tools = byId<HTMLElement>('telemetryDevTools');
	if (selfInfo?.installType !== 'development') {
		tools.hidden = true;
		return;
	}
	tools.hidden = false;
	const button = byId<HTMLInputElement>('sendTelemetryNowButton');
	button.addEventListener('click', async () => {
		setStatus('telemetryDevStatus', 'Sending buffered telemetry...');
		button.disabled = true;
		const result: any = await sendRuntimeMessage({ name: 'telemetry-send-now' });
		if (!result?.ok) {
			setStatus('telemetryDevStatus',
				result?.reason === 'disabled'
					? 'Telemetry is disabled. Enable it and save before sending.'
					: (result?.error || 'Failed to send telemetry.'), 'red');
		} else {
			setStatus('telemetryDevStatus',
				result.uploadedCount > 0
					? `Sent ${result.uploadedCount} buffered telemetry event(s).`
					: 'Telemetry buffer is empty. Nothing was sent.');
		}
		button.disabled = false;
	});
}

function saveSettings(): Promise<void> {
	const settings: StoredSettings = {
		imgUrl: byId<HTMLInputElement>('imgurl').value,
		opacity: byId<HTMLInputElement>('opacity').value,
		maskAccountName: byId<HTMLInputElement>('maskAccountName').checked,
		maskTenantName: byId<HTMLInputElement>('maskTenantName').checked,
		maskSubscriptionIds: byId<HTMLInputElement>('maskSubscriptionIds').checked,
		highlightEmptyResourceGroups: byId<HTMLInputElement>('isHighlightEmptyRG').checked,
		showDirectUserRbac: byId<HTMLInputElement>('showDirectUserRbac').checked,
		addText: byId<HTMLInputElement>('addText').value,
		color: byId<HTMLInputElement>('color').value
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

function loadStoredSettings(): void {
	chrome.storage.sync.get(null, (items: any) => {
		byId<HTMLInputElement>('imgurl').value = String(items.imgUrl || '');
		byId<HTMLInputElement>('opacity').value = String(items.opacity);
		byId<HTMLElement>('slider_val').textContent = String(items.opacity);
		byId<HTMLInputElement>('maskAccountName').checked =
			items.maskAccountName ?? items.isUsernameBluer ?? false;
		byId<HTMLInputElement>('maskTenantName').checked =
			items.maskTenantName ?? items.isAADTenantBluer ?? false;
		byId<HTMLInputElement>('maskSubscriptionIds').checked =
			items.maskSubscriptionIds ?? items.isSubscriptionIdBluer ?? false;
		byId<HTMLInputElement>('color').value = items.color;
		byId<HTMLInputElement>('addText').value = items.addText;
		byId<HTMLInputElement>('isHighlightEmptyRG').checked =
			items.highlightEmptyResourceGroups ?? items.isHighlightEmptyRG ?? false;
		byId<HTMLInputElement>('showDirectUserRbac').checked =
			items.showDirectUserRbac ?? items.isShowDirectUserRbac ?? false;
		updateEmptyResourceGroupControls();
	});
}

function updateEmptyResourceGroupControls(): void {
	const disabled = !byId<HTMLInputElement>('isHighlightEmptyRG').checked;
	byId<HTMLInputElement>('color').disabled = disabled;
	byId<HTMLInputElement>('addText').disabled = disabled;
}

class PopupSettingsController {
	initialize(): void {
		byId<HTMLInputElement>('redirectUri').value = chrome.identity.getRedirectURL();
		byId<HTMLInputElement>('redirectUri').readOnly = true;
		byId<HTMLInputElement>('redirectUri').disabled = true;

		byId<HTMLInputElement>('save_button').addEventListener('click', async () => {
			try {
				await saveSettings();
			} catch (error) {
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

		byId<HTMLInputElement>('isHighlightEmptyRG')
			.addEventListener('change', updateEmptyResourceGroupControls);
		byId<HTMLInputElement>('opacity').addEventListener('input', () => {
			byId<HTMLElement>('slider_val').textContent = byId<HTMLInputElement>('opacity').value;
		});
		byId<HTMLInputElement>('telemetryOptIn').addEventListener('change', () => {
			setStatus('telemetryStatus',
				byId<HTMLInputElement>('telemetryOptIn').checked
					? 'Telemetry will be enabled on save.'
					: 'Telemetry is disabled.');
		});
		byId<HTMLInputElement>('signin_button').addEventListener('click', async () => {
			if (!byId<HTMLInputElement>('clientId').value.trim()) {
				setStatus('authStatus', 'Please enter Client ID.', 'red');
				return;
			}
			const saved = await saveOAuthConfig();
			if (!saved?.ok) {
				setStatus('authStatus', saved?.error || 'Failed to save OAuth settings.', 'red');
				return;
			}
			setStatus('authStatus', 'Signing in...');
			const result: any = await sendRuntimeMessage({ name: 'auth-login' });
			if (!result?.ok) {
				setStatus('authStatus', result?.error || 'Sign-in failed.', 'red');
				return;
			}
			await refreshAuthStatus();
		});
		byId<HTMLInputElement>('signout_button').addEventListener('click', async () => {
			const result: any = await sendRuntimeMessage({ name: 'auth-logout' });
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
