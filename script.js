'use strict';

var authorizationToken;
var resourceMap = new Array();
var rateCardMap;

console.log('[Azure Portal Extention] start script.js');
var port = chrome.runtime.connect( { name: "my-background-port"} );

var default_config = {
  imgUrl : 'https://daisamiclientvmstorage.blob.core.windows.net/public/hh561749.claudia_wp_01.jpg',
  opacity : 0.8
};

// This delay process is important to add elements on Azure portal for delay read.
function showMessageOnAzurePortalTopLoop() {
	var elem = jQuery('div.fxs-startboard-layout.fxs-flowlayout');
	if( elem.length > 0 ){
		port.postMessage({name: "get-subscriptions-accesstoken"});
		port.onMessage.addListener( response => {
			// console.log('[Azure Portal Extention] returned values are below');

			// take authorizationToken from background
			authorizationToken = response.authorizationToken;

			// Update resourceMap infor for all subscriptions
			for(var i=0; i<response.subscriptions.length; i++){
				initializeResouceMap(response.subscriptions[i].subscriptionId, response.subscriptions[i].displayName);
			}

			// read user setup info and setup wallpaper
			chrome.storage.sync.get(
				default_config,
				function(items) {
					setupWallpaperOnTop( items.imgUrl, items.opacity );
				}
			);
		});
	}else{
		setTimeout( () => showMessageOnAzurePortalTopLoop(), 1000);
	}
}
showMessageOnAzurePortalTopLoop();

function setupWallpaperOnTop( imgUrl, opacity ){
	//style="background-image: url('https://daisamiclientvmstorage.blob.core.windows.net/public/hh561749.claudia_wp_01.jpg');opacity : 0.8"
	var elem = jQuery('div.fxs-startboard-layout.fxs-flowlayout');
	elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity );
}

function initializeResouceMap(subscriptionId, displayName){
	resourceMap[displayName] = new Array();
	$.ajax({
		type: 'GET',
		headers: {
		 'Authorization': authorizationToken,
		 'Content-Type': 'application/json'
		},
		// https://docs.microsoft.com/en-us/rest/api/resources/resourcegroups#ResourceGroups_List
		url: 'https://management.azure.com/subscriptions/'
			+ subscriptionId
			+ '/resourcegroups'
			+ '?api-version=2016-09-01'
	}).then( response => {
		for( var j=0; j<response.value.length ; j++ ){
			resourceMap[displayName][response.value[j].name.toLowerCase()] = new Array();
		}
		$.ajax({
			type: 'GET',
			headers: {
				'Authorization': authorizationToken,
				'Content-Type': 'application/json'
			},
			// https://docs.microsoft.com/en-us/rest/api/resources/resources#Resources_List
			url: 'https://management.azure.com/subscriptions/'
				+ subscriptionId
				+ '/resources'
				+ '?api-version=2016-09-01'
		}).then( response => {
			for( var k=0; k<response.value.length ; k++ ){
				const resourceGroupName = response.value[k].id.split('/')[4].toLowerCase();
				const resourceName = response.value[k].name;
				// console.log(resourceName + ', ' + resourceGroupName);
				resourceMap[displayName][resourceGroupName].push(resourceName);
			}
			//console.table(resourceMap);
		});
	});
}

function doURICheckLoop() {
	// console.log('[Azure Portal Extention] Current URI = ' + window.location.href);
	if( window.location.href.indexOf('resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups') != -1 ){
		doUpdateResourcegrouplist();
	}
	setTimeout( () => doURICheckLoop(), 1000);
}
doURICheckLoop();

function doUpdateResourcegrouplist(){
	// console.log('[Azure Portal Extention] call doUpdateResourcegrouplist')
	const resourceArray = jQuery('td.fxc-grid-cell.azc-br-muted.fxc-grid-activatable');
	const subscriptionArray = jQuery('td.fxc-grid-cell.azc-br-muted.azc-collapsed-hidden');
	resourceArray.each( (index, elem) => {
		const resourceGroupElem = jQuery(elem).find('span.msportalfx-gridcolumn-assetsvg-text');
		const resourceGroupName = jQuery(resourceGroupElem).text().toLowerCase();
		const displayName = jQuery(subscriptionArray.get(index*2)).find('span.fxc-grid-cellContent.fxs-ellipsis').text();
		// const displayName = jQuery(subscriptionArray.get(index*2)).find('span.fxc-grid-cell.azc-br-muted.fxc-grid-activatable').text();
                //console.log('[Azure Portal Extention] displayName = ' + displayName + ', resourceGroupName = ' + resourceGroupName + ', resourceMap = ' + resourceMap )
		if(!resourceMap[displayName] || !resourceMap[displayName][resourceGroupName]) return;
		else if( resourceMap[displayName][resourceGroupName].length == 0 ){
			$(resourceGroupElem).text($(resourceGroupElem).text() + " - @@empty@@");
			$(resourceGroupElem).attr('style', 'color: #ffff00;');
		}
	});
}

