'use strict';

console.log('[Azure Portal Extention] start popup.js');

var authorizationToken;
var port = chrome.runtime.connect( { name: "my-background-port"} );
var default_config = {
	imgUrl : 'https://daisamieastasia.blob.core.windows.net/img/IMG_1718.jpg',
	opacity : 0.8
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
		var config = {
		  imgUrl: imgUrl,
		  opacity: opacity
		};
		chrome.storage.sync.set(config, function(){});
	});

	chrome.storage.sync.get(
		default_config,
		function(items) {
			$("#imgurl").val(items.imgUrl);
			$("#opacity").val(items.opacity);
		}
	);
});
