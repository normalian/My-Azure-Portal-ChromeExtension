'use strict';

console.log('[Azure Portal Extention] start popup.js');

var authorizationToken;
var port = chrome.runtime.connect( { name: "my-background-port"} );
var default_config = {
	imgUrl : '',
	opacity : 0.8,
	addText : " - @@empty@@",
	color : "#ffff00",
	isUsernameBluer : false,
	isAADTenantBluer : false,
	isHighlightEmptyRG : false
};

$(function(){
	// console.log('[Azure Portal Extention] Here is popup.js');
	port.postMessage({name: "get-subscriptions-accesstoken"});
	port.onMessage.addListener( response => {
		// take authorizationToken from background
		authorizationToken = response.authorizationToken;
		$('#accesstoken').val(authorizationToken);
	});

	$('#save_button').click(function(){
		var imgUrl = $("#imgurl").val();
		var opacity = $("#opacity").val();
		var color = $("#color").val();
		var addText = $("#addText").val();
		var isUsernameBluer = $('#isUsernameBluer').is(":checked");
		var isAADTenantBluer = $('#isAADTenantBluer').is(":checked");
		var isHighlightEmptyRG = $('#isHighlightEmptyRG').is(":checked");

		var config = {
		  imgUrl: imgUrl,
		  opacity: opacity,
		  addText : addText,
		  color : color,
		  isUsernameBluer : isUsernameBluer,
		  isAADTenantBluer : isAADTenantBluer,
		  isHighlightEmptyRG : isHighlightEmptyRG
		};
		chrome.storage.sync.set(config, function(){});
	});

	chrome.storage.sync.get(
		default_config,
		function(items) {
			$("#imgurl").val(items.imgUrl);
			$("#opacity").val(items.opacity);
			$('#slider_val').text($("#opacity").val());
			$("#color").val(items.color);
			$("#addText").val(items.addText);
			$("#isUsernameBluer").prop('checked', items.isUsernameBluer);
			$("#isAADTenantBluer").prop('checked', items.isAADTenantBluer);
			$("#isHighlightEmptyRG").prop('checked', items.isHighlightEmptyRG);

			if(items.isHighlightEmptyRG == false){
				$("#color").prop('disabled', true);
				$("#addText").prop('disabled', true);
			}
		}
	);

	$('#isHighlightEmptyRG').change( function(){
		var flag = !$("#isHighlightEmptyRG").prop('checked');
		$("#color").prop('disabled', flag);
		$("#addText").prop('disabled', flag);
});

	$("#opacity").on('input', function () {
		$('#slider_val').text($("#opacity").val());
	});
});
