'use strict';

var authorizationToken;
var resourceMap = new Array();
var rateCardMap;

console.log('[Azure Portal Extention] start script.js');
var port = chrome.runtime.connect( { name: "my-background-port"} );

var extentionSettings = {
  imgUrl : 'https://daisamieastasia.blob.core.windows.net/img/IMG_1718.jpg',
  opacity : 0.8,
  addText : " - @@empty@@",
  color : "#ffff00"
};

// This delay process is important to add elements on Azure portal for delay read.
function showMessageOnAzurePortalTopLoop() {
	var elem = jQuery('div.fxs-startboard-layout.fxs-flowlayout');
	if( elem.length > 0 ){
		port.postMessage({name: "get-subscriptions-accesstoken"});
		port.onMessage.addListener( response => {
			// console.log('[Azure Portal Extention] returned values are below');

			if(response.name == "get-access-function"){
				// take authorizationToken from background
				authorizationToken = response.authorizationToken;

				// Update resourceMap infor for all subscriptions
				for(var i=0; i<response.subscriptions.length; i++){
					initializeResouceMap(response.subscriptions[i].subscriptionId, response.subscriptions[i].displayName);
				}

				// read user setup info and setup wallpaper
				chrome.storage.sync.get(
					extentionSettings,
					function(items) {
						setupWallpaperOnTop( items.imgUrl, items.opacity );
						extentionSettings.color = items.color;
						extentionSettings.addText = items.addText;
					}
				);
			}else if(response.name == "get-resoucesmap-function"){
				//console.log("################################# showMessageOnAzurePortalTopLoop()#get-resoucesmap-function start");
				//console.log(response);
				resourceMap[response.displayName] = JSON.parse(response.subResourceMap);
				//console.log(resourceMap);
				//console.log("################################# showMessageOnAzurePortalTopLoop()#get-resoucesmap-function end");
			}
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

	var elem = jQuery('div.fxs-home-container.fxs-portal-text');
	elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity );
}

function initializeResouceMap(subscriptionId, displayName){
	resourceMap[displayName] = new Array();
	//console.log("################################# initializeResouceMap()");
	//console.log(subscriptionId);
	//console.log(authorizationToken);
	//console.log("#################################");

	port.postMessage({
		name: "get-subscription-resourcegroups",
		subscriptionId : subscriptionId,
		displayName : displayName,
		resourceMap : resourceMap
	});
}

function doURICheckLoop() {
	//console.log('[Azure Portal Extention] Current URI = ' + window.location.href);
	if( window.location.href.indexOf('resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups') != -1 ||
		window.location.href.indexOf('blade/HubsExtension/BrowseResourceGroups') != -1
	){
		doUpdateResourcegrouplist();
	}
	setTimeout( () => doURICheckLoop(), 1000);
}
doURICheckLoop();

function doUpdateResourcegrouplist(){
	console.log('[Azure Portal Extention] doUpdateResourcegrouplist()')
	const resourceArray = jQuery('div.fxc-gc-row-content');
	//const resourceArray     = jQuery('div.fxc-gc-cell.fxc-gc-columncell_0_0');
	//const subscriptionArray = jQuery('div.fxc-gc-cell.fxc-gc-columncell_0_1');
	resourceArray.each( (index, elem) => {
		var resourceGroupElem = jQuery(elem).find('div.fxc-gc-cell.fxc-gc-columncell_0_0 a.fxc-gcflink-link');
		const resourceGroupName = resourceGroupElem.text().toLowerCase();
		const displayName = jQuery(elem).find('div.fxc-gc-cell.fxc-gc-columncell_0_1').text();
		if(!resourceMap[displayName] || !resourceMap[displayName][resourceGroupName]) return;
		else if( Object.keys(resourceMap[displayName][resourceGroupName]).length == 0 ){
			$(resourceGroupElem).text($(resourceGroupElem).text() + extentionSettings.addText);
			$(resourceGroupElem).attr('style', 'color: ' + extentionSettings.color + ';');
		}
	});
}
