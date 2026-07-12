# Changelog

All notable changes to this project are documented in this file.

This changelog was reconstructed from repository commit history.

## [0.4.1] - 2026-07-12

- Fixed:
  - Corrected `Extention` to `Extension` across project files.
- Added:
  - Developer-only `Send telemetry now` action in the popup for immediate telemetry validation.
- Changed:
  - Replaced the hard-coded Application Insights connection string with a dummy placeholder for safe commits.
  - Developer telemetry tools are hidden from general users.

## [0.4.0] - 2026-07-09

- Added:
  - Independent Entra ID OAuth sign-in flow in extension popup (`Sign in` / `Sign out`).
  - Token cache and lifecycle handling in extension storage.
- Changed:
  - Authentication model updated from legacy/manual-token style to popup sign-in UX.
  - Manifest and popup-related configuration adjusted for current extension behavior.
- Notes:
  - This release marks the major authentication refresh milestone after long-term maintenance.

## [0.3.x] - 2023-08

- Changed:
  - Extension architecture updated to newer Chrome extension requirements.
- Fixed:
  - Empty resource group highlight feature restored after extension architecture changes.

## [0.2.x] - 2020-12 to 2021-02

- Added:
  - Empty resource group customization (label text and color settings).
  - Privacy masking feature for account and tenant display (blur/mask behavior).
  - Option to disable empty resource group highlight.
- Changed:
  - Empty resource group detection logic updated to use Azure Resource Graph.
  - UI labels/defaults and visual assets updated.

## [0.1.x] - 2018-04 to 2020-05

- Added:
  - Initial extension release with Azure portal UI enhancements.
  - Wallpaper/background customization for top page.
- Changed:
  - README/docs and compatibility updates for Chrome specification changes.
- Removed:
  - Legacy feature to pick up access token was removed (`2020-05-08`).

---

## Timeline (8-year journey)

- 2018: Initial public commits and extension baseline.
- 2019: Chrome compatibility and maintenance updates.
- 2020-2021: Major feature expansion for UI customization and privacy masking.
- 2023: Extension architecture modernization and feature recovery.
- 2026: v0.4.0 authentication refresh milestone, followed by v0.4.1 maintenance and telemetry tooling updates.

