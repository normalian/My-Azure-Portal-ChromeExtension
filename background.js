'use strict';

var subscriptionIDs = new Array();
console.log('[Azure Portal Extention] start background.js');

// return subscriptionList to scripts.js
chrome.runtime.onConnect.addListener( port => {
	console.log('[Azure Portal Extention] background.js#addListener: ' + port.name);
	port.onMessage.addListener( async arg => {
		if( arg.name == "get-subscriptions-accesstoken" ){
			var res = await fetch( "https://management.azure.com/subscriptions?api-version=2022-12-01", {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ` + arg.authorizationToken,
					'Content-Type': 'application/json'
				},
            });
            var idArray = await res.json();

            if( idArray.error){
                console.log( idArray.error ); //TODO: Need to update to notify users this error
                port.postMessage( {
                    name: "get-access-function",
                    error: idArray.error
                });
                return false;
            }else{
                //console.log(subscriptionIds);
                for( var i=0; i<idArray.value.length ; i++){
                        // example of each subscriptionID item
                        // {
                        //     "id": "/subscriptions/f5e8cee7-292a-4e38-a1b5-9c21fc881226",
                        //     "authorizationSource": "RoleBased",
                        //     "managedByTenants": [],
                        //     "subscriptionId": "f5e8cee7-292a-4e38-a1b5-9c21fc881226",
                        //     "tenantId": "b7501d50-50bf-4080-bfaa-912394380b1a",
                        //     "displayName": "Microsoft Azure Enterprise",
                        //     "state": "Enabled",
                        //     "subscriptionPolicies": {
                        //         "locationPlacementId": "Public_2014-09-01",
                        //         "quotaId": "EnterpriseAgreement_2014-09-01",
                        //         "spendingLimit": "Off"
                        //     }
                        // }
                        subscriptionIDs.push(idArray.value[i].subscriptionId);
                } 
                port.postMessage( {
                    name: "get-access-function",
                    subscriptions: idArray.value
                });
            }
            return true;
		}if( arg.name="get-empty-resourcegroups"){
			// console.log("################################# get-empty-resourcegroups");
			// REST API call to get empty resource grups with subscription name
			var data = {
				"subscriptions" :subscriptionIDs,
				"query" : "ResourceContainers | where type == 'microsoft.resources/subscriptions/resourcegroups' | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | join kind=leftouter (Resources | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | summarize count() by rgAndSub ) on rgAndSub | where isnull(count_) | project-away rgAndSub1, count_ | join kind=leftouter (ResourceContainers | where type=='microsoft.resources/subscriptions' | project subscriptionName=name, subscriptionId) on subscriptionId | project-away subscriptionId1"
			};

			var res = await fetch('https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ` + arg.authorizationToken,
					'Content-Type': 'application/json'
				},
				dataType: 'json',
				body : JSON.stringify(data) // required to pass parameters as json body
			});
            var rgArray = await res.json();
            port.postMessage( {
                name : "get-empty-resourcegroups",
                emptyResourcegroups: rgArray
            });
			return true;
		}
	});
});