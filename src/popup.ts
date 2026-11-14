'use strict';

import type { PortalSettings } from './shared.js';

const { messages, sendRuntimeMessage, readPortalSettings, serializePortalSettings, storageGet, storageSet } = AzureExtension;
const STATUS_COLORS = { neutral: '#333', success: '#0b6a0b', error: 'red' } as const;

interface RuntimeResponse {
	ok: boolean;
	error?: string;
	signedIn?: boolean;
	expiresAt?: number;
	config?: { tenantId: string; clientId: string };
	telemetrySettings?: { enabled: boolean };
	reason?: string;
	uploadedCount?: number;
}

function byId<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing settings element: ${id}`);
	}
	return element as T;
}

function setStatus(id: string, text: string, color: string = STATUS_COLORS.neutral): void {
	const element = byId<HTMLElement>(id);
	element.textContent = text;
	element.style.color = color;
}

function updateAuthStatusText(result: RuntimeResponse): void {
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

async function loadOAuthConfig(): Promise<void> {
	const response = await sendRuntimeMessage<RuntimeResponse>({ name: messages.getOAuthConfig });
	if (response?.ok) {
		byId<HTMLInputElement>('tenantId').value = response.config.tenantId || AzureExtension.defaultTenant;
		byId<HTMLInputElement>('clientId').value = response.config.clientId || '';
	} else {
		throw new Error(response?.error || 'Failed to load OAuth settings.');
	}
}

async function saveOAuthConfig(): Promise<RuntimeResponse> {
	return sendRuntimeMessage({
		name: messages.setOAuthConfig,
		tenantId: byId<HTMLInputElement>('tenantId').value.trim() || AzureExtension.defaultTenant,
		clientId: byId<HTMLInputElement>('clientId').value.trim()
	});
}

async function refreshAuthStatus(): Promise<void> {
	updateAuthStatusText(await sendRuntimeMessage<RuntimeResponse>({ name: messages.authStatus }));
}

async function loadTelemetrySettings(): Promise<void> {
	const response = await sendRuntimeMessage<RuntimeResponse>({ name: messages.getTelemetrySettings });
	if (!response?.ok) {
		setStatus('telemetryStatus', response?.error || 'Failed to load telemetry settings.', STATUS_COLORS.error);
		return;
	}
	const enabled = Boolean(response.telemetrySettings?.enabled);
	byId<HTMLInputElement>('telemetryOptIn').checked = enabled;
	setStatus('telemetryStatus', enabled ? 'Telemetry is enabled.' : 'Telemetry is disabled.');
}

async function saveTelemetrySettings(): Promise<{ ok: boolean }> {
	const enabled = byId<HTMLInputElement>('telemetryOptIn').checked;
	const response = await sendRuntimeMessage<RuntimeResponse>({
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

function getSelfManagementInfo(): Promise<chrome.management.ExtensionInfo | null> {
	return new Promise((resolve) => {
		if (!chrome.management?.getSelf) {
			resolve(null);
			return;
		}
		chrome.management.getSelf((info) => {
			if (chrome.runtime.lastError) {
				console.debug('[Azure Portal Extension] Unable to detect development installation:', chrome.runtime.lastError.message);
				resolve(null);
			} else {
				resolve(info || null);
			}
		});
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
	registerPopupAction('sendTelemetryNowButton', async () => {
		setStatus('telemetryDevStatus', 'Sending buffered telemetry...');
		button.disabled = true;
		try {
			const result = await sendRuntimeMessage<RuntimeResponse>({ name: messages.sendTelemetry });
			if (!result?.ok) {
				setStatus('telemetryDevStatus',
					result?.reason === 'disabled'
						? 'Telemetry is disabled. Enable it and save before sending.'
						: (result?.error || 'Failed to send telemetry.'), STATUS_COLORS.error);
			} else {
				setStatus('telemetryDevStatus',
					result.uploadedCount > 0
						? `Sent ${result.uploadedCount} buffered telemetry event(s).`
						: 'Telemetry buffer is empty. Nothing was sent.');
			}
		} finally {
			button.disabled = false;
		}
	}, 'telemetryDevStatus');
}

function saveSettings(): Promise<void> {
	const settings: PortalSettings = {
		backgroundImageUrl: byId<HTMLInputElement>('backgroundImageUrl').value,
		backgroundOpacity: byId<HTMLInputElement>('backgroundOpacity').value,
		maskAccountName: byId<HTMLInputElement>('maskAccountName').checked,
		maskTenantName: byId<HTMLInputElement>('maskTenantName').checked,
		maskSubscriptionIds: byId<HTMLInputElement>('maskSubscriptionIds').checked,
		azureTabIcon: byId<HTMLInputElement>('azureTabIcon').checked,
		highlightEmptyResourceGroups: byId<HTMLInputElement>('highlightEmptyResourceGroups').checked,
		showDirectUserRbac: byId<HTMLInputElement>('showDirectUserRbac').checked,
		emptyResourceGroupSuffix: byId<HTMLInputElement>('emptyResourceGroupSuffix').value,
		emptyResourceGroupColor: byId<HTMLInputElement>('emptyResourceGroupColor').value
	};
	return storageSet('sync', serializePortalSettings(settings));
}

async function loadStoredSettings(): Promise<void> {
	const settings = readPortalSettings(await storageGet('sync', null));
	for (const key of Object.keys(settings) as (keyof PortalSettings)[]) {
		const input = byId<HTMLInputElement>(key);
		const value = settings[key];
		if (typeof value === 'boolean') {
			input.checked = value;
		} else {
			input.value = String(value);
		}
	}
	byId<HTMLElement>('backgroundOpacityValue').textContent = String(settings.backgroundOpacity);
	updateEmptyResourceGroupControls();
}

function updateEmptyResourceGroupControls(): void {
	const disabled = !byId<HTMLInputElement>('highlightEmptyResourceGroups').checked;
	byId<HTMLInputElement>('emptyResourceGroupColor').disabled = disabled;
	byId<HTMLInputElement>('emptyResourceGroupSuffix').disabled = disabled;
}

class PopupSettingsController {
	initialize(): void {
		byId<HTMLInputElement>('redirectUri').value = chrome.identity.getRedirectURL();
		byId<HTMLInputElement>('redirectUri').readOnly = true;
		byId<HTMLInputElement>('redirectUri').disabled = true;
		const optionsButton = document.getElementById('manageSubscriptionBackgrounds');
		optionsButton?.addEventListener('click', () => chrome.runtime.openOptionsPage());

		registerPopupAction('saveSettingsButton', async () => {
			try {
				await saveSettings();
			} catch (error) {
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

		byId<HTMLInputElement>('highlightEmptyResourceGroups')
			.addEventListener('change', updateEmptyResourceGroupControls);
		byId<HTMLInputElement>('backgroundOpacity').addEventListener('input', () => {
			byId<HTMLElement>('backgroundOpacityValue').textContent = byId<HTMLInputElement>('backgroundOpacity').value;
		});
		byId<HTMLInputElement>('telemetryOptIn').addEventListener('change', () => {
			setStatus('telemetryStatus',
				byId<HTMLInputElement>('telemetryOptIn').checked
					? 'Telemetry will be enabled on save.'
					: 'Telemetry is disabled.');
		});
		registerPopupAction('signInButton', async () => {
			if (!byId<HTMLInputElement>('clientId').value.trim()) {
				setStatus('authStatus', 'Please enter Client ID.', STATUS_COLORS.error);
				return;
			}
			const saved = await saveOAuthConfig();
			if (!saved?.ok) {
				setStatus('authStatus', saved?.error || 'Failed to save OAuth settings.', STATUS_COLORS.error);
				return;
			}
			setStatus('authStatus', 'Signing in...');
			const result = await sendRuntimeMessage<RuntimeResponse>({ name: messages.signIn });
			if (!result?.ok) {
				setStatus('authStatus', result?.error || 'Sign-in failed.', STATUS_COLORS.error);
				return;
			}
			await refreshAuthStatus();
		});
		registerPopupAction('signOutButton', async () => {
			const result = await sendRuntimeMessage<RuntimeResponse>({ name: messages.signOut });
			if (!result?.ok) {
				setStatus('authStatus', result?.error || 'Sign-out failed.', STATUS_COLORS.error);
				return;
			}
			await refreshAuthStatus();
		});
	}
}

function showPopupError(error: unknown): void {
	setStatus('authStatus', error instanceof Error ? error.message : String(error), STATUS_COLORS.error);
}

function registerPopupAction(id: string, action: () => Promise<void>, statusId = 'authStatus'): void {
	byId<HTMLElement>(id).addEventListener('click', () => {
		action().catch((error: unknown) => {
			setStatus(statusId, error instanceof Error ? error.message : String(error), STATUS_COLORS.error);
		});
	});
}

document.addEventListener('DOMContentLoaded', () => {
	new PopupSettingsController().initialize();
});
