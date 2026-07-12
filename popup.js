'use strict';

console.log('[Azure Portal Extension] start popup.js');

var DEFAULT_CONFIG = {
	imgUrl : '',
	opacity : 0.8,
	isUsernameBluer : false,
	isAADTenantBluer : false,
	isHighlightEmptyRG : false,
	addText : " - @@empty@@",
	color : "#ffff00"
};

function sendRuntimeMessage(message) {
	return new Promise((resolve) => {
		chrome.runtime.sendMessage(message, resolve);
	});
}

function getSelfManagementInfo() {
	return new Promise((resolve) => {
		if (!chrome.management?.getSelf) {
			resolve(null);
			return;
		}

		chrome.management.getSelf((info) => {
			if (chrome.runtime.lastError) {
				resolve(null);
				return;
			}

			resolve(info || null);
		});
	});
}

async function isDevelopmentInstall() {
	const selfInfo = await getSelfManagementInfo();
	return selfInfo?.installType === 'development';
}

function updateAuthStatusText(result) {
	if (!result || result.ok !== true) {
		const errorText = result?.error || 'Failed to get authentication status.';
		$('#authStatus').text(errorText).css('color', 'red');
		return;
	}

	if (!result.signedIn) {
		$('#authStatus').text('Not signed in').css('color', '#333');
		return;
	}

	const expiresDate = new Date(result.expiresAt);
	$('#authStatus').text(`Signed in (expires: ${expiresDate.toLocaleString()})`).css('color', '#0b6a0b');
}

async function loadOAuthConfig() {
	const response = await sendRuntimeMessage({ name: 'oauth-config-get' });
	if (response?.ok) {
		$('#tenantId').val(response.config.tenantId || 'organizations');
		$('#clientId').val(response.config.clientId || '');
	}
}

async function saveOAuthConfig() {
	const tenantId = $('#tenantId').val().trim() || 'organizations';
	const clientId = $('#clientId').val().trim();
	return sendRuntimeMessage({
		name: 'oauth-config-set',
		tenantId,
		clientId
	});
}

async function refreshAuthStatus() {
	const status = await sendRuntimeMessage({ name: 'auth-status' });
	updateAuthStatusText(status);
}

async function loadTelemetrySettings() {
	const response = await sendRuntimeMessage({ name: 'telemetry-settings-get' });
	if (!response?.ok) {
		$('#telemetryStatus').text(response?.error || 'Failed to load telemetry settings.').css('color', 'red');
		return;
	}

	const settings = response.telemetrySettings || {};
	const enabled = Boolean(settings.enabled);
	$('#telemetryOptIn').prop('checked', enabled);
	$('#telemetryStatus').text(enabled ? 'Telemetry is enabled.' : 'Telemetry is disabled.').css('color', '#333');
}

async function saveTelemetrySettings() {
	const enabled = $('#telemetryOptIn').is(':checked');

	const response = await sendRuntimeMessage({
		name: 'telemetry-settings-set',
		telemetrySettings: {
			enabled
		}
	});

	if (!response?.ok) {
		$('#telemetryStatus').text(response?.error || 'Failed to save telemetry settings.').css('color', 'red');
		return { ok: false };
	}

	$('#telemetryStatus').text(enabled ? 'Telemetry enabled.' : 'Telemetry disabled.').css('color', '#0b6a0b');
	return { ok: true };
}

async function configureDevTelemetryTools() {
	const isDev = await isDevelopmentInstall();
	if (!isDev) {
		$('#telemetryDevTools').prop('hidden', true);
		return;
	}

	$('#telemetryDevTools').prop('hidden', false);
	$('#sendTelemetryNowButton').off('click').on('click', async function() {
		$('#telemetryDevStatus').text('Sending buffered telemetry...').css('color', '#333');
		$('#sendTelemetryNowButton').prop('disabled', true);

		const result = await sendRuntimeMessage({ name: 'telemetry-send-now' });
		if (!result?.ok) {
			const message = result?.reason === 'disabled'
				? 'Telemetry is disabled. Enable it and save before sending.'
				: (result?.error || 'Failed to send telemetry.');
			$('#telemetryDevStatus').text(message).css('color', 'red');
			$('#sendTelemetryNowButton').prop('disabled', false);
			return;
		}

		if (result.uploadedCount > 0) {
			$('#telemetryDevStatus').text(`Sent ${result.uploadedCount} buffered telemetry event(s).`).css('color', '#0b6a0b');
		} else {
			$('#telemetryDevStatus').text('Telemetry buffer is empty. Nothing was sent.').css('color', '#333');
		}

		$('#sendTelemetryNowButton').prop('disabled', false);
	});
}

$(function(){
	// console.log('[Azure Portal Extension] Here is popup.js');
	$('#redirectUri').val(chrome.identity.getRedirectURL());
	$('#redirectUri').prop('readonly', true).prop('disabled', true);

	$('#save_button').click(async function(){
		var imgUrl = $("#imgurl").val();
		var opacity = $("#opacity").val();
		var isUsernameBluer = $('#isUsernameBluer').is(":checked");
		var isAADTenantBluer = $('#isAADTenantBluer').is(":checked");

		var isHighlightEmptyRG = $('#isHighlightEmptyRG').is(":checked");
		var color = $("#color").val();
		var addText = $("#addText").val();

		var config = {
			imgUrl: imgUrl,
			opacity: opacity,
			isUsernameBluer : isUsernameBluer,
			isAADTenantBluer : isAADTenantBluer,
			isHighlightEmptyRG : isHighlightEmptyRG,
			addText : addText,
			color : color
		};
		chrome.storage.sync.set(config, function(){});

		const saved = await saveOAuthConfig();
		if (!saved?.ok) {
			$('#authStatus').text(saved?.error || 'Failed to save OAuth settings.').css('color', 'red');
		}

		await saveTelemetrySettings();
	});

	chrome.storage.sync.get(
		DEFAULT_CONFIG,
		function(items) {
			$("#imgurl").val(items.imgUrl);
			$("#opacity").val(items.opacity);
			$('#slider_val').text($("#opacity").val());
			$("#isUsernameBluer").prop('checked', items.isUsernameBluer);
			$("#isAADTenantBluer").prop('checked', items.isAADTenantBluer);

			$("#color").val(items.color);
			$("#addText").val(items.addText);
			$("#isHighlightEmptyRG").prop('checked', items.isHighlightEmptyRG);
			if(items.isHighlightEmptyRG == false){
				$("#color").prop('disabled', true);
				$("#addText").prop('disabled', true);
			}
		}
	);

	loadOAuthConfig().then(refreshAuthStatus);
	loadTelemetrySettings();
	configureDevTelemetryTools();

	$('#isHighlightEmptyRG').change( function(){
		var flag = !$("#isHighlightEmptyRG").prop('checked');
		$("#color").prop('disabled', flag);
		$("#addText").prop('disabled', flag);
	});

	$("#opacity").on('input', function () {
		$('#slider_val').text($("#opacity").val());
	});

	$('#telemetryOptIn').change(function() {
		const enabled = $('#telemetryOptIn').is(':checked');
		if (!enabled) {
			$('#telemetryStatus').text('Telemetry is disabled.').css('color', '#333');
		} else {
			$('#telemetryStatus').text('Telemetry will be enabled on save.').css('color', '#333');
		}
	});

	$('#signin_button').click(async function(){
		if (!$('#clientId').val().trim()) {
			$('#authStatus').text('Please enter Client ID.').css('color', 'red');
			return;
		}

		const saved = await saveOAuthConfig();
		if (!saved?.ok) {
			$('#authStatus').text(saved?.error || 'Failed to save OAuth settings.').css('color', 'red');
			return;
		}

		$('#authStatus').text('Signing in...').css('color', '#333');
		const result = await sendRuntimeMessage({ name: 'auth-login' });
		if (!result?.ok) {
			$('#authStatus').text(result?.error || 'Sign-in failed.').css('color', 'red');
			return;
		}
		await refreshAuthStatus();
	});

	$('#signout_button').click(async function(){
		const result = await sendRuntimeMessage({ name: 'auth-logout' });
		if (!result?.ok) {
			$('#authStatus').text(result?.error || 'Sign-out failed.').css('color', 'red');
			return;
		}
		await refreshAuthStatus();
	});
});
