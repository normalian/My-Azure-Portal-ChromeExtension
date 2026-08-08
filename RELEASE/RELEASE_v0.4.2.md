# My Azure Portal Extension v0.4.2

## Highlights

- Fixed telemetry opt-in saving so the checkbox state is persisted correctly in settings.
- Added a simple release packaging flow that builds `my-azure-portal-extension-v0.4.2.zip` from the template `background.js` plus local secrets.
- Added GitHub Actions workflows for CI and release packaging.

## Why this release matters

This release focuses on developer experience and release hygiene. It removes a confusing settings-save bug, keeps the production telemetry secret out of source control, and makes repeatable release packaging possible from a single command.

## Notes

- Local telemetry configuration is expected in `secrets.local.json`, which is ignored by Git.
- The release build uses the template `background.js` and injects the App Insights connection string at package time.

## Full history

See `CHANGELOG.md` for the complete project history.
