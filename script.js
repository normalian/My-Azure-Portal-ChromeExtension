'use strict';

console.log('[Azure Portal Extension] start script.js');

var emptyResourcegroups = []; // avoid reference exception on showMessageOnAzurePortalTopLoop() when it's initiating
var directUserRbacTree = { data: [], loading: true };
var isSettingsLoaded = false;
const IS_TOP_WINDOW = window === window.top;
const EMPTY_RG_CACHE_KEY = 'emptyResourcegroupsCache';
const TELEMETRY_OPT_IN_KEY = 'telemetryOptIn';
const TELEMETRY_MIN_INTERVAL_MS = 60 * 1000;
var isEmptyRgFetchInFlight = false;
var emptyRgFetchTimeoutId = null;
var rbacFetchInFlight = false;
var lastHighlightDebugAt = 0;
var telemetryOptIn = false;
var telemetryConsentReady = false;
var telemetryLastSentAt = {};

var port = null;
const MYEXTENSION_SETTINGS = {
  imgUrl : null,
  opacity : 0.8,
  isUsernameBluer : false,
  isAADTenantBluer : false,
  isHighlightEmptyRG : false,
  isShowDirectUserRbac : true,
  addText : " - @@empty@@",
	color : "#ffff00"
};

const APP_CONST_VALUES = {
	SELECT_STARTBOARD_LAYOUT : 'div.fxs-startboard-layout.fxs-flowlayout',
	SELECT_HOME_CONTAINER : 'div.fxs-home-container.fxs-portal-text',
	SELECT_USERNAME : 'div.fxs-avatarmenu-username',
	SELECT_TENANTNAME : 'div.fxs-avatarmenu-tenant',
	RG_URLS : [
		'resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups',
		'view/HubsExtension/BrowseResourceGroups'
	],
	SELECT_RGNAME : 'div.fxc-gc-row-content a:nth-child(2)',
	SELECT_SUBNAME : 'div.fxc-gc-row-content a:nth-child(1)',
	SELECT_RGLIST : 'div.fxc-gc-rows div.fxc-gc-row'
};

// read user setup info and setup wallpaper
chrome.storage.sync.get(
	MYEXTENSION_SETTINGS,
	function(items) {
		MYEXTENSION_SETTINGS.color = items.color;
		MYEXTENSION_SETTINGS.addText = items.addText;
		MYEXTENSION_SETTINGS.imgUrl = items.imgUrl;
		MYEXTENSION_SETTINGS.opacity = items.opacity;
		MYEXTENSION_SETTINGS.isUsernameBluer = items.isUsernameBluer;
		MYEXTENSION_SETTINGS.isAADTenantBluer = items.isAADTenantBluer;
		MYEXTENSION_SETTINGS.isHighlightEmptyRG = items.isHighlightEmptyRG;
		MYEXTENSION_SETTINGS.isShowDirectUserRbac = items.isShowDirectUserRbac;
		isSettingsLoaded = true;
	}
);

chrome.storage.local.get({ [EMPTY_RG_CACHE_KEY]: { data: [] } }, function(items) {
	emptyResourcegroups = items[EMPTY_RG_CACHE_KEY] || { data: [] };
});

chrome.storage.local.get({ [TELEMETRY_OPT_IN_KEY]: false }, function(items) {
	telemetryOptIn = Boolean(items[TELEMETRY_OPT_IN_KEY]);
	telemetryConsentReady = true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === 'local' && changes[EMPTY_RG_CACHE_KEY]) {
		emptyResourcegroups = changes[EMPTY_RG_CACHE_KEY].newValue || { data: [] };
	}
	if (areaName === 'local' && changes[TELEMETRY_OPT_IN_KEY]) {
		telemetryOptIn = Boolean(changes[TELEMETRY_OPT_IN_KEY].newValue);
		telemetryConsentReady = true;
	}
	if (areaName === 'sync' && changes.isShowDirectUserRbac) {
		MYEXTENSION_SETTINGS.isShowDirectUserRbac =
			changes.isShowDirectUserRbac.newValue !== false;
		if (!MYEXTENSION_SETTINGS.isShowDirectUserRbac) {
			const panel = document.querySelector('[data-azure-extension-rbac-panel]');
			if (panel) {
				panel.remove();
			}
		} else if (IS_TOP_WINDOW && isAzurePortalPage()) {
			fetchEmptyResourcegroupsOnTop();
		}
	}
});

function emitFeatureUseTelemetry(featureName) {
	if (!telemetryConsentReady || telemetryOptIn !== true) {
		return;
	}

	const now = Date.now();
	const lastAt = telemetryLastSentAt[featureName] || 0;
	if (now - lastAt < TELEMETRY_MIN_INTERVAL_MS) {
		return;
	}

	telemetryLastSentAt[featureName] = now;
	try {
		chrome.runtime.sendMessage({
			name: 'telemetry-feature-use',
			featureName: featureName,
			count: 1
		}, function() {
			if (chrome.runtime.lastError) {
				// Ignore when background worker is temporarily unavailable.
			}
		});
	} catch (e) {
		// no-op
	}
}

function onPortDisconnected() {
	port = null;
	isEmptyRgFetchInFlight = false;
	if (emptyRgFetchTimeoutId) {
		clearTimeout(emptyRgFetchTimeoutId);
		emptyRgFetchTimeoutId = null;
	}
}

function onPortMessage(response) {
	if(response.name == "get-access-function"){
		if (response.subscriptions){
			try {
				if (port) {
					port.postMessage({name: "get-empty-resourcegroups"});
					if (isAzurePortalPage() && MYEXTENSION_SETTINGS.isShowDirectUserRbac) {
						rbacFetchInFlight = true;
						directUserRbacTree = { data: [], loading: true };
						renderDirectUserRbacTree();
						port.postMessage({name: "get-direct-user-rbac-tree"});
					}
				}
			} catch (e) {
				onPortDisconnected();
			}
		}else if(response.error){
			if (emptyRgFetchTimeoutId) {
				clearTimeout(emptyRgFetchTimeoutId);
				emptyRgFetchTimeoutId = null;
			}
			console.log(response.error); // TODO: Need to update to notify users this error
			isEmptyRgFetchInFlight = false;
		}
	}else if(response.name == "get-empty-resourcegroups"){
		if (emptyRgFetchTimeoutId) {
			clearTimeout(emptyRgFetchTimeoutId);
			emptyRgFetchTimeoutId = null;
		}
		emptyResourcegroups = response.emptyResourcegroups || { data: [] };
		chrome.storage.local.set({ [EMPTY_RG_CACHE_KEY]: emptyResourcegroups }, function(){});
		isEmptyRgFetchInFlight = false;
	}else if(response.name == "get-direct-user-rbac-tree"){
		directUserRbacTree = response.rbacTree || { data: [] };
		directUserRbacTree.loading = false;
		if (response.error) {
			directUserRbacTree.error = response.error;
		}
		rbacFetchInFlight = false;
		renderDirectUserRbacTree();
	}
}

function ensurePortConnected() {
	if (port) {
		return true;
	}

	try {
		port = chrome.runtime.connect({ name: "my-background-port" });
		port.onMessage.addListener(onPortMessage);
		port.onDisconnect.addListener(onPortDisconnected);
		return true;
	} catch (e) {
		port = null;
		return false;
	}
}

function fetchEmptyResourcegroupsOnTop() {
	if (!IS_TOP_WINDOW || isEmptyRgFetchInFlight) {
		return;
	}
	if (!ensurePortConnected()) {
		return;
	}
	isEmptyRgFetchInFlight = true;
	if (emptyRgFetchTimeoutId) {
		clearTimeout(emptyRgFetchTimeoutId);
	}
	emptyRgFetchTimeoutId = setTimeout(() => {
		isEmptyRgFetchInFlight = false;
	}, 15000);
	try {
		port.postMessage({name: "get-subscriptions-accesstoken"});
	} catch (e) {
		onPortDisconnected();
	}
}

if (IS_TOP_WINDOW) {
	ensurePortConnected();
	fetchEmptyResourcegroupsOnTop();
	setInterval(fetchEmptyResourcegroupsOnTop, 30000);
}

function setupWallpaperOnTop( imgUrl, opacity ){
	var elem = jQuery(APP_CONST_VALUES.SELECT_STARTBOARD_LAYOUT);
	elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity );

	var elem = jQuery(APP_CONST_VALUES.SELECT_HOME_CONTAINER);
	elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity );

	if (imgUrl) {
		emitFeatureUseTelemetry('background-image');
	}
}

function doURICheckLoop() {
	// Setup background image here to make sure 
	setupWallpaperOnTop( MYEXTENSION_SETTINGS.imgUrl, MYEXTENSION_SETTINGS.opacity );

	if(MYEXTENSION_SETTINGS.isHighlightEmptyRG) doUpdateResourcegrouplist();
	renderDirectUserRbacTree();
	
	setTimeout( () => doURICheckLoop(), 500);
}
doURICheckLoop();

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
	return jQuery(results);
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

function escapeRbacHtml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
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
		'<li><strong>' + escapeRbacHtml(principalName) + '</strong> - ' +
		byPrincipal[principalName].sort().map(escapeRbacHtml).join(', ') + '</li>'
	).join('');
}

function renderDirectUserRbacTree() {
	if (!IS_TOP_WINDOW || !isAzurePortalPage() ||
		MYEXTENSION_SETTINGS.isShowDirectUserRbac === false) {
		const panel = document.querySelector('[data-azure-extension-rbac-panel]');
		if (panel) {
			panel.remove();
		}
		return;
	}

	let panel = document.querySelector('[data-azure-extension-rbac-panel]');
	if (!panel) {
		panel = document.createElement('aside');
		panel.setAttribute('data-azure-extension-rbac-panel', 'true');
		panel.style.cssText = [
			'position:fixed',
			'top:110px',
			'right:20px',
			'z-index:2147483647',
			'width:420px',
			'max-height:75vh',
			'overflow:auto',
			'background:#ffffff',
			'color:#1f1f1f',
			'border:1px solid #8a8886',
			'border-radius:6px',
			'box-shadow:0 8px 24px rgba(0,0,0,.28)',
			'font:14px Segoe UI,Arial,sans-serif',
			'line-height:1.45'
		].join(';');
		const header = document.createElement('div');
		header.setAttribute('data-azure-extension-rbac-header', 'true');
		header.style.cssText = [
			'display:flex',
			'align-items:center',
			'justify-content:space-between',
			'gap:12px',
			'padding:10px 12px',
			'background:#0078d4',
			'color:#ffffff',
			'font-weight:600',
			'cursor:move',
			'user-select:none'
		].join(';');

		const title = document.createElement('span');
		title.textContent = 'Direct user RBAC';
		header.appendChild(title);

		const toggleButton = document.createElement('button');
		toggleButton.type = 'button';
		toggleButton.textContent = 'Hide details';
		toggleButton.style.cssText = [
			'border:1px solid rgba(255,255,255,.8)',
			'border-radius:3px',
			'padding:3px 8px',
			'background:transparent',
			'color:#ffffff',
			'cursor:pointer',
			'font:12px Segoe UI,Arial,sans-serif'
		].join(';');
		header.appendChild(toggleButton);

		const body = document.createElement('div');
		body.setAttribute('data-azure-extension-rbac-body', 'true');
		body.style.padding = '16px';
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
			escapeRbacHtml(directUserRbacTree.error) + '</p>'
		: data.length === 0
		? '<p>No direct user RBAC assignments were found at Subscription or Resource Group scope.</p>'
		: data.map((subscription) => {
			const subscriptionAssignments = renderRbacAssignments(subscription.assignments);
			const resourceGroups = (subscription.resourceGroups || []).map((resourceGroup) =>
				'<li><strong>Resource Group: ' + escapeRbacHtml(resourceGroup.name) + '</strong>' +
				'<ul>' + renderRbacAssignments(resourceGroup.assignments) + '</ul></li>'
			).join('');
			const children = (subscriptionAssignments
				? '<li><strong>Subscription scope</strong><ul>' + subscriptionAssignments + '</ul></li>'
				: '') + resourceGroups;
			return '<li><strong>Subscription: ' + escapeRbacHtml(subscription.name) + '</strong>' +
				'<ul>' + children + '</ul>' +
				'</li>';
		}).join('');

	const body = panel.querySelector('[data-azure-extension-rbac-body]');
	body.innerHTML =
		'<div style="font-size:12px;color:#605e5c;margin-bottom:10px">Tenant: ' +
		escapeRbacHtml(directUserRbacTree?.tenantId || 'current tenant') + '</div>' +
		'<div style="font-size:12px;color:#605e5c;margin-bottom:10px">' +
		'Direct assignments only; inherited roles, groups, service principals, managed identities, Lighthouse, and resource-level roles are excluded.</div>' +
		'<ul style="padding-left:20px;margin:0">' + treeHtml + '</ul>' +
		(directUserRbacTree?.nameResolutionWarning
			? '<p style="font-size:12px;color:#a4262c;margin-bottom:0">' +
				escapeRbacHtml(directUserRbacTree.nameResolutionWarning) + '</p>'
			: '');
}

function normalizeRgName(text) {
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

function isLikelySameRgName(candidate, rgName) {
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

function extractRgNameFromHref(href) {
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

function normalizeEmptyRgEntry(item) {
	const rgFromFields =
		toLowerSafe(item && item.resourceGroup) ||
		toLowerSafe(item && item.resourceGroupName) ||
		toLowerSafe(item && item.name) ||
		toLowerSafe(item && item.rgName);

	const rgFromId = extractRgNameFromHref((item && item.id) || (item && item.resourceId) || '');
	const rgName = rgFromFields || rgFromId;

	const subName =
		toLowerSafe(item && item.subscriptionName) ||
		toLowerSafe(item && item.subscriptionDisplayName) ||
		toLowerSafe(item && item.subName);

	return { rgName, subName };
}

function isResourceGroupsRelatedFrame() {
	const href = (window.location && window.location.href) ? window.location.href : '';
	if (
		href.indexOf('/resourcegroups') !== -1 ||
		href.indexOf('resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups') !== -1 ||
		href.indexOf('view/HubsExtension/BrowseResourceGroups') !== -1
	) {
		return true;
	}

	const rgLinks = querySelectorAllDeep('a[href*="/resourceGroups/"], a.ext-hubs-browse-resource-link');
	return rgLinks.length > 0;
}

function highlightElement(targetElem, rgName, highlightSuffix) {
	if (!targetElem || targetElem.length === 0) {
		return false;
	}

	if (targetElem.attr('data-empty-rg-highlighted') === rgName) {
		return false;
	}

	const latestText = targetElem.text();
	if (!latestText) {
		return false;
	}

	if(highlightSuffix && latestText.indexOf(highlightSuffix) === -1){
		targetElem.text(latestText + highlightSuffix);
	}
	const elem = targetElem.get(0);
	if (elem && elem.style) {
		elem.style.setProperty('color', MYEXTENSION_SETTINGS.color, 'important');
		elem.style.setProperty('font-weight', '700', 'important');
		elem.style.setProperty('text-decoration', 'underline', 'important');
	}
	const parentCell = targetElem.closest('[role="gridcell"], td, .ms-DetailsRow-cell');
	if (parentCell.length > 0) {
		const cell = parentCell.get(0);
		if (cell && cell.style) {
			cell.style.setProperty('background-color', 'rgba(255, 234, 112, 0.22)', 'important');
			cell.style.setProperty('border-left', '3px solid ' + MYEXTENSION_SETTINGS.color, 'important');
		}
	}
	targetElem.attr('data-empty-rg-highlighted', rgName);
	return true;
}

function fallbackHighlightWithoutRows(emptyRgData, highlightSuffix) {
	const rgNameSet = {};
	emptyRgData.forEach(item => {
		rgNameSet[item.rgName] = true;
	});
	const rgNames = Object.keys(rgNameSet);

	const candidates = querySelectorAllDeep('a, [role="link"], div[role="gridcell"], span[role="gridcell"], td');
	let highlightedCount = 0;

	candidates.each((index, elem) => {
		const cellElem = jQuery(elem);
		const cellText = normalizeCellText(cellElem.text(), highlightSuffix);
		const hrefName = extractRgNameFromHref(cellElem.attr('href'));

		let matchedRgName = '';
		if (hrefName && rgNameSet[hrefName]) {
			matchedRgName = hrefName;
		} else {
			for (let i = 0; i < rgNames.length; i++) {
				if (isLikelySameRgName(cellText, rgNames[i])) {
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

		if (highlightElement(cellElem, matchedRgName, highlightSuffix)) {
			highlightedCount++;
		}
	});

	return {
		highlightedCount,
		candidateCount: candidates.length
	};
}

function doUpdateResourcegrouplist(){
	if (!isResourceGroupsRelatedFrame()) {
		return;
	}

	// pick up top element of resource group list, and use fallback for portal DOM changes
	let resourceArray = querySelectorAllDeep('div.fxc-gc-rows div.fxc-gc-row, div[role="row"], tr');
	if(resourceArray.length === 0){
		resourceArray = querySelectorAllDeep("div[role='row']");
	}
	const rawEmptyRgData = Array.isArray(emptyResourcegroups?.data)
		? emptyResourcegroups.data
		: (Array.isArray(emptyResourcegroups) ? emptyResourcegroups : []);
	const emptyRgData = rawEmptyRgData
		.map(item => normalizeEmptyRgEntry(item))
		.filter(item => item.rgName);
	const emptyRgNameSet = {};
	emptyRgData.forEach(item => {
		emptyRgNameSet[item.rgName] = true;
	});
	const highlightSuffix = MYEXTENSION_SETTINGS.addText || '';

	if(emptyRgData.length === 0){
		const now = Date.now();
		if (now - lastHighlightDebugAt > 5000) {
			console.log('[Azure Portal Extension] highlight-scan skipped: empty cache data, href=', window.location.href);
			lastHighlightDebugAt = now;
		}
		return;
	}

	let highlightedCount = 0;
	let usedFallback = false;
	let fallbackCandidateCount = 0;

	const directRgLinks = querySelectorAllDeep('a.ext-hubs-browse-resource-link, a[href*="/resourceGroups/"]');
	directRgLinks.each((index, elem) => {
		const linkElem = jQuery(elem);
		const rgByText = normalizeRgName(normalizeCellText(linkElem.text(), highlightSuffix));
		const rgByHref = extractRgNameFromHref(linkElem.attr('href'));
		const rgName = rgByText || rgByHref;
		if (!rgName || !emptyRgNameSet[rgName]) {
			return;
		}
		if (highlightElement(linkElem, rgName, highlightSuffix)) {
			highlightedCount++;
		}
	});

	if (resourceArray.length === 0) {
		const fallbackResult = fallbackHighlightWithoutRows(emptyRgData, highlightSuffix);
		highlightedCount = fallbackResult.highlightedCount;
		fallbackCandidateCount = fallbackResult.candidateCount;
		usedFallback = true;
	}

	resourceArray.each( (index, elem) => {
		const rowElem = jQuery(elem);
		const rowText = rowElem.text().toLowerCase();
		if(!rowText){
			return;
		}

		let matchedRow = null;
		for (var i = 0; i < emptyRgData.length; i++) {
			if (
				rowText.indexOf(emptyRgData[i].rgName) !== -1 &&
				(!emptyRgData[i].subName || rowText.indexOf(emptyRgData[i].subName) !== -1)
			) {
				matchedRow = emptyRgData[i];
				break;
			}
		}
		if (!matchedRow) {
			for (var j = 0; j < emptyRgData.length; j++) {
				if (rowText.indexOf(emptyRgData[j].rgName) !== -1) {
					matchedRow = emptyRgData[j];
					break;
				}
			}
		}
		if (!matchedRow) {
			return;
		}

		let resourceGroupElem = rowElem.find('div.fxc-gc-row-content a:nth-child(2)').first();
		if(resourceGroupElem.length === 0){
			resourceGroupElem = rowElem.find('a').first();
		}
		if(resourceGroupElem.length === 0){
			resourceGroupElem = rowElem.find('span, div').filter((idx, cell) => {
				const cellText = normalizeCellText(jQuery(cell).text(), highlightSuffix);
				return cellText === matchedRow.rgName;
			}).first();
		}

		const currentText = resourceGroupElem.text();
		if(!currentText){
			return;
		}

		const sameNameLink = rowElem.find('a').filter((idx, link) => {
			const cellText = normalizeCellText(jQuery(link).text(), highlightSuffix);
			return cellText === matchedRow.rgName;
		}).first();
		if(sameNameLink.length > 0){
			resourceGroupElem = sameNameLink;
		}

		if (highlightElement(resourceGroupElem, matchedRow.rgName, highlightSuffix)) {
			highlightedCount++;
		}
	});

	const now = Date.now();
	if (now - lastHighlightDebugAt > 5000) {
		let sampleCandidates = [];
		if (highlightedCount === 0 && usedFallback && fallbackCandidateCount > 0) {
			const sampleElems = querySelectorAllDeep('a, [role="link"], [role="gridcell"]');
			sampleCandidates = sampleElems
				.slice(0, 8)
				.map(elem => {
					const e = jQuery(elem);
					return {
						text: normalizeCellText(e.text(), highlightSuffix),
						href: e.attr('href') || ''
					};
				})
				.filter(x => x.text || x.href);
		}
		console.log('[Azure Portal Extension] highlight-scan', {
			href: window.location.href,
			rows: resourceArray.length,
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

function bluerUsernameAndAADTenantLoop() {
	if(!isSettingsLoaded){
		setTimeout( () => bluerUsernameAndAADTenantLoop(), 300);
		return;
	}

	const usernameElem = jQuery(APP_CONST_VALUES.SELECT_USERNAME);
	const tenantElem = jQuery(APP_CONST_VALUES.SELECT_TENANTNAME);

	if(MYEXTENSION_SETTINGS.isUsernameBluer == true){
		jQuery(usernameElem).css('filter','blur(2px)');
		if (usernameElem.length > 0) {
			emitFeatureUseTelemetry('mask-username');
		}
	}else{
		jQuery(usernameElem).css('filter','');
	}

	if(MYEXTENSION_SETTINGS.isAADTenantBluer == true){
		jQuery(tenantElem).css('filter','blur(2px)');
		if (tenantElem.length > 0) {
			emitFeatureUseTelemetry('mask-tenant');
		}
	}else{
		jQuery(tenantElem).css('filter','');
	}

	setTimeout( () => bluerUsernameAndAADTenantLoop(), 1000);
}
bluerUsernameAndAADTenantLoop();
