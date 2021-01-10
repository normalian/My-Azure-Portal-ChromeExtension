'use strict';

var authorizationToken;
var subscriptionIDs = new Array();
console.log('[Azure Portal Extention] start background.js');

chrome.webRequest.onBeforeSendHeaders.addListener(function(details){
	const headers = details.requestHeaders;
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
	console.log('[Azure Portal Extention] background.js#addListener: ' + port.name);
	port.onMessage.addListener( arg => {
		if( arg.name == "get-subscriptions-accesstoken" ){
			jQuery.ajax({
				type: 'GET',
				headers: {
					'Authorization': authorizationToken,
					'Content-Type': 'application/json'
				},
				url: "https://management.azure.com/subscriptions?api-version=2018-02-01"
			}).then( response => {
				// console.log(JSON.stringify(response));
				for( var i=0; i<response.value.length ; i++){
					subscriptionIDs.push(response.value[i].subscriptionId);
				} 
				port.postMessage( {
					name: "get-access-function",
					authorizationToken: authorizationToken,
					subscriptions: response.value
				});
			});
			return true;
		}else if( arg.name="get-empty-resourcegroups"){
			// console.log("################################# get-empty-resourcegroups");
			// REST API call to get empty resource grups with subscription name
			var data = {
				"subscriptions" :subscriptionIDs,
				"query" : "ResourceContainers | where type == 'microsoft.resources/subscriptions/resourcegroups' | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | join kind=leftouter (Resources | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | summarize count() by rgAndSub ) on rgAndSub | where isnull(count_) | project-away rgAndSub1, count_ | join kind=leftouter (ResourceContainers | where type=='microsoft.resources/subscriptions' | project subscriptionName=name, subscriptionId) on subscriptionId | project-away subscriptionId1"
			};

			$.ajax({
				type: 'POST',
				headers: {
					'Authorization': authorizationToken,
					'Content-Type': 'application/json'
				},
				url: 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2019-04-01',
				dataType: 'json',
				data : JSON.stringify(data) // required to pass parameters as json body
			}).then( function( response ){
				port.postMessage( {
					name : "get-empty-resourcegroups",
					// Chrome Extension can't pass nest parameters 
					emptyResourcegroups: JSON.stringify(response)
				});
			});
			return true;
		}
	});
});
