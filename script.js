'use strict';
console.log('[Azure Portal Extension] start script.js', {
    frameHref: window.location.href,
    isTopFrame: window === window.top
});
class DomCollection {
    elements;
    constructor(elements) {
        this.elements = elements;
    }
    get length() {
        return this.elements.length;
    }
    get(index) {
        return this.elements[index];
    }
    first() {
        return new DomCollection(this.elements.slice(0, 1));
    }
    each(callback) {
        this.elements.forEach((element, index) => {
            callback.call(element, index, element);
        });
        return this;
    }
    attr(name, value) {
        if (value === undefined) {
            return this.elements[0]?.getAttribute(name) || undefined;
        }
        this.elements.forEach((element) => element.setAttribute(name, value));
        return this;
    }
    removeAttr(name) {
        this.elements.forEach((element) => element.removeAttribute(name));
        return this;
    }
    text(value) {
        if (value === undefined) {
            return this.elements.map((element) => element.textContent || '').join('');
        }
        this.elements.forEach((element) => { element.textContent = value; });
        return this;
    }
    css(property, value) {
        this.elements.forEach((element) => {
            element.style.setProperty(property, value);
        });
        return this;
    }
    find(selector) {
        const descendants = this.elements.flatMap((element) => Array.from(element.querySelectorAll(selector)));
        return new DomCollection(Array.from(new Set(descendants)));
    }
    filter(predicate) {
        return new DomCollection(this.elements.filter((element, index) => predicate(index, element)));
    }
    closest(selector) {
        const matches = this.elements
            .map((element) => element.closest(selector))
            .filter((element) => Boolean(element));
        return new DomCollection(Array.from(new Set(matches)));
    }
    slice(start, end) {
        return this.elements.slice(start, end);
    }
}
function selectDom(selectorOrElements) {
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
var emptyResourceGroups = []; // avoid reference exception on showMessageOnAzurePortalTopLoop() when it's initiating
var directUserRbacTree = { data: [], loading: true };
var settingsLoaded = false;
const IS_TOP_WINDOW = window === window.top;
const EMPTY_RG_CACHE_KEY = 'emptyResourcegroupsCache';
const TELEMETRY_OPT_IN_KEY = 'telemetryOptIn';
const TELEMETRY_MIN_INTERVAL_MS = 60 * 1000;
var isEmptyResourceGroupsFetchInFlight = false;
var emptyResourceGroupsFetchTimeoutId = null;
var isRbacFetchInFlight = false;
var lastHighlightDebugAt = 0;
var telemetryOptIn = false;
var telemetryConsentReady = false;
var telemetryLastSentAt = {};
var port = null;
const extensionSettings = {
    imgUrl: null,
    opacity: 0.8,
    maskAccountName: false,
    maskTenantName: false,
    maskSubscriptionIds: false,
    highlightEmptyResourceGroups: false,
    showDirectUserRbac: false,
    addText: " - @@empty@@",
    color: "#ffff00"
};
const portalSelectors = {
    startboardLayout: 'div.fxs-startboard-layout.fxs-flowlayout',
    homeContainer: 'div.fxs-home-container.fxs-portal-text',
    username: 'div.fxs-avatarmenu-username',
    tenantName: 'div.fxs-avatarmenu-tenant',
    resourceGroupUrls: [
        'resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups',
        'view/HubsExtension/BrowseResourceGroups'
    ],
    resourceGroupName: 'div.fxc-gc-row-content a:nth-child(2)',
    subscriptionName: 'div.fxc-gc-row-content a:nth-child(1)',
    resourceGroupList: 'div.fxc-gc-rows div.fxc-gc-row'
};
// read user setup info and setup wallpaper
chrome.storage.sync.get(null, function (items) {
    extensionSettings.color = items.color;
    extensionSettings.addText = items.addText;
    extensionSettings.imgUrl = items.imgUrl;
    extensionSettings.opacity = items.opacity;
    extensionSettings.maskAccountName =
        items.maskAccountName ?? items.isUsernameBluer ?? false;
    extensionSettings.maskTenantName =
        items.maskTenantName ?? items.isAADTenantBluer ?? false;
    extensionSettings.maskSubscriptionIds =
        items.maskSubscriptionIds ?? items.isSubscriptionIdBluer ?? false;
    extensionSettings.highlightEmptyResourceGroups =
        items.highlightEmptyResourceGroups ?? items.isHighlightEmptyRG ?? false;
    extensionSettings.showDirectUserRbac =
        items.showDirectUserRbac ?? items.isShowDirectUserRbac ?? false;
    settingsLoaded = true;
});
chrome.storage.local.get({ [EMPTY_RG_CACHE_KEY]: { data: [] } }, function (items) {
    emptyResourceGroups = items[EMPTY_RG_CACHE_KEY] || { data: [] };
});
chrome.storage.local.get({ [TELEMETRY_OPT_IN_KEY]: false }, function (items) {
    telemetryOptIn = Boolean(items[TELEMETRY_OPT_IN_KEY]);
    telemetryConsentReady = true;
});
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[EMPTY_RG_CACHE_KEY]) {
        emptyResourceGroups = changes[EMPTY_RG_CACHE_KEY].newValue || { data: [] };
    }
    if (areaName === 'local' && changes[TELEMETRY_OPT_IN_KEY]) {
        telemetryOptIn = Boolean(changes[TELEMETRY_OPT_IN_KEY].newValue);
        telemetryConsentReady = true;
    }
    if (areaName === 'sync' &&
        (changes.showDirectUserRbac || changes.isShowDirectUserRbac)) {
        const change = changes.showDirectUserRbac || changes.isShowDirectUserRbac;
        extensionSettings.showDirectUserRbac =
            change.newValue !== false;
        if (!extensionSettings.showDirectUserRbac) {
            const panel = document.querySelector('[data-azure-extension-rbac-panel]');
            if (panel) {
                panel.remove();
            }
        }
        else if (IS_TOP_WINDOW && isAzurePortalPage()) {
            fetchEmptyResourceGroups();
        }
    }
    if (areaName === 'sync') {
        const readBooleanChange = (currentKey, legacyKey, fallback) => {
            const change = changes[currentKey] || changes[legacyKey];
            return change ? change.newValue !== false : null;
        };
        const accountMask = readBooleanChange('maskAccountName', 'isUsernameBluer', extensionSettings.maskAccountName);
        const tenantMask = readBooleanChange('maskTenantName', 'isAADTenantBluer', extensionSettings.maskTenantName);
        const subscriptionMask = readBooleanChange('maskSubscriptionIds', 'isSubscriptionIdBluer', extensionSettings.maskSubscriptionIds);
        const emptyGroupHighlight = readBooleanChange('highlightEmptyResourceGroups', 'isHighlightEmptyRG', extensionSettings.highlightEmptyResourceGroups);
        if (accountMask !== null) {
            extensionSettings.maskAccountName = accountMask;
        }
        if (tenantMask !== null) {
            extensionSettings.maskTenantName = tenantMask;
        }
        if (subscriptionMask !== null) {
            extensionSettings.maskSubscriptionIds = subscriptionMask;
        }
        if (emptyGroupHighlight !== null) {
            extensionSettings.highlightEmptyResourceGroups = emptyGroupHighlight;
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
        }, function () {
            if (chrome.runtime.lastError) {
                // Ignore when background worker is temporarily unavailable.
            }
        });
    }
    catch (e) {
        // no-op
    }
}
function onPortDisconnected() {
    port = null;
    isEmptyResourceGroupsFetchInFlight = false;
    if (emptyResourceGroupsFetchTimeoutId) {
        clearTimeout(emptyResourceGroupsFetchTimeoutId);
        emptyResourceGroupsFetchTimeoutId = null;
    }
}
function onPortMessage(response) {
    if (response.name == "get-access-function") {
        if (response.subscriptions) {
            try {
                if (port) {
                    port.postMessage({ name: "get-empty-resourcegroups" });
                    if (isAzurePortalPage() && extensionSettings.showDirectUserRbac) {
                        isRbacFetchInFlight = true;
                        directUserRbacTree = { data: [], loading: true };
                        renderDirectUserRbacTree();
                        port.postMessage({ name: "get-direct-user-rbac-tree" });
                    }
                }
            }
            catch (e) {
                onPortDisconnected();
            }
        }
        else if (response.error) {
            if (emptyResourceGroupsFetchTimeoutId) {
                clearTimeout(emptyResourceGroupsFetchTimeoutId);
                emptyResourceGroupsFetchTimeoutId = null;
            }
            console.log(response.error); // TODO: Need to update to notify users this error
            isEmptyResourceGroupsFetchInFlight = false;
        }
    }
    else if (response.name == "get-empty-resourcegroups") {
        if (emptyResourceGroupsFetchTimeoutId) {
            clearTimeout(emptyResourceGroupsFetchTimeoutId);
            emptyResourceGroupsFetchTimeoutId = null;
        }
        emptyResourceGroups = response.emptyResourceGroups || { data: [] };
        chrome.storage.local.set({ [EMPTY_RG_CACHE_KEY]: emptyResourceGroups }, function () { });
        isEmptyResourceGroupsFetchInFlight = false;
    }
    else if (response.name == "get-direct-user-rbac-tree") {
        directUserRbacTree = response.rbacTree || { data: [] };
        directUserRbacTree.loading = false;
        if (response.error) {
            directUserRbacTree.error = response.error;
        }
        isRbacFetchInFlight = false;
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
    }
    catch (e) {
        port = null;
        return false;
    }
}
function fetchEmptyResourceGroups() {
    if (!IS_TOP_WINDOW || isEmptyResourceGroupsFetchInFlight) {
        return;
    }
    if (!ensurePortConnected()) {
        return;
    }
    isEmptyResourceGroupsFetchInFlight = true;
    if (emptyResourceGroupsFetchTimeoutId) {
        clearTimeout(emptyResourceGroupsFetchTimeoutId);
    }
    emptyResourceGroupsFetchTimeoutId = setTimeout(() => {
        isEmptyResourceGroupsFetchInFlight = false;
    }, 15000);
    try {
        port.postMessage({ name: "get-subscriptions-accesstoken" });
    }
    catch (e) {
        onPortDisconnected();
    }
}
function applyBackgroundImage(imgUrl, opacity) {
    var elem = selectDom(portalSelectors.startboardLayout);
    elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity);
    var elem = selectDom(portalSelectors.homeContainer);
    elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity);
    if (imgUrl) {
        emitFeatureUseTelemetry('background-image');
    }
}
class PortalPageController {
    start() {
        if (IS_TOP_WINDOW) {
            ensurePortConnected();
            fetchEmptyResourceGroups();
            setInterval(fetchEmptyResourceGroups, 30000);
        }
        this.runUiLoop();
    }
    runUiLoop() {
        applyBackgroundImage(extensionSettings.imgUrl, extensionSettings.opacity);
        if (extensionSettings.highlightEmptyResourceGroups) {
            highlightEmptyResourceGroups();
        }
        renderDirectUserRbacTree();
        setTimeout(() => this.runUiLoop(), 500);
    }
}
new PortalPageController().start();
function normalizeCellText(text, suffix) {
    if (!text)
        return '';
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
    return (/(^|\.)portal\.azure\.com$/i.test(host) ||
        /(^|\.)reactblade\.portal\.azure\.net$/i.test(host) ||
        /(^|\.)reactblade-ms\.portal\.azure\.net$/i.test(host) ||
        /(^|\.)reactblade-rc\.portal\.azure\.net$/i.test(host)) && href.indexOf('/auth/login') === -1;
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
    return Object.keys(byPrincipal).sort().map((principalName) => '<li><strong>' + escapeRbacHtml(principalName) + '</strong> - ' +
        byPrincipal[principalName].sort().map(escapeRbacHtml).join(', ') + '</li>').join('');
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
                    const resourceGroups = (subscription.resourceGroups || []).map((resourceGroup) => '<li><strong>Resource Group: ' + escapeRbacHtml(resourceGroup.name) + '</strong>' +
                        '<ul>' + renderRbacAssignments(resourceGroup.assignments) + '</ul></li>').join('');
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
function normalizeResourceGroupName(text) {
    if (!text)
        return '';
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
    }
    catch (e) {
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
    const rgFromFields = toLowerSafe(item && item.resourceGroup) ||
        toLowerSafe(item && item.resourceGroupName) ||
        toLowerSafe(item && item.name) ||
        toLowerSafe(item && item.rgName);
    const rgFromId = extractRgNameFromHref((item && item.id) || (item && item.resourceId) || '');
    const rgName = rgFromFields || rgFromId;
    const subName = toLowerSafe(item && item.subscriptionName) ||
        toLowerSafe(item && item.subscriptionDisplayName) ||
        toLowerSafe(item && item.subName);
    return { rgName, subName };
}
function isResourceGroupsPage() {
    const href = (window.location && window.location.href) ? window.location.href : '';
    if (href.indexOf('/resourcegroups') !== -1 ||
        href.indexOf('resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups') !== -1 ||
        href.indexOf('view/HubsExtension/BrowseResourceGroups') !== -1) {
        return true;
    }
    const rgLinks = querySelectorAllDeep('a[href*="/resourceGroups/"], a.ext-hubs-browse-resource-link, ' +
        'div.ms-DetailsRow-fields > div:nth-child(1) a, div[id^="row"] div.ms-DetailsRow-fields a');
    if (rgLinks.length > 0) {
        return true;
    }
    return querySelectorAllDeep('div.ms-DetailsRow-fields, div[id^="row"]').length > 0;
}
function highlightElement(targetElem, rgName, highlightSuffix) {
    if (!targetElem || targetElem.length === 0) {
        return false;
    }
    const alreadyMarked = targetElem.attr('data-empty-rg-highlighted') === rgName;
    const latestText = targetElem.text();
    if (!latestText) {
        return false;
    }
    if (highlightSuffix && latestText.indexOf(highlightSuffix) === -1) {
        targetElem.text(latestText + highlightSuffix);
    }
    const elem = targetElem.get(0);
    if (elem && elem.style) {
        elem.style.setProperty('color', extensionSettings.color, 'important');
        elem.style.setProperty('font-weight', '700', 'important');
        elem.style.setProperty('text-decoration', 'underline', 'important');
    }
    const parentCell = targetElem.closest('[role="gridcell"], td, .ms-DetailsRow-cell');
    if (parentCell.length > 0) {
        const cell = parentCell.get(0);
        if (cell && cell.style) {
            cell.style.setProperty('background-color', 'rgba(255, 234, 112, 0.22)', 'important');
            cell.style.setProperty('border-left', '3px solid ' + extensionSettings.color, 'important');
        }
    }
    targetElem.attr('data-empty-rg-highlighted', rgName);
    return !alreadyMarked || Boolean(elem?.style);
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
        const cellElem = selectDom(elem);
        const cellText = normalizeCellText(cellElem.text(), highlightSuffix);
        const hrefName = extractRgNameFromHref(cellElem.attr('href'));
        let matchedRgName = '';
        if (hrefName && rgNameSet[hrefName]) {
            matchedRgName = hrefName;
        }
        else {
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
function highlightEmptyResourceGroupText(emptyRgData, highlightSuffix) {
    let highlightedCount = 0;
    const visitedRoots = new Set();
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
            if (highlightElement(selectDom(target), matched.rgName, highlightSuffix)) {
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
function highlightEmptyResourceGroups() {
    const hasResourceGroupRows = querySelectorAllDeep('div.ms-DetailsRow-fields a, div[id^="row"] a').length > 0;
    if (!isResourceGroupsPage() && !hasResourceGroupRows) {
        return;
    }
    // pick up top element of resource group list, and use fallback for portal DOM changes
    let resourceArray = querySelectorAllDeep('div.fxc-gc-rows div.fxc-gc-row, div[role="row"], tr, div[id^="row"]');
    if (resourceArray.length === 0) {
        resourceArray = querySelectorAllDeep("div[role='row']");
    }
    const rawEmptyRgData = Array.isArray(emptyResourceGroups?.data)
        ? emptyResourceGroups.data
        : (Array.isArray(emptyResourceGroups) ? emptyResourceGroups : []);
    const emptyRgData = rawEmptyRgData
        .map(item => normalizeEmptyResourceGroupEntry(item))
        .filter(item => item.rgName);
    const emptyRgNameSet = {};
    emptyRgData.forEach(item => {
        emptyRgNameSet[item.rgName] = true;
    });
    const highlightSuffix = extensionSettings.addText || '';
    if (emptyRgData.length === 0) {
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
    const directRgLinks = querySelectorAllDeep('a.ext-hubs-browse-resource-link, a[href*="/resourceGroups/"], ' +
        'div.ms-DetailsRow-fields > div:nth-child(1) a, div[id^="row"] div.ms-DetailsRow-fields a');
    directRgLinks.each((index, elem) => {
        const linkElem = selectDom(elem);
        const rgByText = normalizeResourceGroupName(normalizeCellText(linkElem.text(), highlightSuffix));
        const rgByHref = extractRgNameFromHref(linkElem.attr('href'));
        const rgName = rgByText || rgByHref;
        if (!rgName || !emptyRgNameSet[rgName]) {
            return;
        }
        if (highlightElement(linkElem, rgName, highlightSuffix)) {
            highlightedCount++;
        }
    });
    if (resourceArray.length === 0 || highlightedCount === 0) {
        const fallbackResult = fallbackHighlightWithoutRows(emptyRgData, highlightSuffix);
        highlightedCount += fallbackResult.highlightedCount;
        fallbackCandidateCount = fallbackResult.candidateCount;
        usedFallback = true;
    }
    if (highlightedCount === 0) {
        highlightedCount += highlightEmptyResourceGroupText(emptyRgData, highlightSuffix);
        usedFallback = true;
    }
    resourceArray.each((index, elem) => {
        const rowElem = selectDom(elem);
        const rowText = rowElem.text().toLowerCase();
        if (!rowText) {
            return;
        }
        let matchedRow = null;
        for (var i = 0; i < emptyRgData.length; i++) {
            if (rowText.indexOf(emptyRgData[i].rgName) !== -1 &&
                (!emptyRgData[i].subName || rowText.indexOf(emptyRgData[i].subName) !== -1)) {
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
        if (resourceGroupElem.length === 0) {
            resourceGroupElem = rowElem.find('a').first();
        }
        if (resourceGroupElem.length === 0) {
            resourceGroupElem = rowElem.find('span, div').filter((idx, cell) => {
                const cellText = normalizeCellText(selectDom(cell).text(), highlightSuffix);
                return cellText === matchedRow.rgName;
            }).first();
        }
        const currentText = resourceGroupElem.text();
        if (!currentText) {
            return;
        }
        const sameNameLink = rowElem.find('a').filter((idx, link) => {
            const cellText = normalizeCellText(selectDom(link).text(), highlightSuffix);
            return cellText === matchedRow.rgName;
        }).first();
        if (sameNameLink.length > 0) {
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
function maskSubscriptionIdentifiers() {
    const maskAttribute = 'data-my-azure-portal-subscription-id-mask';
    if (extensionSettings.maskSubscriptionIds !== true) {
        const previouslyMasked = querySelectorAllDeep('[' + maskAttribute + ']');
        previouslyMasked.each(function () {
            const elem = this;
            if (elem.tagName === 'SPAN') {
                elem.replaceWith(document.createTextNode(elem.textContent || ''));
            }
            else {
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
            if (parent &&
                !parent.closest('script, style, textarea, [' + maskAttribute + ']') &&
                subscriptionIdPattern.test(textNode.nodeValue || '')) {
                textNodes.push(textNode);
            }
            subscriptionIdPattern.lastIndex = 0;
            textNode = walker.nextNode();
        }
        textNodes.forEach(function (node) {
            const value = node.nodeValue || '';
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match = subscriptionIdPattern.exec(value);
            while (match) {
                fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
                const maskedSpan = document.createElement('span');
                maskedSpan.setAttribute(maskAttribute, 'true');
                maskedSpan.style.display = 'inline-block';
                maskedSpan.style.filter = 'blur(4px)';
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
    querySelectorAllDeep('input, textarea').each(function () {
        const elem = this;
        if (!elem.hasAttribute(maskAttribute) && subscriptionIdPattern.test(elem.value || '')) {
            selectDom(elem).attr(maskAttribute, 'true').css('filter', 'blur(4px)');
            maskedCount++;
        }
        subscriptionIdPattern.lastIndex = 0;
    });
    if (maskedCount > 0) {
        emitFeatureUseTelemetry('mask-subscription-id');
    }
}
function applyPrivacyMasksLoop() {
    if (!settingsLoaded) {
        setTimeout(() => applyPrivacyMasksLoop(), 300);
        return;
    }
    const usernameElem = selectDom(portalSelectors.username);
    const tenantElem = selectDom(portalSelectors.tenantName);
    if (extensionSettings.maskAccountName == true) {
        selectDom(usernameElem).css('filter', 'blur(2px)');
        if (usernameElem.length > 0) {
            emitFeatureUseTelemetry('mask-username');
        }
    }
    else {
        selectDom(usernameElem).css('filter', '');
    }
    if (extensionSettings.maskTenantName == true) {
        selectDom(tenantElem).css('filter', 'blur(2px)');
        if (tenantElem.length > 0) {
            emitFeatureUseTelemetry('mask-tenant');
        }
    }
    else {
        selectDom(tenantElem).css('filter', '');
    }
    maskSubscriptionIdentifiers();
    setTimeout(() => applyPrivacyMasksLoop(), 2000);
}
applyPrivacyMasksLoop();
