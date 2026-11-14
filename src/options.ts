'use strict';

const RULES_KEY = AzureExtension.storageKeys.subscriptionBackgroundRules;
const GUID_PATTERN = new RegExp(`^${AzureExtension.guidSource}$`, 'i');
const { storageGet, storageSet, escapeHtml } = AzureExtension;
const OPACITY_PERCENT_SCALE = 100;
let editingIndex = -1;

function element<T extends HTMLElement = HTMLInputElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing options element: ${id}`);
  return value as T;
}

async function loadRules() {
  try {
    const items = await storageGet('sync', { [RULES_KEY]: [] });
    return Array.isArray(items[RULES_KEY]) ? items[RULES_KEY] : [];
  } catch (error) {
    console.warn('[Azure Portal Extension] Sync rules unavailable; reading local rules:', error);
    const items = await storageGet('local', { [RULES_KEY]: [] });
    return Array.isArray(items[RULES_KEY]) ? items[RULES_KEY] : [];
  }
}

async function saveRules(rules) {
  try {
    await storageSet('sync', { [RULES_KEY]: rules });
  } catch (error) {
    console.warn('[Azure Portal Extension] Sync rules unavailable; saving locally:', error);
    await storageSet('local', { [RULES_KEY]: rules });
  }
}

function validateRule(rule, index = null) {
  const prefix = index === null ? '' : `Rule ${index + 1}: `;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return `${prefix}must be an object.`;
  if (typeof rule.label !== 'string' || !rule.label.trim()) return `${prefix}label must be a non-empty string.`;
  if (typeof rule.subscriptionId !== 'string' || !GUID_PATTERN.test(rule.subscriptionId)) return `${prefix}subscriptionId must be a valid GUID.`;
  if (typeof rule.imageUrl !== 'string' || !rule.imageUrl.trim()) return `${prefix}imageUrl must be a non-empty string.`;
  if (typeof rule.opacity !== 'number' || !Number.isFinite(rule.opacity) || rule.opacity < 0 || rule.opacity > 1) return `${prefix}opacity must be a number between 0 and 1.`;
  return '';
}

function validateRules(value) {
  if (!Array.isArray(value)) return 'JSON must contain an array of rules.';
  for (let i = 0; i < value.length; i++) {
    const error = validateRule(value[i], i);
    if (error) return error;
  }
  return '';
}

function renderRules(rules) {
  const body = element('rulesBody');
  body.replaceChildren();
  if (rules.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td class="empty" colspan="5">No subscription-specific rules configured.</td>';
    body.appendChild(row);
  } else {
    rules.forEach((rule, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${escapeHtml(rule.label)}</td><td>${escapeHtml(rule.subscriptionId)}</td><td class="url">${escapeHtml(rule.imageUrl)}</td><td>${Math.round(rule.opacity * OPACITY_PERCENT_SCALE)}%</td><td><button type="button" data-edit-index="${index}" aria-label="Edit rule">Edit</button> <button class="danger" type="button" data-delete-index="${index}" aria-label="Delete rule">Delete</button></td>`;
      body.appendChild(row);
    });
  }
  element('exportJson').value = JSON.stringify(rules, null, 2);
}

function setStatus(id, text, isError = false) {
  const target = element(id);
  target.textContent = text;
  target.className = isError ? 'status error' : 'status';
}

async function refreshRulesTable() {
  renderRules(await loadRules());
}

function handleOptionsAction(statusId: string, action: (event: Event) => Promise<void>) {
  return (event: Event) => {
    action(event).catch((error: unknown) => {
      setStatus(statusId, error instanceof Error ? error.message : String(error), true);
    });
  };
}

document.addEventListener('DOMContentLoaded', () => {
  refreshRulesTable().catch((error: unknown) => {
    setStatus('ruleStatus', error instanceof Error ? error.message : String(error), true);
  });
  element('addRuleButton').addEventListener('click', () => {
    editingIndex = -1;
    element<HTMLFormElement>('ruleForm').reset();
    element('ruleForm').querySelector('button[type="submit"]').textContent = 'Add rule';
    element('ruleForm').hidden = false;
    element('ruleLabel').focus();
  });
  element('cancelRuleButton').addEventListener('click', () => {
    editingIndex = -1;
    element('ruleForm').hidden = true;
    element<HTMLFormElement>('ruleForm').reset();
    setStatus('ruleStatus', '');
  });
  element('ruleForm').addEventListener('submit', handleOptionsAction('ruleStatus', async (event) => {
    event.preventDefault();
    const rule = {
      label: element('ruleLabel').value.trim(),
      subscriptionId: element('ruleSubscriptionId').value.trim().toLowerCase(),
      imageUrl: element('ruleImageUrl').value.trim(),
      opacity: Number(element('ruleOpacity').value) / OPACITY_PERCENT_SCALE
    };
    const error = validateRule(rule);
    if (error) {
      setStatus('ruleStatus', error, true);
      return;
    }
    const rules = await loadRules();
    if (editingIndex < 0) {
      rules.push(rule);
    } else {
      rules[editingIndex] = rule;
    }
    await saveRules(rules);
    editingIndex = -1;
    element<HTMLFormElement>('ruleForm').reset();
    element('ruleForm').hidden = true;
    setStatus('ruleStatus', '');
    await refreshRulesTable();
  }));
  element('rulesBody').addEventListener('click', handleOptionsAction('ruleStatus', async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('[data-delete-index]');
    if (button) {
      const rules = await loadRules();
      rules.splice(Number(button.dataset.deleteIndex), 1);
      await saveRules(rules);
      await refreshRulesTable();
      return;
    }
    const editButton = event.target.closest<HTMLElement>('[data-edit-index]');
    if (!editButton) return;
    const index = Number(editButton.dataset.editIndex);
    const rule = (await loadRules())[index];
    if (!rule) return;
    editingIndex = index;
    element('ruleLabel').value = rule.label;
    element('ruleSubscriptionId').value = rule.subscriptionId;
    element('ruleImageUrl').value = rule.imageUrl;
    element('ruleOpacity').value = String(Math.round(rule.opacity * OPACITY_PERCENT_SCALE));
    element('ruleForm').querySelector('button[type="submit"]').textContent = 'Update rule';
    element('ruleForm').hidden = false;
    element('ruleLabel').focus();
  }));
  element('copyJsonButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(element('exportJson').value);
      setStatus('exportStatus', 'JSON copied to clipboard.');
    } catch {
      element('exportJson').select();
      setStatus('exportStatus', 'Copy was blocked. Select and copy the JSON manually.', true);
    }
  });
  element('applyRulesButton').addEventListener('click', handleOptionsAction('importStatus', async () => {
    let imported;
    try {
      imported = JSON.parse(element('importJson').value);
    } catch {
      setStatus('importStatus', 'Invalid JSON.', true);
      return;
    }
    const error = validateRules(imported);
    if (error) {
      setStatus('importStatus', error, true);
      return;
    }
    await saveRules(imported);
    await refreshRulesTable();
    setStatus('importStatus', 'Rules applied. Your previous rules were replaced.');
  }));
});
