# My Azure Portal Extension v0.4.4

## Highlights

- Added optional masking for UUID-formatted subscription IDs displayed throughout Azure Portal.
- Added subscription ID masking to the extension settings alongside account and tenant masking.
- Changed Direct user RBAC visibility to be disabled by default for new or previously unconfigured installs.
- Updated documentation and screenshots for the current settings and masking behavior.

## Notes

- Existing saved RBAC visibility settings are preserved.
- Subscription ID masking applies to UUID-formatted values rendered in regular portal content, tables, links, input fields, and supported shadow DOM content.
- Reload the extension and refresh existing Azure Portal tabs after upgrading.

## Full history

See `CHANGELOG.md` for the complete project history.
