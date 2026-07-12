'use strict';

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

async function loadTelemetrySettings() {
  const response = await sendRuntimeMessage({ name: 'telemetry-settings-get' });
  if (!response?.ok) {
    document.getElementById('status').textContent = response?.error || 'Failed to load settings.';
    return;
  }

  const settings = response.telemetrySettings || {};
  const enabled = Boolean(settings.enabled);
  document.getElementById('telemetryOptIn').checked = enabled;
}

async function saveTelemetrySettings() {
  const enabled = document.getElementById('telemetryOptIn').checked;

  const response = await sendRuntimeMessage({
    name: 'telemetry-settings-set',
    telemetrySettings: {
      enabled
    }
  });

  if (!response?.ok) {
    document.getElementById('status').textContent = response?.error || 'Failed to save settings.';
    return;
  }

  document.getElementById('status').textContent = enabled ? 'Telemetry enabled.' : 'Telemetry remains disabled.';
  setTimeout(() => window.close(), 250);
}

document.addEventListener('DOMContentLoaded', () => {
  const optInElem = document.getElementById('telemetryOptIn');
  const saveElem = document.getElementById('save');
  const closeElem = document.getElementById('close');

  saveElem.addEventListener('click', saveTelemetrySettings);
  closeElem.addEventListener('click', () => window.close());

  loadTelemetrySettings();
});
