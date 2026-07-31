# Privacy Policy — My Azure Portal Extension

**Last updated:** July 30, 2026

My Azure Portal Extension ("the extension") is a browser extension for Chrome and Microsoft Edge that enhances the Azure Portal (portal.azure.com) browsing experience. This page explains what data the extension handles, why, and how it is stored.

## Summary

- The extension does not collect, sell, or share any personally identifiable information.
- Telemetry is **off by default** and only sends anonymous, aggregate feature-usage counts if you explicitly opt in.
- Your Microsoft Entra ID sign-in tokens are stored **only on your own device** and are never sent to the developer.

## Data the extension accesses

### 1. Microsoft Entra ID authentication tokens

When you choose to sign in, the extension uses your browser's `chrome.identity` API to complete an OAuth 2.0 sign-in with your own Microsoft Entra ID account. The resulting access token and refresh token are stored locally in your browser (`chrome.storage.local`) so you do not have to sign in repeatedly. These tokens:

- Are used only to call the Azure Resource Manager API (`management.azure.com`) and Microsoft Graph (`graph.microsoft.com`) **on your behalf**, from your own browser.
- Are never transmitted to the developer or to any server operated by the developer.
- Can be cleared at any time by signing out from the extension's settings popup.

### 2. Azure resource and role assignment data

To provide features such as highlighting empty resource groups and showing your own direct RBAC role assignments, the extension calls Azure Resource Manager APIs directly from your browser using your own access token. This data is displayed to you locally and is not sent to the developer.

### 3. Anonymous feature-usage telemetry (opt-in only)

If you explicitly opt in from the extension's settings, the extension sends anonymous usage events to the developer's Azure Application Insights resource. Each event contains only:

- The name of the feature used (e.g. "background-image", "mask-subscription-id")
- A usage count
- The extension version

No user identifier, tenant name, subscription ID, email address, or any other personal or organizational data is included in telemetry events. Telemetry is batched locally and sent at most once per day. You can opt in or out at any time from the extension's settings popup, and no telemetry is sent unless you have explicitly opted in.

### 4. Local settings

Your extension preferences (background image URL, masking toggles, RBAC panel visibility, etc.) are stored locally in your browser via `chrome.storage` and are never transmitted anywhere.

## Data we do not collect

The extension does not collect or transmit: browsing history outside the Azure Portal, personally identifiable information, financial or payment information, health information, personal communications, or precise location data.

## Third-party services

- **Microsoft Entra ID** (`login.microsoftonline.com`) — used for authentication. Governed by [Microsoft's privacy statement](https://privacy.microsoft.com/).
- **Azure Resource Manager / Microsoft Graph** (`management.azure.com`, `graph.microsoft.com`) — called directly from your browser with your own credentials to read your own Azure data.
- **Azure Application Insights** (`dc.services.visualstudio.com`, `*.in.applicationinsights.azure.com`) — receives anonymous telemetry events only if you opt in, as described above.

## Data retention and deletion

- Authentication tokens and settings stored locally are removed when you sign out, disable telemetry, or uninstall the extension.
- Telemetry events sent to Application Insights (only if opted in) are retained according to the developer's Application Insights workspace retention settings and contain no data that identifies you individually.

## Changes to this policy

This policy may be updated as the extension's features change. The "Last updated" date at the top of this page reflects the most recent revision.

## Contact

For questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/normalian/My-Azure-Portal-ChromeExtension).