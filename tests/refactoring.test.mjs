import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Script, SourceTextModule, createContext } from 'node:vm';
import test from 'node:test';

const root = new URL('../extension/', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const listener = () => ({
  callbacks: [],
  addListener(callback) { this.callbacks.push(callback); }
});

class MockElement {
  constructor() {
    this.value = '';
    this.checked = false;
    this.style = {};
    this.events = {};
    this.attributes = {};
    this.children = [];
    this.dataset = {};
  }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  remove() { this.removed = true; }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  reset() {}
  focus() {}
  select() {}
}

function fixture(page, { sync = {}, local = {} } = {}) {
  const html = page ? read(page) : '';
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)]
    .map((match) => [match[1], new MockElement()]));
  const scheduled = [];
  const logs = [];
  const errors = {};
  const stores = { sync, local };
  const document = {
    events: {},
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(name, callback) { this.events[name] = callback; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return new MockElement(); },
    body: new MockElement()
  };
  const runtime = {
    onInstalled: listener(),
    onStartup: listener(),
    onMessage: listener(),
    onConnect: listener(),
    getManifest: () => ({ version: '0.5.1' }),
    getURL: (path) => path,
    sendMessage(message, callback) {
      runtime.lastError = errors.message ? { message: errors.message } : undefined;
      callback({ ok: true, signedIn: false, config: { tenantId: 'organizations', clientId: '' },
        telemetrySettings: { enabled: false }, uploadedCount: 0 });
      runtime.lastError = undefined;
    },
    connect: () => ({ onMessage: listener(), onDisconnect: listener(), postMessage() {} })
  };
  const storage = { onChanged: listener() };
  for (const area of ['sync', 'local']) {
    const operation = (callback, result) => {
      runtime.lastError = errors[area] ? { message: errors[area] } : undefined;
      callback(result);
      runtime.lastError = undefined;
    };
    storage[area] = {
      get(keys, callback) {
        const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
        operation(callback, { ...defaults, ...stores[area] });
      },
      set(values, callback) {
        if (!errors[area]) Object.assign(stores[area], values);
        operation(callback);
      },
      remove(keys, callback) {
        if (!errors[area]) for (const key of [keys].flat()) delete stores[area][key];
        operation(callback);
      }
    };
  }
  const window = { location: { href: 'https://portal.azure.com/', hostname: 'portal.azure.com' } };
  window.top = window;
  const context = createContext({
    chrome: { runtime, storage, identity: { getRedirectURL: () => 'https://fixture.chromiumapp.org/' },
      management: { getSelf: (callback) => callback({ installType: 'development' }) },
      alarms: { onAlarm: listener(), get: async () => null, create() {} } },
    document, window, URL, URLSearchParams,
    HTMLElement: MockElement, HTMLInputElement: MockElement, Element: MockElement,
    console: Object.fromEntries(['log', 'debug', 'warn', 'error']
      .map((name) => [name, (...args) => logs.push(args)])),
    setTimeout: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
    setInterval: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
    clearTimeout() {}
  });
  const run = (name) => new Script(read(name), { filename: name }).runInContext(context);
  return { context, run, elements, document, runtime, errors, stores, scheduled, logs };
}

test('legacy settings, canonical precedence, and falsy values survive serialization', () => {
  const app = fixture();
  app.run('shared.js');
  const api = app.context.AzureExtension;
  const legacy = { imgUrl: 'wallpaper.png', opacity: '0.4', isUsernameBluer: true,
    isAADTenantBluer: true, isSubscriptionIdBluer: true, isHighlightEmptyRG: true,
    isShowDirectUserRbac: true, addText: ' empty', color: '#123456' };
  const settings = api.readPortalSettings(legacy);
  assert.deepEqual(plain(settings), {
    backgroundImageUrl: 'wallpaper.png', backgroundOpacity: '0.4', maskAccountName: true,
    maskTenantName: true, maskSubscriptionIds: true, azureTabIcon: true, highlightEmptyResourceGroups: true,
    showDirectUserRbac: true, emptyResourceGroupSuffix: ' empty', emptyResourceGroupColor: '#123456'
  });
  const canonical = api.readPortalSettings({ ...legacy, backgroundImageUrl: '',
    backgroundOpacity: 0, maskAccountName: false, azureTabIcon: false, emptyResourceGroupSuffix: '' });
  assert.equal(canonical.backgroundImageUrl, '');
  assert.equal(canonical.backgroundOpacity, 0);
  assert.equal(canonical.maskAccountName, false);
  assert.equal(canonical.azureTabIcon, false);
  assert.equal(canonical.emptyResourceGroupSuffix, '');
  const stored = api.serializePortalSettings(canonical);
  for (const [key, alias] of Object.entries(api.legacySettingKeys)) {
    assert.equal(stored[key], stored[alias]);
  }
  assert.deepEqual(plain(api.readPortalSettings(stored)), plain(canonical));
  assert.deepEqual(plain(api.readPortalSettings({})), plain(api.defaultSettings));
});

test('Chrome storage and message errors reject rather than reporting success', async () => {
  const app = fixture();
  app.run('shared.js');
  const api = app.context.AzureExtension;
  app.errors.sync = 'Storage unavailable';
  await assert.rejects(api.storageGet('sync', null), /Storage unavailable/);
  await assert.rejects(api.storageSet('sync', { key: true }), /Storage unavailable/);
  await assert.rejects(api.storageRemove('sync', 'key'), /Storage unavailable/);
  app.errors.message = 'Worker unavailable';
  await assert.rejects(api.sendRuntimeMessage({ name: api.messages.authStatus }), /Worker unavailable/);
  delete app.errors.sync;
  await api.storageSet('sync', { key: false });
  assert.equal((await api.storageGet('sync', 'key')).key, false);
  await api.storageRemove('sync', 'key');
  assert.equal((await api.storageGet('sync', 'key')).key, undefined);
});

test('popup loads legacy values, writes both keys, and surfaces failed actions', async () => {
  const html = read('popup.html');
  assert.ok(!html.includes('manageSubscriptionBackgrounds'));
  assert.ok(html.indexOf('<h2>Azure Tab Icon</h2>') > html.indexOf('Works without sign-in features'));
  assert.ok(html.indexOf('<h2>Azure Tab Icon</h2>') < html.indexOf('Requires sign-in features'));
  const app = fixture('popup.html', { sync: { imgUrl: 'legacy.png', opacity: 0, isUsernameBluer: true } });
  for (const script of ['shared.js', 'popup.js']) app.run(script);
  app.document.events.DOMContentLoaded();
  await settle();
  assert.equal(app.elements.get('backgroundImageUrl').value, 'legacy.png');
  assert.equal(app.elements.get('backgroundOpacity').value, '0');
  assert.equal(app.elements.get('maskAccountName').checked, true);
  assert.equal(app.elements.get('azureTabIcon').checked, true);
  app.elements.get('azureTabIcon').checked = false;
  app.elements.get('saveSettingsButton').events.click();
  await settle();
  assert.equal(app.stores.sync.imgUrl, 'legacy.png');
  assert.equal(app.stores.sync.backgroundImageUrl, 'legacy.png');
  assert.equal(app.stores.sync.azureTabIcon, false);
  assert.equal(Object.hasOwn(app.stores.sync, 'undefined'), false);
  app.errors.message = 'Worker unavailable';
  app.elements.get('signOutButton').events.click();
  app.elements.get('sendTelemetryNowButton').events.click();
  await settle();
  assert.match(app.elements.get('authStatus').textContent, /Worker unavailable/);
  assert.match(app.elements.get('telemetryDevStatus').textContent, /Worker unavailable/);
  assert.equal(app.elements.get('sendTelemetryNowButton').disabled, false);
});

test('Options initializes after storage failure and reports failed imports', async () => {
  const app = fixture('options.html');
  app.errors.sync = 'Sync unavailable';
  app.errors.local = 'Local unavailable';
  for (const script of ['shared.js', 'options.js']) app.run(script);
  app.document.events.DOMContentLoaded();
  await settle();
  assert.match(app.elements.get('ruleStatus').textContent, /Local unavailable/);
  assert.equal(typeof app.elements.get('addRuleButton').events.click, 'function');
  app.elements.get('importJson').value = '[]';
  app.elements.get('applyRulesButton').events.click({});
  await settle();
  assert.match(app.elements.get('importStatus').textContent, /Local unavailable/);
});

test('content scripts share a global runtime without collisions and reload background settings', async () => {
  const app = fixture(null, { sync: { imgUrl: 'legacy.png', opacity: 0.4 } });
  const background = new MockElement();
  app.document.querySelectorAll = (selector) =>
    selector.includes('fxs-startboard-layout') ? [background] : [];
  for (const script of ['shared.js', 'script.js']) app.run(script);
  await settle();
  app.scheduled.findLast((timer) => timer.delay === 500).callback();
  assert.match(background.attributes.style, /legacy\.png/);
  assert.match(background.attributes.style, /0\.4/);
  app.stores.sync.imgUrl = 'updated.png';
  app.stores.sync.opacity = 0;
  app.context.chrome.storage.onChanged.callbacks[0]({
    imgUrl: { newValue: 'updated.png' }, opacity: { newValue: 0 }
  }, 'sync');
  await settle();
  app.scheduled.findLast((timer) => timer.delay === 500).callback();
  assert.match(background.attributes.style, /updated\.png/);
  assert.match(background.attributes.style, /opacity : 0$/);
});

test('tab icons follow the last visible blade, recover portal rewrites, and restore on Home or disable', async () => {
  const app = fixture(null, { sync: { azureTabIcon: true } });
  class ImageElement extends MockElement {
    getClientRects() { return this.removed ? [] : [{}]; }
    closest() { return null; }
  }
  app.context.HTMLImageElement = ImageElement;
  app.context.SVGSVGElement = class extends MockElement {};
  app.context.window.getComputedStyle = () => ({ visibility: 'visible' });
  app.document.baseURI = 'https://portal.azure.com/';
  app.document.head = new MockElement();
  const original = new MockElement();
  original.setAttribute('href', '/favicon.ico');
  original.setAttribute('type', 'image/x-icon');
  original.setAttribute('sizes', '16x16');
  const first = new ImageElement();
  first.setAttribute('src', '/icons/resource-group.svg');
  const second = new ImageElement();
  second.setAttribute('src', '/icons/storage.svg');
  let icons = [first, second];
  app.document.querySelectorAll = (selector) =>
    selector.startsWith('link[') ? [original] : selector.includes('fxs-blade-title-icon') ? icons : [];
  for (const script of ['shared.js', 'script.js']) app.run(script);
  await settle();
  const refresh = () => app.scheduled.findLast((timer) => timer.delay === 500).callback();
  assert.equal(original.getAttribute('href'), 'https://portal.azure.com/icons/storage.svg');
  assert.equal(original.getAttribute('type'), null);
  assert.equal(original.getAttribute('sizes'), null);
  original.setAttribute('href', '/favicon.ico');
  refresh();
  assert.equal(original.getAttribute('href'), 'https://portal.azure.com/icons/storage.svg');
  second.removed = true;
  refresh();
  assert.equal(original.getAttribute('href'), 'https://portal.azure.com/icons/resource-group.svg');
  icons = [];
  refresh();
  assert.equal(original.getAttribute('href'), '/favicon.ico');
  assert.equal(original.getAttribute('type'), 'image/x-icon');
  assert.equal(original.getAttribute('sizes'), '16x16');
  icons = [first];
  refresh();
  app.stores.sync.azureTabIcon = false;
  app.context.chrome.storage.onChanged.callbacks[0]({ azureTabIcon: { newValue: false } }, 'sync');
  await settle();
  assert.equal(original.getAttribute('href'), '/favicon.ico');
  refresh();
  assert.equal(original.getAttribute('href'), '/favicon.ico');
});

test('tab icon creates and removes its own favicon and reports unsupported URLs', async () => {
  const app = fixture(null, { sync: { azureTabIcon: true } });
  class ImageElement extends MockElement {
    getClientRects() { return [{}]; }
    closest() { return null; }
  }
  app.context.HTMLImageElement = ImageElement;
  app.context.SVGSVGElement = class extends MockElement {};
  app.context.window.getComputedStyle = () => ({ visibility: 'visible' });
  app.document.baseURI = 'https://portal.azure.com/';
  app.document.head = new MockElement();
  const image = new ImageElement();
  image.setAttribute('src', 'data:image/png;base64,aWNvbg==');
  app.document.querySelectorAll = (selector) =>
    selector.startsWith('link[') ? app.document.head.children.filter((link) => !link.removed)
      : selector.includes('fxs-blade-title-icon') ? [image] : [];
  for (const script of ['shared.js', 'script.js']) app.run(script);
  await settle();
  const link = app.document.head.children[0];
  assert.equal(link.rel, 'icon');
  assert.equal(link.getAttribute('href'), 'data:image/png;base64,aWNvbg==');
  image.setAttribute('src', 'javascript:alert(1)');
  app.scheduled.findLast((timer) => timer.delay === 500).callback();
  assert.equal(link.removed, true);
  assert.ok(app.logs.some((entry) => String(entry[0]).includes('Unable to update Azure Tab Icon')));
});

test('tab icons never modify embedded blade frame favicons', async () => {
  const app = fixture(null, { sync: { azureTabIcon: true } });
  app.context.window.top = {};
  app.document.querySelectorAll = (selector) => {
    assert.ok(!selector.includes('fxs-blade-title-icon'));
    return [];
  };
  for (const script of ['shared.js', 'script.js']) app.run(script);
  await settle();
  app.scheduled.findLast((timer) => timer.delay === 500).callback();
});

async function startWorker(app) {
  const modules = new Map();
  const load = async (name) => {
    if (!modules.has(name)) {
      modules.set(name, new SourceTextModule(read(name), { context: app.context, identifier: name }));
    }
    return modules.get(name);
  };
  const worker = await load('background.js');
  await worker.link((specifier) => load(specifier.replace(/^\.\//, '')));
  await worker.evaluate();
}

test('worker imports shared runtime and keeps subscription lists connection-local', async () => {
  const app = fixture(null, { local: { oauthClientId: 'fixture-client',
    oauthTokenCache: { accessToken: 'fixture-token', expiresAt: Date.now() + 3600000 } } });
  const requests = [];
  let nextSubscription = '11111111-1111-4111-8111-111111111111';
  let fail = false;
  app.context.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: !fail, status: fail ? 403 : 200,
      json: async () => fail ? { error: { message: 'Access denied' } } :
        init.method === 'GET' ? { value: [{ subscriptionId: nextSubscription }] } : { data: [] } };
  };
  await startWorker(app);
  const port = () => {
    const value = { name: 'my-background-port', onMessage: listener(), responses: [],
      postMessage(message) { this.responses.push(message); } };
    app.runtime.onConnect.callbacks[0](value);
    return value;
  };
  const first = port();
  const second = port();
  const messages = app.context.AzureExtension.messages;
  await first.onMessage.callbacks[0]({ name: messages.getSubscriptions });
  nextSubscription = '22222222-2222-4222-8222-222222222222';
  await second.onMessage.callbacks[0]({ name: messages.getSubscriptions });
  await first.onMessage.callbacks[0]({ name: messages.getEmptyResourceGroups });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).subscriptions,
    ['11111111-1111-4111-8111-111111111111']);
  assert.equal(first.responses.at(-1).name, messages.getEmptyResourceGroups);
  fail = true;
  await first.onMessage.callbacks[0]({ name: messages.getSubscriptions });
  assert.equal(first.responses.at(-1).error, 'Access denied');
  assert.equal(first.responses.at(-1).subscriptions, undefined);
  app.context.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await first.onMessage.callbacks[0]({ name: messages.getSubscriptions });
  assert.match(first.responses.at(-1).error, /invalid subscription list/);
});

test('extension pages and manifest reference generated assets in shared-runtime order', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const assertAsset = (name) => assert.ok(existsSync(fileURLToPath(new URL(name, root))),
    `Missing extension asset: ${name}`);
  for (const name of [
    manifest.background.service_worker, manifest.action.default_popup, manifest.options_page,
    manifest.action.default_icon, ...Object.values(manifest.icons)
  ]) assertAsset(name);
  for (const entry of manifest.content_scripts) {
    assert.equal(entry.js[0], 'shared.js');
    for (const name of [...entry.js, ...entry.css]) assertAsset(name);
  }
  for (const [page, script] of [
    ['popup.html', 'popup.js'], ['options.html', 'options.js'], ['onboarding.html', 'onboarding.js']
  ]) {
    const html = read(page);
    const sharedIndex = html.indexOf('src="shared.js"');
    assert.ok(sharedIndex >= 0 && sharedIndex < html.indexOf(`src="${script}"`));
    for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
      if (!/^(?:https?:|#)/.test(match[1])) assertAsset(match[1]);
    }
  }
});

test('README local links still resolve after moving documentation assets', () => {
  const repository = new URL('../', import.meta.url);
  const markdown = readFileSync(new URL('README.md', repository), 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^(?:https?:|#)/.test(match[1])) continue;
    assert.ok(existsSync(fileURLToPath(new URL(match[1], repository))),
      `Broken README link: ${match[1]}`);
  }
});
