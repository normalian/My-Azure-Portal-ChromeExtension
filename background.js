'use strict';

var authorizationToken;
console.log('[Azure Portal Extention] start background.js');

chrome.webRequest.onBeforeSendHeaders.addListener(function(details){
	var headers = details.requestHeaders;
	// don't check http headers except for portal.azure.com
	if( details.url.indexOf('portal.azure.com') == -1 ) return;
	for( var i = 0, l = headers.length; i < l; ++i ) {
		if (headers[i].name === 'Authorization') {
			if( !authorizationToken || authorizationToken !== details.requestHeaders[i].value ){
				authorizationToken = details.requestHeaders[i].value;
				// console.log('[Azure Portal Extention] update authorization to ' + details.requestHeaders[i].value );
			}
			break;
		}
	}
	return {requestHeaders: details.requestHeaders};
}, {urls: [ '<all_urls>' ]},['requestHeaders','blocking']);

// return authorizationToken and subscriptionList to scripts.js
chrome.runtime.onConnect.addListener( port => {
	var subResourceMap = {};
	console.log('[Azure Portal Extention] background.js#addListener: ' + port.name);
	port.onMessage.addListener( arg => {
		if( arg.name == "get-subscriptions-accesstoken" ){
			jQuery.ajax({
				type: 'GET',
				headers: {
					'Authorization': authorizationToken,
					'Content-Type': 'application/json'
				},
				url: "https://management.azure.com/subscriptions?api-version=2014-04-01-preview"
			}).then( response => {
				// console.log(JSON.stringify(response));
				port.postMessage( {
					name: "get-access-function",
					authorizationToken: authorizationToken,
					subscriptions: response.value
				});
			});
			return true;
		}else if( arg.name == "copy-accesstoken-toclipboard" ){
			console.log(port);
			var textArea = document.createElement("textarea");
			textArea.style.cssText = "position:absolute;left:-100%";
			document.body.appendChild(textArea);
			textArea.value = arg.authorizationToken;
			textArea.select();
			document.execCommand("copy");
			document.body.removeChild(textArea);
			return true;
		}else if( arg.name="get-subscription-resourcegroups"){
			console.log("################################# get-subscription-resourcegroups");
			$.ajax({
				type: 'GET',
				//dataType: "jsonp", 
				headers: {
				 'Authorization': authorizationToken,
				 'Content-Type': 'application/json'
				},
				// https://docs.microsoft.com/en-us/rest/api/resources/resourcegroups#ResourceGroups_List
				url: 'https://management.azure.com/subscriptions/'
					+ arg.subscriptionId
					+ '/resourcegroups'
					+ '?api-version=2019-08-01'
			}).done( function( response ){
				//console.log("################################# response start");
				//console.log(response);
				//console.log(arg.subscriptionId);
				//console.log(arg.displayName);
				//if(! response.value ) return;
				for( var j=0; j<response.value.length ; j++ ){
					subResourceMap[response.value[j].name.toLowerCase()] = {};
				}
				$.ajax({
					type: 'GET',
					headers: {
						'Authorization': authorizationToken,
						'Content-Type': 'application/json'
					},
					// https://docs.microsoft.com/en-us/rest/api/resources/resources#Resources_List
					url: 'https://management.azure.com/subscriptions/'
						+ arg.subscriptionId
						+ '/resources'
						+ '?api-version=2019-08-01'
				}).then( response => {
					//console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
					for( var k=0; k<response.value.length ; k++ ){
						const resourceGroupName = response.value[k].id.split('/')[4].toLowerCase();
						const resourceName = response.value[k].name;
						// console.log(resourceName + ', ' + resourceGroupName);
						subResourceMap[resourceGroupName][resourceName] = true;
					}
					//console.log(subResourceMap);
					//console.log(JSON.stringify(subResourceMap));
					port.postMessage( {
						name : "get-resoucesmap-function",
						subResourceMap: JSON.stringify(subResourceMap),
						subscriptionId: arg.subscriptionId,
						displayName : arg.displayName
					});
					console.log("################################# response end");
					//console.table(resourceMap);
				});
			});
		
			return true;
		}
	});
});
