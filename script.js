'use strict';

console.log('[Azure Portal Extention] start script.js');

const extentionSettings = {
  imgUrl : null,
  opacity : 0.8,
  isUsernameBluer : false,
  isAADTenantBluer : false,
};

const APP_CONST_VALUES = {
	SELECT_STARTBOARD_LAYOUT : 'div.fxs-startboard-layout.fxs-flowlayout',
	SELECT_HOME_CONTAINER : 'div.fxs-home-container.fxs-portal-text',
	SELECT_USERNAME : 'div.fxs-avatarmenu-username',
	SELECT_TENANTNAME : 'div.fxs-avatarmenu-tenant',
	RG_URLS : [
		'resourceType/Microsoft.Resources%2Fsubscriptions%2FresourceGroups',
		'blade/HubsExtension/BrowseResourceGroups'
	],
	SELECT_RGNAME : 'div.fxc-gc-row-content a:nth-child(2)',
	SELECT_SUBNAME : 'div.fxc-gc-row-content a:nth-child(1)',
	SELECT_RGLIST : 'div.fxc-gc-rows div.fxc-gc-row'
};

// This delay process is important to add elements on Azure portal for delay read.
function showMessageOnAzurePortalTopLoop() {
	const elem = jQuery(APP_CONST_VALUES.SELECT_STARTBOARD_LAYOUT);
	if( elem.length > 0 ){
		// read user setup info and setup wallpaper
		chrome.storage.sync.get(
			extentionSettings,
			function(items) {
				extentionSettings.imgUrl = items.imgUrl;
				extentionSettings.opacity = items.opacity;
				extentionSettings.isUsernameBluer = items.isUsernameBluer;
				extentionSettings.isAADTenantBluer = items.isAADTenantBluer;

				// call Bluer function after reading out settings
				bluerUsernameAndAADTenant();
			}
		);
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
	setupWallpaperOnTop( extentionSettings.imgUrl, extentionSettings.opacity );
	setTimeout( () => doURICheckLoop(), 500);
}
doURICheckLoop();

function bluerUsernameAndAADTenant() {
	const usernameElem = jQuery(APP_CONST_VALUES.SELECT_USERNAME);
	if(usernameElem.length){
		if(extentionSettings.isUsernameBluer == true) jQuery(usernameElem).attr('style','filter: blur(2px);');
		if(extentionSettings.isAADTenantBluer == true) jQuery(APP_CONST_VALUES.SELECT_TENANTNAME).attr('style','filter: blur(2px);');
	}else{
		setTimeout( () => bluerUsernameAndAADTenant(), 1000);
	}
}
