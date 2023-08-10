'use strict';

console.log('[Azure Portal Extention] start popup.js');

var DEFAULT_CONFIG = {
	imgUrl : '',
	opacity : 0.8,
	isUsernameBluer : false,
	isAADTenantBluer : false,
	isHighlightEmptyRG : false,
	addText : " - @@empty@@",
	color : "#ffff00",
	accesstoken : ""
};

$(function(){
	// console.log('[Azure Portal Extention] Here is popup.js');

	$('#save_button').click(function(){
		var imgUrl = $("#imgurl").val();
		var opacity = $("#opacity").val();
		var isUsernameBluer = $('#isUsernameBluer').is(":checked");
		var isAADTenantBluer = $('#isAADTenantBluer').is(":checked");

		var isHighlightEmptyRG = $('#isHighlightEmptyRG').is(":checked");
		var color = $("#color").val();
		var addText = $("#addText").val();
		var accesstoken = $("#accesstoken").val();

		var config = {
			imgUrl: imgUrl,
			opacity: opacity,
			isUsernameBluer : isUsernameBluer,
			isAADTenantBluer : isAADTenantBluer,
			isHighlightEmptyRG : isHighlightEmptyRG,
			addText : addText,
			color : color,
			accesstoken : accesstoken
		};
		chrome.storage.sync.set(config, function(){});
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
			$("#accesstoken").val(items.accesstoken);
			$("#isHighlightEmptyRG").prop('checked', items.isHighlightEmptyRG);
			if(items.isHighlightEmptyRG == false){
				$("#color").prop('disabled', true);
				$("#addText").prop('disabled', true);
				$("#accesstoken").prop('disabled', true);
			}
		}
	);

	$('#isHighlightEmptyRG').change( function(){
		var flag = !$("#isHighlightEmptyRG").prop('checked');
		$("#color").prop('disabled', flag);
		$("#addText").prop('disabled', flag);
		$("#accesstoken").prop('disabled', flag);
	});

	$("#opacity").on('input', function () {
		$('#slider_val').text($("#opacity").val());
	});
});
