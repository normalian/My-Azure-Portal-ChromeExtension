'use strict';

console.log('[Azure Portal Extention] start popup.js');

var default_config = {
	imgUrl : '',
	opacity : 0.8,
	isUsernameBluer : false,
	isAADTenantBluer : false,
	isHighlightEmptyRG : false
};

$(function(){
	// console.log('[Azure Portal Extention] Here is popup.js');

	$('#save_button').click(function(){
		var imgUrl = $("#imgurl").val();
		var opacity = $("#opacity").val();
		var isUsernameBluer = $('#isUsernameBluer').is(":checked");
		var isAADTenantBluer = $('#isAADTenantBluer').is(":checked");

		var config = {
		  imgUrl: imgUrl,
		  opacity: opacity,
		  isUsernameBluer : isUsernameBluer,
		  isAADTenantBluer : isAADTenantBluer,
		};
		chrome.storage.sync.set(config, function(){});
	});

	chrome.storage.sync.get(
		default_config,
		function(items) {
			$("#imgurl").val(items.imgUrl);
			$("#opacity").val(items.opacity);
			$('#slider_val').text($("#opacity").val());
			$("#isUsernameBluer").prop('checked', items.isUsernameBluer);
			$("#isAADTenantBluer").prop('checked', items.isAADTenantBluer);
		}
	);

	$("#opacity").on('input', function () {
		$('#slider_val').text($("#opacity").val());
	});
});
