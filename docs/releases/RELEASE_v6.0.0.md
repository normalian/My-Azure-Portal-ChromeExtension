# My Azure Portal Extension v6.0.0

## Highlights

- **New: Azure Tab Icon is ON by default.**
- Browser tab icons follow the visible Azure service blade, making Azure Portal tabs easier to distinguish.
- No extension sign-in or additional permissions are required.
- Onboarding explains the new feature and how to disable it.

## User-facing behavior

- Previously saved Azure Tab Icon preferences are preserved.
- Disable the feature under **Works without sign-in features > Azure Tab Icon** and save settings.
- The original favicon is restored when disabled or when no supported blade icon is available, including Home.
- Inline SVGs, in-page SVG symbols, images, and CSS background images are supported; external SVG sprites are not supported.
- Subscription background management remains unpublished and its popup button is not shown.
- Existing authentication, privacy masking, and opt-in telemetry behavior is preserved.

## Development and packaging

- Runtime files are consolidated under `extension/`; documentation assets are under `docs/`.
- Settings and Chrome API helpers are shared across extension pages, content scripts, and the worker.
- The release ZIP contains the extension manifest at its root.

## Upgrade

- Reload the extension and refresh existing Azure Portal tabs after upgrading.
- For unpacked development installs, load the `extension/` folder.

## Full history

See [CHANGELOG.md](../../CHANGELOG.md) for the complete project history.
