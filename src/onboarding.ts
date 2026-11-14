'use strict';

const { messages, sendRuntimeMessage } = AzureExtension;
const CLOSE_DELAY_MS = 250;

interface TelemetryResponse {
  ok: boolean;
  error?: string;
  telemetrySettings?: { enabled: boolean };
}

function telemetryCheckbox(): HTMLInputElement {
  const checkbox = document.getElementById('telemetryOptIn');
  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error('Onboarding telemetry checkbox is missing.');
  }
  return checkbox;
}

async function loadTelemetrySettings() {
  const response = await sendRuntimeMessage<TelemetryResponse>({ name: messages.getTelemetrySettings });
  if (!response?.ok) {
    document.getElementById('status').textContent = response?.error || 'Failed to load settings.';
    return;
  }

  const enabled = Boolean(response.telemetrySettings?.enabled);
  telemetryCheckbox().checked = enabled;
}

async function saveTelemetrySettings() {
  const enabled = telemetryCheckbox().checked;

  const response = await sendRuntimeMessage<TelemetryResponse>({
    name: messages.setTelemetrySettings,
    telemetrySettings: {
      enabled
    }
  });

  if (!response?.ok) {
    document.getElementById('status').textContent = response?.error || 'Failed to save settings.';
    return;
  }

  document.getElementById('status').textContent = enabled ? 'Telemetry enabled.' : 'Telemetry remains disabled.';
  setTimeout(() => window.close(), CLOSE_DELAY_MS);
}

class OnboardingController {
	initialize(): void {
		const optInElem = document.getElementById('telemetryOptIn') as HTMLInputElement | null;
		const saveElem = document.getElementById('save');
		const closeElem = document.getElementById('close');
		if (!optInElem || !saveElem || !closeElem) {
			throw new Error('Onboarding controls are missing.');
		}

		saveElem.addEventListener('click', () => saveTelemetrySettings().catch(showOnboardingError));
		closeElem.addEventListener('click', () => window.close());
		loadTelemetrySettings().catch(showOnboardingError);
	}
}

function showOnboardingError(error: unknown): void {
	document.getElementById('status').textContent =
		error instanceof Error ? error.message : String(error);
}

document.addEventListener('DOMContentLoaded', () => {
	new OnboardingController().initialize();
});
