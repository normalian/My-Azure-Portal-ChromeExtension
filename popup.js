'use strict';

console.log('[Azure Portal Extention] start popup.js');

var authorizationToken;
var port = chrome.runtime.connect( { name: "my-background-port"} );
var default_config = {
	imgUrl : 'https://daisamieastasia.blob.core.windows.net/img/IMG_1718.jpg',
	opacity : 0.8,
	addText : " - @@empty@@",
	color : "#ffff00",
	isUsernameBluer : false,
	isAADTenantBluer : false,
};

$(function(){
	// console.log('[Azure Portal Extention] Here is popup.js');
	port.postMessage({name: "get-subscriptions-accesstoken"});
	port.onMessage.addListener( response => {
		// take authorizationToken from background
		authorizationToken = response.authorizationToken;
		$('#accesstoken').val(authorizationToken);
	});

	$('#save_button').click( function(){
		var imgUrl = $("#imgurl").val();
		var opacity = $("#opacity").val();
		var color = $("#color").val();
		var addText = $("#addText").val();
		var isUsernameBluer = $('#isUsernameBluer').is(":checked");
		var isAADTenantBluer = $('#isAADTenantBluer').is(":checked");

		var config = {
		  imgUrl: imgUrl,
		  opacity: opacity,
		  addText : addText,
		  color : color,
		  isUsernameBluer : isUsernameBluer,
		  isAADTenantBluer : isAADTenantBluer
		};
		chrome.storage.sync.set(config, function(){});
	});

	chrome.storage.sync.get(
		default_config,
		function(items) {
			$("#imgurl").val(items.imgUrl);
			$("#opacity").val(items.opacity);
			$("#color").val(items.color);
			$("#addText").val(items.addText);
			$("#isUsernameBluer").prop('checked', items.isUsernameBluer);
			$("#isAADTenantBluer").prop('checked', items.isAADTenantBluer);
		}
	);
});
