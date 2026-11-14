'use strict';

import type { PortalSettings } from './shared.js';

console.log('[Azure Portal Extension] start script.js', {
	frameHref: window.location.href,
	isTopFrame: window === window.top
});

class DomCollection {
	constructor(private readonly elements: Element[]) {}

	get length(): number {
		return this.elements.length;
	}

	get(index: number): Element | undefined {
		return this.elements[index];
	}

	first(): DomCollection {
		return new DomCollection(this.elements.slice(0, 1));
	}

	each(callback: (index: number, element: Element) => void): DomCollection {
		this.elements.forEach((element, index) => {
			callback.call(element, index, element);
		});
		return this;
	}

	attr(name: string): string | undefined;
	attr(name: string, value: string): DomCollection;
	attr(name: string, value?: string): string | DomCollection | undefined {
		if (value === undefined) {
			return this.elements[0]?.getAttribute(name) || undefined;
		}
		this.elements.forEach((element) => element.setAttribute(name, value));
		return this;
	}

	removeAttr(name: string): DomCollection {
		this.elements.forEach((element) => element.removeAttribute(name));
		return this;
	}

	text(): string;
	text(value: string): DomCollection;
	text(value?: string): string | DomCollection {
		if (value === undefined) {
			return this.elements.map((element) => element.textContent || '').join('');
		}
		this.elements.forEach((element) => { element.textContent = value; });
		return this;
	}

	css(property: string, value: string): DomCollection {
		this.elements.forEach((element) => {
			(element as HTMLElement).style.setProperty(property, value);
		});
		return this;
	}

	find(selector: string): DomCollection {
		const descendants = this.elements.flatMap((element) =>
			Array.from(element.querySelectorAll(selector)));
		return new DomCollection(Array.from(new Set(descendants)));
	}

	filter(predicate: (index: number, element: Element) => boolean): DomCollection {
		return new DomCollection(this.elements.filter((element, index) => predicate(index, element)));
	}

	closest(selector: string): DomCollection {
		const matches = this.elements
			.map((element) => element.closest(selector))
			.filter((element): element is Element => Boolean(element));
		return new DomCollection(Array.from(new Set(matches)));
	}

	slice(start: number, end?: number): Element[] {
		return this.elements.slice(start, end);
	}
}

function selectDom(selectorOrElements: string | Element | Element[] | DomCollection): DomCollection {
	if (selectorOrElements instanceof DomCollection) {
		return selectorOrElements;
	}
	if (typeof selectorOrElements === 'string') {
		return new DomCollection(Array.from(document.querySelectorAll(selectorOrElements)));
	}
	if (Array.isArray(selectorOrElements)) {
		return new DomCollection(selectorOrElements);
	}
	return new DomCollection([selectorOrElements]);
}

interface EmptyResourceGroup {
	resourceGroup?: string;
	resourceGroupName?: string;
	name?: string;
	rgName?: string;
	id?: string;
	resourceId?: string;
	subscriptionName?: string;
	subscriptionDisplayName?: string;
	subName?: string;
}

interface RbacAssignment {
	principalId: string;
	principalName?: string;
	roleName: string;
}

interface RbacTree {
	data: {
		name: string;
		assignments: RbacAssignment[];
		resourceGroups: { name: string; assignments: RbacAssignment[] }[];
	}[];
	loading?: boolean;
	error?: string;
	tenantId?: string;
	nameResolutionWarning?: string;
}

let emptyResourceGroupCache: { data: EmptyResourceGroup[] } | EmptyResourceGroup[] = { data: [] };
let subscriptionBackgroundRules = [];
let directUserRbacTree: RbacTree = { data: [], loading: true };
let settingsLoaded = false;
const IS_TOP_WINDOW = window === window.top;
const { messages, storageKeys, storageGet, readPortalSettings, escapeHtml } = AzureExtension;
const GUID_PATTERN = new RegExp(`\\b${AzureExtension.guidSource}\\b`, 'i');
const PORTAL_TIMING = {
	telemetryMinIntervalMs: 60 * 1000,
	dataRequestTimeoutMs: 15 * 1000,
	dataRefreshIntervalMs: 30 * 1000,
	uiRefreshIntervalMs: 500,
	settingsRetryIntervalMs: 300,
	privacyRefreshIntervalMs: 2 * 1000,
	highlightDebugIntervalMs: 5 * 1000
} as const;
const MASK_STYLES = { header: 'blur(2px)', identifier: 'blur(4px)' } as const;
let isPortalDataFetchInFlight = false;
let portalDataFetchTimeoutId: ReturnType<typeof setTimeout> | null = null;
let lastHighlightDebugAt = 0;
let telemetryOptIn = false;
let telemetryConsentReady = false;
const telemetryLastSentAt: Record<string, number> = {};

let backgroundPort: chrome.runtime.Port | null = null;
const extensionSettings: PortalSettings = { ...AzureExtension.defaultSettings };
const originalTabIcons = new Map<HTMLLinkElement, { href: string | null; type: string | null; sizes: string | null }>();
let addedTabIcon: HTMLLinkElement | null = null;
let lastTabIconError = '';
const TAB_ICON_SELECTOR = 'link[rel~="icon" i]';
const BLADE_ICON_SELECTOR = '.fxs-blade-title-icon, .fxs-blade-title-image, .fxs-blade-header-icon';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const portalSelectors = {
	startboardLayout : 'div.fxs-startboard-layout.fxs-flowlayout',
	homeContainer : 'div.fxs-home-container.fxs-portal-text',
	accountName : 'div.fxs-avatarmenu-username',
	tenantName : 'div.fxs-avatarmenu-tenant',
	resourceGroupUrls : [
		'resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups',
		'view/HubsExtension/BrowseResourceGroups'
	],
	resourceGroupName : 'div.fxc-gc-row-content a:nth-child(2)'
};

async function loadPortalSettings(): Promise<void> {
	const items = await storageGet('sync', null);
	const previouslyShowingRbac = extensionSettings.showDirectUserRbac;
	Object.assign(extensionSettings, readPortalSettings(items));
	settingsLoaded = true;
	updateAzureTabIcon();
	if (!extensionSettings.showDirectUserRbac) {
		document.querySelector('[data-azure-extension-rbac-panel]')?.remove();
	} else if (!previouslyShowingRbac && IS_TOP_WINDOW && isAzurePortalPage()) {
		refreshPortalResourceData();
	}
}

function logSettingsError(error: unknown): void {
	console.warn('[Azure Portal Extension] Unable to load settings:', error);
}

async function loadSubscriptionBackgroundRules(): Promise<void> {
	let items;
	try {
		items = await storageGet('sync', { [storageKeys.subscriptionBackgroundRules]: [] });
	} catch (error) {
		console.warn('[Azure Portal Extension] Sync rules unavailable; reading local rules:', error);
		items = await storageGet('local', { [storageKeys.subscriptionBackgroundRules]: [] });
	}
	subscriptionBackgroundRules = Array.isArray(items[storageKeys.subscriptionBackgroundRules])
		? items[storageKeys.subscriptionBackgroundRules]
		: [];
}

loadPortalSettings().catch(logSettingsError);
loadSubscriptionBackgroundRules().catch(logSettingsError);

storageGet('local', { [storageKeys.emptyResourceGroups]: { data: [] } }).then((items) => {
	emptyResourceGroupCache = items[storageKeys.emptyResourceGroups] || { data: [] };
}).catch(logSettingsError);

storageGet('local', { [storageKeys.telemetryOptIn]: false }).then((items) => {
	telemetryOptIn = Boolean(items[storageKeys.telemetryOptIn]);
	telemetryConsentReady = true;
}).catch(logSettingsError);

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === 'local' && changes[storageKeys.emptyResourceGroups]) {
		storageGet('local', { [storageKeys.emptyResourceGroups]: { data: [] } })
			.then((items) => { emptyResourceGroupCache = items[storageKeys.emptyResourceGroups]; })
			.catch(logSettingsError);
	}
	if (areaName === 'local' && changes[storageKeys.telemetryOptIn]) {
		telemetryOptIn = Boolean(changes[storageKeys.telemetryOptIn].newValue);
		telemetryConsentReady = true;
	}
	if (areaName === 'sync' && changes[storageKeys.subscriptionBackgroundRules]) {
		const updatedRules = changes[storageKeys.subscriptionBackgroundRules].newValue;
		subscriptionBackgroundRules = Array.isArray(updatedRules)
			? updatedRules
			: [];
	}
	if (areaName === 'local' && changes[storageKeys.subscriptionBackgroundRules]) {
		const updatedRules = changes[storageKeys.subscriptionBackgroundRules].newValue;
		subscriptionBackgroundRules = Array.isArray(updatedRules)
			? updatedRules
			: [];
	}
	if (areaName === 'sync') {
		const keys = Object.keys(extensionSettings);
		if (keys.some((key: keyof PortalSettings) => {
			const alias = AzureExtension.legacySettingKeys[key];
			return changes[key] || (alias && changes[alias]);
		})) {
			loadPortalSettings().catch(logSettingsError);
		}
	}
});

function emitFeatureUseTelemetry(featureName) {
	if (!telemetryConsentReady || telemetryOptIn !== true) {
		return;
	}

	const now = Date.now();
	const lastAt = telemetryLastSentAt[featureName] || 0;
	if (now - lastAt < PORTAL_TIMING.telemetryMinIntervalMs) {
		return;
	}

	telemetryLastSentAt[featureName] = now;
	AzureExtension.sendRuntimeMessage({
		name: messages.featureUse,
		featureName,
		count: 1
	}).catch((error: unknown) => {
		console.debug('[Azure Portal Extension] Unable to report feature usage:', error);
	});
}

function onPortDisconnected() {
	backgroundPort = null;
	isPortalDataFetchInFlight = false;
	if (portalDataFetchTimeoutId) {
		clearTimeout(portalDataFetchTimeoutId);
		portalDataFetchTimeoutId = null;
	}
}

function onPortMessage(response) {
	if(response.name === messages.subscriptionsResult){
		if (response.subscriptions){
			try {
				if (backgroundPort) {
					backgroundPort.postMessage({name: messages.getEmptyResourceGroups});
					if (isAzurePortalPage() && extensionSettings.showDirectUserRbac) {
						directUserRbacTree = { data: [], loading: true };
						renderDirectUserRbacTree();
						backgroundPort.postMessage({name: messages.getDirectUserRbac});
					}
				}
			} catch (error) {
				console.warn('[Azure Portal Extension] Unable to request portal data:', error);
				onPortDisconnected();
			}
		}else if(response.error){
			if (portalDataFetchTimeoutId) {
				clearTimeout(portalDataFetchTimeoutId);
				portalDataFetchTimeoutId = null;
			}
			console.warn('[Azure Portal Extension] Unable to load portal data:', response.error);
			directUserRbacTree = { data: [], error: response.error };
			renderDirectUserRbacTree();
			isPortalDataFetchInFlight = false;
		}
	}else if(response.name === messages.getEmptyResourceGroups){
		if (portalDataFetchTimeoutId) {
			clearTimeout(portalDataFetchTimeoutId);
			portalDataFetchTimeoutId = null;
		}
		emptyResourceGroupCache = response.emptyResourceGroups || { data: [] };
		AzureExtension.storageSet('local', { [storageKeys.emptyResourceGroups]: emptyResourceGroupCache })
			.catch(logSettingsError);
		isPortalDataFetchInFlight = false;
	}else if(response.name === messages.getDirectUserRbac){
		directUserRbacTree = response.rbacTree || { data: [] };
		directUserRbacTree.loading = false;
		if (response.error) {
			directUserRbacTree.error = response.error;
		}
		renderDirectUserRbacTree();
	}
}

function ensureBackgroundPortConnected() {
	if (backgroundPort) {
		return true;
	}

	try {
		backgroundPort = chrome.runtime.connect({ name: AzureExtension.backgroundPortName });
		backgroundPort.onMessage.addListener(onPortMessage);
		backgroundPort.onDisconnect.addListener(onPortDisconnected);
		return true;
	} catch (error) {
		console.warn('[Azure Portal Extension] Unable to connect to background worker:', error);
		backgroundPort = null;
		return false;
	}
}

function refreshPortalResourceData() {
	if (!IS_TOP_WINDOW || isPortalDataFetchInFlight) {
		return;
	}
	if (!ensureBackgroundPortConnected()) {
		return;
	}
	isPortalDataFetchInFlight = true;
	if (portalDataFetchTimeoutId) {
		clearTimeout(portalDataFetchTimeoutId);
	}
	portalDataFetchTimeoutId = setTimeout(() => {
		isPortalDataFetchInFlight = false;
		console.warn('[Azure Portal Extension] Portal data request timed out.');
	}, PORTAL_TIMING.dataRequestTimeoutMs);
	try {
		backgroundPort.postMessage({name: messages.getSubscriptions});
	} catch (error) {
		console.warn('[Azure Portal Extension] Unable to refresh portal data:', error);
		onPortDisconnected();
	}
}

function getCurrentSubscriptionId(): string {
	let subscriptionId = '';
	const subscriptionScopePattern = new RegExp(`/subscriptions/(${AzureExtension.guidSource})`, 'i');
	const candidates = [window.location.href];
	querySelectorAllDeep('a[href], [data-subscription-id]').each((_index, element) => {
		candidates.push(
			element.getAttribute('href') || element.getAttribute('data-subscription-id') || ''
		);
	});
	for (const candidate of candidates) {
		const scopedMatch = candidate.match(subscriptionScopePattern);
		if (scopedMatch?.[1]) {
			subscriptionId = scopedMatch[1].toLowerCase();
			break;
		}
	}
	if (!subscriptionId) {
		for (const candidate of candidates) {
			const match = candidate.match(GUID_PATTERN);
			if (match?.[0]) {
				subscriptionId = match[0].toLowerCase();
				break;
			}
		}
	}
	return subscriptionId;
}

function getEffectiveBackgroundSettings(): { imageUrl: string | null; opacity: number } {
	const subscriptionId = getCurrentSubscriptionId();
	const rule = subscriptionBackgroundRules.find((candidate) =>
		String(candidate?.subscriptionId || '').toLowerCase() === subscriptionId
	);
	if (rule) {
		return {
			imageUrl: rule.imageUrl,
			opacity: Number(rule.opacity)
		};
	}
	return {
		imageUrl: extensionSettings.backgroundImageUrl,
		opacity: Number(extensionSettings.backgroundOpacity)
	};
}

function applyBackgroundImage(): void {
	const background = getEffectiveBackgroundSettings();
	selectDom(`${portalSelectors.startboardLayout}, ${portalSelectors.homeContainer}`)
		.attr('style', `background-image: url('${background.imageUrl}');opacity : ${background.opacity}`);
	if (background.imageUrl) {
		emitFeatureUseTelemetry('background-image');
	}
}

class PortalPageController {
	start(): void {
		if (IS_TOP_WINDOW) {
			ensureBackgroundPortConnected();
			refreshPortalResourceData();
			setInterval(refreshPortalResourceData, PORTAL_TIMING.dataRefreshIntervalMs);
		}
		this.runUiLoop();
	}

	private runUiLoop(): void {
		applyBackgroundImage();
		updateAzureTabIcon();
		if (extensionSettings.highlightEmptyResourceGroups) {
			highlightEmptyResourceGroups();
		}
		renderDirectUserRbacTree();
		setTimeout(() => this.runUiLoop(), PORTAL_TIMING.uiRefreshIntervalMs);
	}
}

new PortalPageController().start();

function normalizeCellText(text, suffix) {
	if (!text) return '';
	let value = text;
	if (suffix) {
		value = value.replace(suffix, '');
	}
	return value.trim().toLowerCase();
}

function querySelectorAllDeep(selector) {
	const results = [];
	const seen = new Set();

	function collectFromRoot(root) {
		if (!root || !root.querySelectorAll) {
			return;
		}

		const matched = root.querySelectorAll(selector);
		for (let i = 0; i < matched.length; i++) {
			const elem = matched[i];
			if (!seen.has(elem)) {
				seen.add(elem);
				results.push(elem);
			}
		}

		const allElems = root.querySelectorAll('*');
		for (let j = 0; j < allElems.length; j++) {
			const host = allElems[j];
			if (host.shadowRoot) {
				collectFromRoot(host.shadowRoot);
			}
		}
	}

	collectFromRoot(document);
	return selectDom(results);
}

function isAzurePortalPage() {
	const host = (window.location && window.location.hostname) ? window.location.hostname : '';
	const href = (window.location && window.location.href) ? window.location.href : '';
	return (
		/(^|\.)portal\.azure\.com$/i.test(host) ||
		/(^|\.)reactblade\.portal\.azure\.net$/i.test(host) ||
		/(^|\.)reactblade-ms\.portal\.azure\.net$/i.test(host) ||
		/(^|\.)reactblade-rc\.portal\.azure\.net$/i.test(host)
	) && href.indexOf('/auth/login') === -1;
}

function restorePortalTabIcon(): void {
	addedTabIcon?.remove();
	addedTabIcon = null;
	for (const [link, attributes] of originalTabIcons) {
		for (const [name, value] of Object.entries(attributes)) {
			if (value === null) link.removeAttribute(name);
			else link.setAttribute(name, value);
		}
	}
	originalTabIcons.clear();
}

function resolveTabIconUrl(value: string): string {
	const url = new URL(value, document.baseURI);
	if (url.protocol !== 'https:' && url.protocol !== 'blob:' &&
		!(url.protocol === 'data:' && url.pathname.startsWith('image/'))) {
		throw new Error(`Unsupported tab icon URL protocol: ${url.protocol}`);
	}
	return url.href;
}

function serializeBladeSvg(source: SVGSVGElement): string {
	const svg = source.cloneNode(true) as SVGSVGElement;
	const definitions = document.createElementNS(SVG_NAMESPACE, 'defs');
	const referencedIds = new Set<string>();
	svg.setAttribute('xmlns', SVG_NAMESPACE);
	svg.setAttribute('width', '32');
	svg.setAttribute('height', '32');

	function includeReference(value: string): string {
		const url = new URL(value, document.baseURI);
		const page = new URL(document.baseURI);
		if (!url.hash || url.origin !== page.origin || url.pathname !== page.pathname || url.search !== page.search) {
			throw new Error('External SVG sprites are not supported for Azure Tab Icon.');
		}
		const id = decodeURIComponent(url.hash.slice(1));
		if (!referencedIds.has(id)) {
			referencedIds.add(id);
			if (!svg.querySelector(`[id="${CSS.escape(id)}"]`)) {
				const definition = document.getElementById(id);
				if (!definition) throw new Error(`Missing SVG icon definition: ${id}`);
				const clone = definition.cloneNode(true) as Element;
				definitions.appendChild(clone);
				prepareElements(definition, clone);
				if (!svg.hasAttribute('viewBox') && definition.hasAttribute('viewBox')) {
					svg.setAttribute('viewBox', definition.getAttribute('viewBox')!);
				}
			}
		}
		return `#${id}`;
	}

	function prepareElements(original: Element, clone: Element): void {
		const originals = [original, ...Array.from(original.querySelectorAll('*'))];
		const clones = [clone, ...Array.from(clone.querySelectorAll('*'))];
		originals.forEach((element, index) => {
			const target = clones[index];
			if (['script', 'foreignObject', 'style'].includes(element.localName)) {
				target.remove();
				return;
			}
			for (const attribute of Array.from(target.attributes)) {
				if (attribute.name.toLowerCase().startsWith('on')) target.removeAttribute(attribute.name);
			}
			const style = window.getComputedStyle(element);
			for (const property of ['fill', 'stroke', 'color', 'fill-opacity', 'stroke-opacity', 'stroke-width']) {
				const value = style.getPropertyValue(property);
				if (value) target.setAttribute(property, value.replace(/url\(["']?([^)"']+)["']?\)/g,
					(_match, reference: string) => `url(${includeReference(reference)})`));
			}
			const href = element.getAttribute('href') || element.getAttribute('xlink:href');
			if (href) {
				target.removeAttribute('xlink:href');
				target.setAttribute('href', element.localName === 'use' ? includeReference(href) : resolveTabIconUrl(href));
			}
			for (const name of ['clip-path', 'mask', 'filter']) {
				const value = element.getAttribute(name);
				if (value) target.setAttribute(name, value.replace(/url\(["']?([^)"']+)["']?\)/g,
					(_match, reference: string) => `url(${includeReference(reference)})`));
			}
		});
	}

	prepareElements(source, svg);
	svg.prepend(definitions);
	if (!svg.hasAttribute('viewBox')) {
		const bounds = source.getBoundingClientRect();
		svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
	}
	return `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
}

function getBladeTabIcon(): string | null {
	const icons = Array.from(document.querySelectorAll<Element>(BLADE_ICON_SELECTOR));
	const icon = icons.reverse().find((element) =>
		!element.closest('[hidden], [aria-hidden="true"]') &&
		element.getClientRects().length > 0 &&
		window.getComputedStyle(element).visibility !== 'hidden');
	if (!icon) return null;
	const image = icon instanceof HTMLImageElement ? icon : icon.querySelector<HTMLImageElement>('img');
	if (image) {
		const src = image.currentSrc || image.getAttribute('src');
		if (src) return resolveTabIconUrl(src);
	}
	const svg = icon instanceof SVGSVGElement ? icon : icon.querySelector<SVGSVGElement>('svg');
	if (svg) return serializeBladeSvg(svg);
	const background = window.getComputedStyle(icon).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);
	return background ? resolveTabIconUrl(background[1]) : null;
}

function updateAzureTabIcon(): void {
	if (!IS_TOP_WINDOW) return;
	if (!extensionSettings.azureTabIcon || !isAzurePortalPage()) {
		restorePortalTabIcon();
		return;
	}
	try {
		const href = getBladeTabIcon();
		if (!href || !document.head) {
			restorePortalTabIcon();
			return;
		}
		let links = Array.from(document.querySelectorAll<HTMLLinkElement>(TAB_ICON_SELECTOR))
			.filter((link) => link !== addedTabIcon);
		if (links.length === 0) {
			if (!addedTabIcon) {
				addedTabIcon = document.createElement('link');
				addedTabIcon.rel = 'icon';
				document.head.appendChild(addedTabIcon);
			}
			links = [addedTabIcon];
		} else {
			addedTabIcon?.remove();
			addedTabIcon = null;
		}
		for (const link of links) {
			if (link !== addedTabIcon && !originalTabIcons.has(link)) {
				originalTabIcons.set(link, {
					href: link.getAttribute('href'), type: link.getAttribute('type'), sizes: link.getAttribute('sizes')
				});
			}
			if (link.getAttribute('href') !== href) link.setAttribute('href', href);
			// Original type/size hints may prevent Chromium from selecting the new icon.
			link.removeAttribute('type');
			link.removeAttribute('sizes');
		}
		lastTabIconError = '';
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message !== lastTabIconError) {
			console.warn('[Azure Portal Extension] Unable to update Azure Tab Icon:', error);
			lastTabIconError = message;
		}
		restorePortalTabIcon();
	}
}

function renderRbacAssignments(assignments) {
	const byPrincipal = {};
	(assignments || []).forEach((assignment) => {
		const principalName = assignment.principalName || assignment.principalId;
		if (!byPrincipal[principalName]) {
			byPrincipal[principalName] = [];
		}
		if (!byPrincipal[principalName].includes(assignment.roleName)) {
			byPrincipal[principalName].push(assignment.roleName);
		}
	});

	return Object.keys(byPrincipal).sort().map((principalName) =>
		'<li><strong>' + escapeHtml(principalName) + '</strong> - ' +
		byPrincipal[principalName].sort().map(escapeHtml).join(', ') + '</li>'
	).join('');
}

function renderDirectUserRbacTree() {
	if (!IS_TOP_WINDOW || !isAzurePortalPage() ||
		extensionSettings.showDirectUserRbac === false) {
		const panel = document.querySelector('[data-azure-extension-rbac-panel]');
		if (panel) {
			panel.remove();
		}
		return;
	}

	let panel = document.querySelector<HTMLElement>('[data-azure-extension-rbac-panel]');
	if (!panel) {
		panel = document.createElement('aside');
		panel.setAttribute('data-azure-extension-rbac-panel', 'true');
		const header = document.createElement('div');
		header.setAttribute('data-azure-extension-rbac-header', 'true');

		const title = document.createElement('span');
		title.textContent = 'Direct user RBAC';
		header.appendChild(title);

		const toggleButton = document.createElement('button');
		toggleButton.type = 'button';
		toggleButton.textContent = 'Hide details';
		header.appendChild(toggleButton);

		const body = document.createElement('div');
		body.setAttribute('data-azure-extension-rbac-body', 'true');
		toggleButton.addEventListener('click', (event) => {
			event.stopPropagation();
			const isHidden = body.hidden;
			body.hidden = !isHidden;
			toggleButton.textContent = isHidden ? 'Hide details' : 'Show details';
		});

		let dragState = null;
		header.addEventListener('mousedown', (event) => {
			if (event.target === toggleButton) {
				return;
			}
			const rect = panel.getBoundingClientRect();
			dragState = {
				offsetX: event.clientX - rect.left,
				offsetY: event.clientY - rect.top
			};
			panel.style.right = 'auto';
			document.body.style.userSelect = 'none';
			event.preventDefault();
		});
		document.addEventListener('mousemove', (event) => {
			if (!dragState) {
				return;
			}
			panel.style.left = Math.max(0, event.clientX - dragState.offsetX) + 'px';
			panel.style.top = Math.max(0, event.clientY - dragState.offsetY) + 'px';
		});
		document.addEventListener('mouseup', () => {
			if (dragState) {
				dragState = null;
				document.body.style.userSelect = '';
			}
		});

		panel.appendChild(header);
		panel.appendChild(body);
		document.body.appendChild(panel);
	}

	const data = Array.isArray(directUserRbacTree?.data)
		? directUserRbacTree.data
		: [];
	const treeHtml = directUserRbacTree?.loading
		? '<p>Loading direct user RBAC assignments for Subscription and Resource Group scopes...</p>' +
			'<p style="font-size:12px;color:#8a6d1d">Note: If user names or role assignments are not displayed, add User.ReadBasic.All as a Microsoft Graph delegated API permission to the App registration, grant admin consent, and sign in again.</p>'
		: directUserRbacTree?.error
		? '<p style="color:#a4262c">Unable to load direct user RBAC assignments: ' +
			escapeHtml(directUserRbacTree.error) + '</p>'
		: data.length === 0
		? '<p>No direct user RBAC assignments were found at Subscription or Resource Group scope.</p>'
		: data.map((subscription) => {
			const subscriptionAssignments = renderRbacAssignments(subscription.assignments);
			const resourceGroups = (subscription.resourceGroups || []).map((resourceGroup) =>
				'<li><strong>Resource Group: ' + escapeHtml(resourceGroup.name) + '</strong>' +
				'<ul>' + renderRbacAssignments(resourceGroup.assignments) + '</ul></li>'
			).join('');
			const children = (subscriptionAssignments
				? '<li><strong>Subscription scope</strong><ul>' + subscriptionAssignments + '</ul></li>'
				: '') + resourceGroups;
			return '<li><strong>Subscription: ' + escapeHtml(subscription.name) + '</strong>' +
				'<ul>' + children + '</ul>' +
				'</li>';
		}).join('');

	const body = panel.querySelector('[data-azure-extension-rbac-body]');
	body.innerHTML =
		'<div style="font-size:12px;color:#605e5c;margin-bottom:10px">Tenant: ' +
		escapeHtml(directUserRbacTree?.tenantId || 'current tenant') + '</div>' +
		'<div style="font-size:12px;color:#605e5c;margin-bottom:10px">' +
		'Direct assignments only; inherited roles, groups, service principals, managed identities, Lighthouse, and resource-level roles are excluded.</div>' +
		'<ul style="padding-left:20px;margin:0">' + treeHtml + '</ul>' +
		(directUserRbacTree?.nameResolutionWarning
			? '<p style="font-size:12px;color:#a4262c;margin-bottom:0">' +
				escapeHtml(directUserRbacTree.nameResolutionWarning) + '</p>'
			: '');
}

function normalizeResourceGroupName(text) {
	if (!text) return '';
	return text.trim().toLowerCase();
}

function canonicalizeName(text) {
	if (!text) {
		return '';
	}
	return text
		.toLowerCase()
		.replace(/\s+/g, '')
		.replace(/[^a-z0-9_-]/g, '');
}

function isLikelySameResourceGroupName(candidate, rgName) {
	const candidateCanonical = canonicalizeName(candidate);
	const rgCanonical = canonicalizeName(rgName);
	if (!candidateCanonical || !rgCanonical) {
		return false;
	}
	if (candidateCanonical === rgCanonical) {
		return true;
	}
	return candidateCanonical.indexOf(rgCanonical) !== -1 || rgCanonical.indexOf(candidateCanonical) !== -1;
}

function extractResourceGroupNameFromHref(href) {
	if (!href) {
		return '';
	}
	const match = href.match(/\/resourceGroups\/([^/?#]+)/i);
	if (!match || !match[1]) {
		return '';
	}
	try {
		return decodeURIComponent(match[1]).trim().toLowerCase();
	} catch (e) {
		return match[1].trim().toLowerCase();
	}
}

function toLowerSafe(value) {
	if (value === null || value === undefined) {
		return '';
	}
	return String(value).trim().toLowerCase();
}

function normalizeEmptyResourceGroupEntry(item) {
	const rgFromFields =
		toLowerSafe(item && item.resourceGroup) ||
		toLowerSafe(item && item.resourceGroupName) ||
		toLowerSafe(item && item.name) ||
		toLowerSafe(item && item.rgName);

	const rgFromId = extractResourceGroupNameFromHref((item && item.id) || (item && item.resourceId) || '');
	const rgName = rgFromFields || rgFromId;

	const subName =
		toLowerSafe(item && item.subscriptionName) ||
		toLowerSafe(item && item.subscriptionDisplayName) ||
		toLowerSafe(item && item.subName);

	return { rgName, subName };
}

function isResourceGroupsPage() {
	const href = (window.location && window.location.href) ? window.location.href : '';
	if (
		href.indexOf('/resourcegroups') !== -1 ||
		portalSelectors.resourceGroupUrls.some((route) => href.includes(route))
	) {
		return true;
	}

	const rgLinks = querySelectorAllDeep(
		'a[href*="/resourceGroups/"], a.ext-hubs-browse-resource-link, ' +
		'div.ms-DetailsRow-fields > div:nth-child(1) a, div[id^="row"] div.ms-DetailsRow-fields a'
	);
	if (rgLinks.length > 0) {
		return true;
	}
	return querySelectorAllDeep('div.ms-DetailsRow-fields, div[id^="row"]').length > 0;
}

function highlightResourceGroupElement(targetElem, rgName, highlightSuffix) {
	if (!targetElem || targetElem.length === 0) {
		return false;
	}

	const alreadyMarked = targetElem.attr('data-empty-rg-highlighted') === rgName;

	const latestText = targetElem.text();
	if (!latestText) {
		return false;
	}

	if(highlightSuffix && latestText.indexOf(highlightSuffix) === -1){
		targetElem.text(latestText + highlightSuffix);
	}
	const elem = targetElem.get(0);
	if (elem && elem.style) {
		elem.style.setProperty('color', extensionSettings.emptyResourceGroupColor, 'important');
		elem.style.setProperty('font-weight', '700', 'important');
		elem.style.setProperty('text-decoration', 'underline', 'important');
	}
	const parentCell = targetElem.closest('[role="gridcell"], td, .ms-DetailsRow-cell');
	if (parentCell.length > 0) {
		const cell = parentCell.get(0);
		if (cell && cell.style) {
			cell.style.setProperty('background-color', 'rgba(255, 234, 112, 0.22)', 'important');
			cell.style.setProperty('border-left', '3px solid ' + extensionSettings.emptyResourceGroupColor, 'important');
		}
	}
	targetElem.attr('data-empty-rg-highlighted', rgName);
	return !alreadyMarked || Boolean(elem?.style);
}

function highlightResourceGroupCandidates(emptyRgData, highlightSuffix) {
	const rgNameSet = {};
	emptyRgData.forEach(item => {
		rgNameSet[item.rgName] = true;
	});
	const rgNames = Object.keys(rgNameSet);

	const candidates = querySelectorAllDeep('a, [role="link"], div[role="gridcell"], span[role="gridcell"], td');
	let highlightedCount = 0;

	candidates.each((index, elem) => {
		const cellElem = selectDom(elem);
		const cellText = normalizeCellText(cellElem.text(), highlightSuffix);
		const hrefName = extractResourceGroupNameFromHref(cellElem.attr('href'));

		let matchedRgName = '';
		if (hrefName && rgNameSet[hrefName]) {
			matchedRgName = hrefName;
		} else {
			for (let i = 0; i < rgNames.length; i++) {
				if (isLikelySameResourceGroupName(cellText, rgNames[i])) {
					matchedRgName = rgNames[i];
					break;
				}
			}
		}

		if (!matchedRgName) {
			return;
		}

		const currentMarker = cellElem.attr('data-empty-rg-highlighted');
		if (currentMarker === matchedRgName) {
			return;
		}

		if (highlightResourceGroupElement(cellElem, matchedRgName, highlightSuffix)) {
			highlightedCount++;
		}
	});

	return {
		highlightedCount,
		candidateCount: candidates.length
	};
}

function highlightEmptyResourceGroupText(emptyRgData, highlightSuffix) {
	let highlightedCount = 0;
	const visitedRoots = new Set<Node>();

	function scanRoot(root) {
		if (!root || visitedRoots.has(root)) {
			return;
		}
		visitedRoots.add(root);
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const textNodes = [];
		let textNode = walker.nextNode();
		while (textNode) {
			textNodes.push(textNode);
			textNode = walker.nextNode();
		}

		textNodes.forEach((node) => {
			const parent = node.parentElement;
			const text = (node.nodeValue || '').toLowerCase();
			if (!parent || !text || parent.closest('script, style, textarea')) {
				return;
			}
			const matched = emptyRgData.find((item) => text.includes(item.rgName));
			if (!matched) {
				return;
			}
			const target = parent.closest('a, [role="gridcell"], td') || parent;
			if (highlightResourceGroupElement(selectDom(target), matched.rgName, highlightSuffix)) {
				highlightedCount++;
			}
		});

		const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
		for (let i = 0; i < elements.length; i++) {
			if (elements[i].shadowRoot) {
				scanRoot(elements[i].shadowRoot);
			}
		}
	}

	scanRoot(document);
	return highlightedCount;
}

function highlightEmptyResourceGroups(){
	const hasResourceGroupRows = querySelectorAllDeep(
		'div.ms-DetailsRow-fields a, div[id^="row"] a'
	).length > 0;
	if (!isResourceGroupsPage() && !hasResourceGroupRows) {
		return;
	}

	// pick up top element of resource group list, and use fallback for portal DOM changes
	let resourceGroupRows = querySelectorAllDeep(
		'div.fxc-gc-rows div.fxc-gc-row, div[role="row"], tr, div[id^="row"]'
	);
	if(resourceGroupRows.length === 0){
		resourceGroupRows = querySelectorAllDeep("div[role='row']");
	}
	const rawEmptyRgData = Array.isArray(emptyResourceGroupCache)
		? emptyResourceGroupCache
		: emptyResourceGroupCache.data;
	const emptyRgData = rawEmptyRgData
		.map(item => normalizeEmptyResourceGroupEntry(item))
		.filter(item => item.rgName);
	const emptyRgNameSet = {};
	emptyRgData.forEach(item => {
		emptyRgNameSet[item.rgName] = true;
	});
	const highlightSuffix = extensionSettings.emptyResourceGroupSuffix || '';

	if(emptyRgData.length === 0){
		const now = Date.now();
		if (now - lastHighlightDebugAt > PORTAL_TIMING.highlightDebugIntervalMs) {
			console.log('[Azure Portal Extension] highlight-scan skipped: empty cache data, href=', window.location.href);
			lastHighlightDebugAt = now;
		}
		return;
	}

	let highlightedCount = 0;
	let usedFallback = false;
	let fallbackCandidateCount = 0;

	const directRgLinks = querySelectorAllDeep(
		'a.ext-hubs-browse-resource-link, a[href*="/resourceGroups/"], ' +
		'div.ms-DetailsRow-fields > div:nth-child(1) a, div[id^="row"] div.ms-DetailsRow-fields a'
	);
	directRgLinks.each((index, elem) => {
		const linkElem = selectDom(elem);
		const rgByText = normalizeResourceGroupName(normalizeCellText(linkElem.text(), highlightSuffix));
		const rgByHref = extractResourceGroupNameFromHref(linkElem.attr('href'));
		const rgName = rgByText || rgByHref;
		if (!rgName || !emptyRgNameSet[rgName]) {
			return;
		}
		if (highlightResourceGroupElement(linkElem, rgName, highlightSuffix)) {
			highlightedCount++;
		}
	});

	if (resourceGroupRows.length === 0 || highlightedCount === 0) {
		const fallbackResult = highlightResourceGroupCandidates(emptyRgData, highlightSuffix);
		highlightedCount += fallbackResult.highlightedCount;
		fallbackCandidateCount = fallbackResult.candidateCount;
		usedFallback = true;
	}
	if (highlightedCount === 0) {
		highlightedCount += highlightEmptyResourceGroupText(emptyRgData, highlightSuffix);
		usedFallback = true;
	}

	resourceGroupRows.each( (index, elem) => {
		const rowElem = selectDom(elem);
		const rowText = rowElem.text().toLowerCase();
		if(!rowText){
			return;
		}

		let matchedRow = null;
		for (let i = 0; i < emptyRgData.length; i++) {
			if (
				rowText.indexOf(emptyRgData[i].rgName) !== -1 &&
				(!emptyRgData[i].subName || rowText.indexOf(emptyRgData[i].subName) !== -1)
			) {
				matchedRow = emptyRgData[i];
				break;
			}
		}
		if (!matchedRow) {
			for (let j = 0; j < emptyRgData.length; j++) {
				if (rowText.indexOf(emptyRgData[j].rgName) !== -1) {
					matchedRow = emptyRgData[j];
					break;
				}
			}
		}
		if (!matchedRow) {
			return;
		}

		let resourceGroupElem = rowElem.find(portalSelectors.resourceGroupName).first();
		if(resourceGroupElem.length === 0){
			resourceGroupElem = rowElem.find('a').first();
		}
		if(resourceGroupElem.length === 0){
			resourceGroupElem = rowElem.find('span, div').filter((idx, cell) => {
				const cellText = normalizeCellText(selectDom(cell).text(), highlightSuffix);
				return cellText === matchedRow.rgName;
			}).first();
		}

		const currentText = resourceGroupElem.text();
		if(!currentText){
			return;
		}

		const sameNameLink = rowElem.find('a').filter((idx, link) => {
			const cellText = normalizeCellText(selectDom(link).text(), highlightSuffix);
			return cellText === matchedRow.rgName;
		}).first();
		if(sameNameLink.length > 0){
			resourceGroupElem = sameNameLink;
		}

		if (highlightResourceGroupElement(resourceGroupElem, matchedRow.rgName, highlightSuffix)) {
			highlightedCount++;
		}
	});

	const now = Date.now();
	if (now - lastHighlightDebugAt > PORTAL_TIMING.highlightDebugIntervalMs) {
		let sampleCandidates = [];
		if (highlightedCount === 0 && usedFallback && fallbackCandidateCount > 0) {
			const sampleElems = querySelectorAllDeep('a, [role="link"], [role="gridcell"]');
			sampleCandidates = sampleElems
				.slice(0, 8)
				.map(elem => {
					const e = selectDom(elem);
					return {
						text: normalizeCellText(e.text(), highlightSuffix),
						href: e.attr('href') || ''
					};
				})
				.filter(x => x.text || x.href);
		}
		console.log('[Azure Portal Extension] highlight-scan', {
			href: window.location.href,
			isTopFrame: window === window.top,
			rows: resourceGroupRows.length,
			emptyRgCount: emptyRgData.length,
			highlightedCount: highlightedCount,
			usedFallback: usedFallback,
			fallbackCandidateCount: fallbackCandidateCount,
			targetRgNames: emptyRgData.map(x => x.rgName).slice(0, 5),
			sampleCandidates: sampleCandidates
		});
		lastHighlightDebugAt = now;
	}

	if (highlightedCount > 0) {
		emitFeatureUseTelemetry('highlight-empty-resourcegroups');
	}
}

function maskSubscriptionIdentifiers() {
	const maskAttribute = 'data-my-azure-portal-subscription-id-mask';
	if (extensionSettings.maskSubscriptionIds !== true) {
		const previouslyMasked = querySelectorAllDeep('[' + maskAttribute + ']');
		previouslyMasked.each(function() {
			const elem = this;
			if (elem.tagName === 'SPAN') {
				elem.replaceWith(document.createTextNode(elem.textContent || ''));
			} else {
				selectDom(elem).css('filter', '').removeAttr(maskAttribute);
			}
		});
		return;
	}

	const subscriptionIdPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
	let maskedCount = 0;

	function maskTextNodes(root) {
		const textNodes = [];
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let textNode = walker.nextNode();
		while (textNode) {
			const parent = textNode.parentElement;
			if (
				parent &&
				!parent.closest('script, style, textarea, [' + maskAttribute + ']') &&
				subscriptionIdPattern.test(textNode.nodeValue || '')
			) {
				textNodes.push(textNode);
			}
			subscriptionIdPattern.lastIndex = 0;
			textNode = walker.nextNode();
		}

		textNodes.forEach(function(node) {
			const value = node.nodeValue || '';
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			let match = subscriptionIdPattern.exec(value);

			while (match) {
				fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
				const maskedSpan = document.createElement('span');
				maskedSpan.setAttribute(maskAttribute, 'true');
				maskedSpan.style.display = 'inline-block';
				maskedSpan.style.filter = MASK_STYLES.identifier;
				maskedSpan.textContent = match[0];
				fragment.appendChild(maskedSpan);
				lastIndex = match.index + match[0].length;
				maskedCount++;
				match = subscriptionIdPattern.exec(value);
			}
			subscriptionIdPattern.lastIndex = 0;
			fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
			node.replaceWith(fragment);
		});

		const allElems = root.querySelectorAll ? root.querySelectorAll('*') : [];
		for (let i = 0; i < allElems.length; i++) {
			if (allElems[i].shadowRoot) {
				maskTextNodes(allElems[i].shadowRoot);
			}
		}
	}

	maskTextNodes(document);

	querySelectorAllDeep('input, textarea').each(function() {
		const elem = this;
		if (!elem.hasAttribute(maskAttribute) && subscriptionIdPattern.test(elem.value || '')) {
			selectDom(elem).attr(maskAttribute, 'true').css('filter', MASK_STYLES.identifier);
			maskedCount++;
		}
		subscriptionIdPattern.lastIndex = 0;
	});

	if (maskedCount > 0) {
		emitFeatureUseTelemetry('mask-subscription-id');
	}
}

function applyPrivacyMasksLoop() {
	if(!settingsLoaded){
		setTimeout( () => applyPrivacyMasksLoop(), PORTAL_TIMING.settingsRetryIntervalMs);
		return;
	}

	const accountNameElement = selectDom(portalSelectors.accountName);
	const tenantElem = selectDom(portalSelectors.tenantName);

	if(extensionSettings.maskAccountName == true){
		accountNameElement.css('filter', MASK_STYLES.header);
		if (accountNameElement.length > 0) {
			emitFeatureUseTelemetry('mask-username');
		}
	}else{
		accountNameElement.css('filter','');
	}

	if(extensionSettings.maskTenantName == true){
		selectDom(tenantElem).css('filter', MASK_STYLES.header);
		if (tenantElem.length > 0) {
			emitFeatureUseTelemetry('mask-tenant');
		}
	}else{
		selectDom(tenantElem).css('filter','');
	}

	maskSubscriptionIdentifiers();

	setTimeout( () => applyPrivacyMasksLoop(), PORTAL_TIMING.privacyRefreshIntervalMs);
}
applyPrivacyMasksLoop();
