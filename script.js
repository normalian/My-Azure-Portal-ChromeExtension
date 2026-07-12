'use strict';

console.log('[Azure Portal Extension] start script.js');

var emptyResourcegroups = []; // avoid reference exception on showMessageOnAzurePortalTopLoop() when it's initiating
var isSettingsLoaded = false;
const IS_TOP_WINDOW = window === window.top;
const EMPTY_RG_CACHE_KEY = 'emptyResourcegroupsCache';
const TELEMETRY_OPT_IN_KEY = 'telemetryOptIn';
const TELEMETRY_MIN_INTERVAL_MS = 60 * 1000;
var isEmptyRgFetchInFlight = false;
var emptyRgFetchTimeoutId = null;
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
