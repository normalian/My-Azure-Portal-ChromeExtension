# My Azure Portal Extension v0.4.1

## Highlights

- Fixed naming typo from `Extention` to `Extension` across the project.
- Added a developer-only `Send telemetry now` action in the popup for immediate telemetry testing.
- Restricted the telemetry test action so it is hidden from general users.
- Replaced the hard-coded Application Insights connection string with a dummy placeholder for safe source control handling.

## Why this release matters

This is a maintenance and developer-experience release. It improves project consistency, makes telemetry verification easier during local development, and avoids committing real telemetry secrets into the repository.

## Notes

- The `Send telemetry now` control is intended for unpacked development installs only.
- General users do not see the developer telemetry action in the popup.

## Full history

See `CHANGELOG.md` for the complete project history.
