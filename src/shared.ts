export interface PortalSettings {
	backgroundImageUrl: string;
	backgroundOpacity: string | number;
	maskAccountName: boolean;
	maskTenantName: boolean;
	maskSubscriptionIds: boolean;
	azureTabIcon: boolean;
	highlightEmptyResourceGroups: boolean;
	showDirectUserRbac: boolean;
	emptyResourceGroupSuffix: string;
	emptyResourceGroupColor: string;
}

type StoredPortalSettings = Partial<PortalSettings> & {
	imgUrl?: string;
	opacity?: string | number;
	addText?: string;
	color?: string;
	isUsernameBluer?: boolean;
	isAADTenantBluer?: boolean;
	isSubscriptionIdBluer?: boolean;
	isHighlightEmptyRG?: boolean;
	isShowDirectUserRbac?: boolean;
};

const defaultSettings: Readonly<PortalSettings> = Object.freeze({
	backgroundImageUrl: '',
	backgroundOpacity: 0.8,
	maskAccountName: false,
	maskTenantName: false,
	maskSubscriptionIds: false,
	azureTabIcon: true,
	highlightEmptyResourceGroups: false,
	showDirectUserRbac: false,
	emptyResourceGroupSuffix: ' - @@empty@@',
	emptyResourceGroupColor: '#ffff00'
});

// Keep persisted aliases and message values stable for existing installations.
const legacySettingKeys: Readonly<Partial<Record<keyof PortalSettings, keyof StoredPortalSettings>>> = Object.freeze({
	backgroundImageUrl: 'imgUrl',
	backgroundOpacity: 'opacity',
	maskAccountName: 'isUsernameBluer',
	maskTenantName: 'isAADTenantBluer',
	maskSubscriptionIds: 'isSubscriptionIdBluer',
	highlightEmptyResourceGroups: 'isHighlightEmptyRG',
	showDirectUserRbac: 'isShowDirectUserRbac',
	emptyResourceGroupSuffix: 'addText',
	emptyResourceGroupColor: 'color'
});

function readPortalSettings(items: StoredPortalSettings): PortalSettings {
	const settings = { ...defaultSettings };
	for (const key of Object.keys(defaultSettings) as (keyof PortalSettings)[]) {
		const alias = legacySettingKeys[key];
		Object.assign(settings, {
			[key]: items[key] ?? (alias ? items[alias] : undefined) ?? defaultSettings[key]
		});
	}
	return settings;
}

function serializePortalSettings(settings: PortalSettings): StoredPortalSettings {
	const stored: StoredPortalSettings = { ...settings };
	for (const key of Object.keys(legacySettingKeys) as (keyof PortalSettings)[]) {
		Object.assign(stored, { [legacySettingKeys[key]]: settings[key] });
	}
	return stored;
}

function storageGet<T extends Record<string, unknown>>(
	area: 'local' | 'sync',
	keys: T
): Promise<T>;
function storageGet(
	area: 'local' | 'sync',
	keys: string | string[] | null
): Promise<Record<string, unknown>>;
function storageGet(
	area: 'local' | 'sync',
	keys: string | string[] | Record<string, unknown> | null
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		chrome.storage[area].get(keys, (items) => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve(items);
			}
		});
	});
}

function storageSet(area: 'local' | 'sync', values: Record<string, unknown>): Promise<void> {
	return new Promise((resolve, reject) => {
		chrome.storage[area].set(values, () => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve();
			}
		});
	});
}

function storageRemove(area: 'local' | 'sync', keys: string | string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		chrome.storage[area].remove(keys, () => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve();
			}
		});
	});
}

function sendRuntimeMessage<T>(message: object): Promise<T> {
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(message, (response: T) => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve(response);
			}
		});
	});
}

function escapeHtml(value: unknown): string {
	return String(value ?? '').replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	}[character]!));
}

const sharedUtilities = Object.freeze({
	defaultSettings,
	legacySettingKeys,
	readPortalSettings,
	serializePortalSettings,
	storageGet,
	storageSet,
	storageRemove,
	sendRuntimeMessage,
	escapeHtml,
	storageKeys: Object.freeze({
		emptyResourceGroups: 'emptyResourcegroupsCache',
		subscriptionBackgroundRules: 'subscriptionBackgroundRules',
		telemetryOptIn: 'telemetryOptIn'
	}),
	messages: Object.freeze({
		getSubscriptions: 'get-subscriptions-accesstoken',
		subscriptionsResult: 'get-access-function',
		getEmptyResourceGroups: 'get-empty-resourcegroups',
		getDirectUserRbac: 'get-direct-user-rbac-tree',
		getOAuthConfig: 'oauth-config-get',
		setOAuthConfig: 'oauth-config-set',
		authStatus: 'auth-status',
		signIn: 'auth-login',
		signOut: 'auth-logout',
		getTelemetrySettings: 'telemetry-settings-get',
		setTelemetrySettings: 'telemetry-settings-set',
		featureUse: 'telemetry-feature-use',
		sendTelemetry: 'telemetry-send-now'
	}),
	backgroundPortName: 'my-background-port',
	defaultTenant: 'organizations',
	guidSource: '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
});

declare global {
	var AzureExtension: typeof sharedUtilities;
}

// Classic content scripts and extension pages share the same API; the worker imports it.
globalThis.AzureExtension = sharedUtilities;
