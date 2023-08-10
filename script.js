'use strict';

console.log('[Azure Portal Extention] start script.js');

var emptyResourcegroups = new Array(); // avoid reference exception on showMessageOnAzurePortalTopLoop() when it's initiating

const port = chrome.runtime.connect( { name: "my-background-port"} );
const MYEXTENSION_SETTINGS = {
  imgUrl : null,
  opacity : 0.8,
  isUsernameBluer : false,
  isAADTenantBluer : false,
  isHighlightEmptyRG : false,
  addText : " - @@empty@@",
  color : "#ffff00",
  accesstoken : ""
};

const APP_CONST_VALUES = {
	SELECT_STARTBOARD_LAYOUT : 'div.fxs-startboard-layout.fxs-flowlayout',
	SELECT_HOME_CONTAINER : 'div.fxs-home-container.fxs-portal-text',
	SELECT_USERNAME : 'div.fxs-avatarmenu-username',
	SELECT_TENANTNAME : 'div.fxs-avatarmenu-tenant',
	RG_URLS : [
		'resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups',
		'view/HubsExtension/BrowseResourceGroups'
	],
	SELECT_RGNAME : 'div.fxc-gc-row-content a:nth-child(2)',
	SELECT_SUBNAME : 'div.fxc-gc-row-content a:nth-child(1)',
	SELECT_RGLIST : 'div.fxc-gc-rows div.fxc-gc-row'
};

// read user setup info and setup wallpaper
chrome.storage.sync.get(
	MYEXTENSION_SETTINGS,
	function(items) {
		MYEXTENSION_SETTINGS.color = items.color;
		MYEXTENSION_SETTINGS.addText = items.addText;
		MYEXTENSION_SETTINGS.imgUrl = items.imgUrl;
		MYEXTENSION_SETTINGS.opacity = items.opacity;
		MYEXTENSION_SETTINGS.isUsernameBluer = items.isUsernameBluer;
		MYEXTENSION_SETTINGS.isAADTenantBluer = items.isAADTenantBluer;
		MYEXTENSION_SETTINGS.isHighlightEmptyRG = items.isHighlightEmptyRG;
		MYEXTENSION_SETTINGS.accesstoken = items.accesstoken;
	}
);

// This delay process is important to add elements on Azure portal for delay read.
function showMessageOnAzurePortalTopLoop() {
	const elem = jQuery(APP_CONST_VALUES.SELECT_STARTBOARD_LAYOUT);
	if( elem.length > 0 ){
		port.postMessage({name: "get-subscriptions-accesstoken",
			authorizationToken: MYEXTENSION_SETTINGS.accesstoken });
		port.onMessage.addListener( response => {
			// console.log('[Azure Portal Extention] returned values are below');

			if(response.name == "get-access-function"){
				if (response.subscriptions){
					port.postMessage({ 
						name: "get-empty-resourcegroups",
						authorizationToken: MYEXTENSION_SETTINGS.accesstoken });
				}else if(response.error){
					console.log( response.error ); //TODO: Need to update to notify users this error
				}
			}else if(response.name == "get-empty-resourcegroups"){
				emptyResourcegroups = response.emptyResourcegroups;
			}
		});
		bluerUsernameAndAADTenant();
	}else{
		setTimeout( () => showMessageOnAzurePortalTopLoop(), 1000);
	}
}
showMessageOnAzurePortalTopLoop();

function setupWallpaperOnTop( imgUrl, opacity ){
	var elem = jQuery(APP_CONST_VALUES.SELECT_STARTBOARD_LAYOUT);
	elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity );

	var elem = jQuery(APP_CONST_VALUES.SELECT_HOME_CONTAINER);
	elem.attr("style", "background-image: url('" + imgUrl + "');opacity : " + opacity );
}

function doURICheckLoop() {
	// Setup background image here to make sure 
	setupWallpaperOnTop( MYEXTENSION_SETTINGS.imgUrl, MYEXTENSION_SETTINGS.opacity );

		// console.log('[Azure Portal Extention] Current URI = ' + window.location.href);
	if( window.location.href.indexOf('resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups') != -1 ||
		window.location.href.indexOf('view/HubsExtension/BrowseResourceGroups') != -1)
	{
		if(MYEXTENSION_SETTINGS.isHighlightEmptyRG) doUpdateResourcegrouplist();
	}
	
	setTimeout( () => doURICheckLoop(), 500);
}
doURICheckLoop();

function doUpdateResourcegrouplist(){
	console.log('[Azure Portal Extention] doUpdateResourcegrouplist()')
	// pick up top element of resource group list, this css class sometimes change depending on timing
	const resourceArray = jQuery('div.fxc-gc-rows div.fxc-gc-row');

	resourceArray.each( (index, elem) => {
		// pickup resource grups name
		const resourceGroupElem = jQuery(elem).find('div.fxc-gc-row-content a:nth-child(2)');
		const resourceGroupName = resourceGroupElem.text();
		// pick up subscription name
		const subscriptionname  = jQuery(elem).find('div.fxc-gc-row-content a:nth-child(1)').text();
		for( var i=0; i<emptyResourcegroups.count ; i++){
			if(emptyResourcegroups.data[i].resourceGroup ==  resourceGroupName.toLowerCase() &&
				emptyResourcegroups.data[i].subscriptionName == subscriptionname){
				$(resourceGroupElem).text($(resourceGroupElem).text() + MYEXTENSION_SETTINGS.addText);
				$(resourceGroupElem).attr('style', 'color: ' + MYEXTENSION_SETTINGS.color + ';');
			}
		}
	});
}

function bluerUsernameAndAADTenant() {
	const usernameElem = jQuery(APP_CONST_VALUES.SELECT_USERNAME);
	if(usernameElem.length){
		if(MYEXTENSION_SETTINGS.isUsernameBluer == true) jQuery(usernameElem).attr('style','filter: blur(2px);');
		if(MYEXTENSION_SETTINGS.isAADTenantBluer == true) jQuery(APP_CONST_VALUES.SELECT_TENANTNAME).attr('style','filter: blur(2px);');
	}else{
		setTimeout( () => bluerUsernameAndAADTenant(), 1000);
	}
}
