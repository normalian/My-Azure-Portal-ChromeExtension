'use strict';

console.log('[Azure Portal Extention] start script.js');
const port = chrome.runtime.connect( { name: "my-background-port"} );
var authorizationToken;
var emptyResourcegroups = new Array(); // avoid reference exception on showMessageOnAzurePortalTopLoop() when it's initiating

const extentionSettings = {
  imgUrl : null,
  opacity : 0.8,
  addText : " - @@empty@@",
  color : "#ffff00",
  isUsernameBluer : false,
  isAADTenantBluer : false
};

// This delay process is important to add elements on Azure portal for delay read.
function showMessageOnAzurePortalTopLoop() {
	const elem = jQuery('div.fxs-startboard-layout.fxs-flowlayout');
	if( elem.length > 0 ){
		port.postMessage({name: "get-subscriptions-accesstoken"});
		port.onMessage.addListener( response => {
			// console.log('[Azure Portal Extention] returned values are below');

			if(response.name == "get-access-function"){
				// take authorizationToken from background
				authorizationToken = response.authorizationToken;
				port.postMessage({ name: "get-empty-resourcegroups" });			

				// read user setup info and setup wallpaper
				chrome.storage.sync.get(
					extentionSettings,
					function(items) {
						extentionSettings.color = items.color;
						extentionSettings.addText = items.addText;
						extentionSettings.imgUrl = items.imgUrl;
						extentionSettings.opacity = items.opacity;
						extentionSettings.isUsernameBluer = items.isUsernameBluer;
						extentionSettings.isAADTenantBluer = items.isAADTenantBluer;

						// call Bluer function after reading out settings
						bluerUsernameAndAADTenant();
					}
				);
			}else if(response.name == "get-empty-resourcegroups"){
				emptyResourcegroups = JSON.parse(response.emptyResourcegroups);
			}
		});
	}else{
		setTimeout( () => showMessageOnAzurePortalTopLoop(), 1000);
	}
}
showMessageOnAzurePortalTopLoop();

function setupWallpaperOnTop( imgUrl, opacity ){
	var elem = jQuery('div.fxs-startboard-layout.fxs-flowlayout');
	elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity );

	var elem = jQuery('div.fxs-home-container.fxs-portal-text');
	elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity );
}

function doURICheckLoop() {
	// Setup background image here to make sure 
	setupWallpaperOnTop( extentionSettings.imgUrl, extentionSettings.opacity );

	// console.log('[Azure Portal Extention] Current URI = ' + window.location.href);
	if( window.location.href.indexOf('resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups') != -1 ||
		window.location.href.indexOf('blade/HubsExtension/BrowseResourceGroups') != -1
	){
		doUpdateResourcegrouplist();
	}
	setTimeout( () => doURICheckLoop(), 500);
}
doURICheckLoop();

function doUpdateResourcegrouplist(){
	console.log('[Azure Portal Extention] doUpdateResourcegrouplist()')
	// pick up top element of resource group list, this css class sometimes change depending on timing
	const resourceArray = jQuery('div.fxc-gc-row-content');

	resourceArray.each( (index, elem) => {
		// pickup resource grups name
		const resourceGroupElem = jQuery(elem).find('div.fxc-gc-cell.fxc-gc-columncell_0_0 a.fxc-gcflink-link');
		const resourceGroupName = resourceGroupElem.text();
		// pick up subscription name
		const subscriptionname = jQuery(elem).find('div.fxc-gc-cell.fxc-gc-columncell_0_1').text();
		for( var i=0; i<emptyResourcegroups.count ; i++){
			if(emptyResourcegroups.data.rows[i][6] ==  resourceGroupName &&
				emptyResourcegroups.data.rows[i][17] == subscriptionname){
				$(resourceGroupElem).text($(resourceGroupElem).text() + extentionSettings.addText);
				$(resourceGroupElem).attr('style', 'color: ' + extentionSettings.color + ';');
			}
		}
	});
}

function bluerUsernameAndAADTenant() {
	const usernameElem = jQuery('div.fxs-avatarmenu-username');
	if(usernameElem.length){
		if(extentionSettings.isUsernameBluer == true) jQuery(usernameElem).attr('style','filter: blur(2px);');
		if(extentionSettings.isAADTenantBluer == true) jQuery('div.fxs-avatarmenu-tenant').attr('style','filter: blur(2px);');
	}else{
		setTimeout( () => bluerUsernameAndAADTenant(), 1000);
	}
}
