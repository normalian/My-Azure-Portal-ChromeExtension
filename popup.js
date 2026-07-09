'use strict';

console.log('[Azure Portal Extention] start popup.js');

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

$(function(){
	// console.log('[Azure Portal Extention] Here is popup.js');
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

	$('#isHighlightEmptyRG').change( function(){
		var flag = !$("#isHighlightEmptyRG").prop('checked');
		$("#color").prop('disabled', flag);
		$("#addText").prop('disabled', flag);
	});

	$("#opacity").on('input', function () {
		$('#slider_val').text($("#opacity").val());
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
