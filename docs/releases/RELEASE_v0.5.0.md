# My Azure Portal Extension v0.5.0

## Highlights

- Improved first-run onboarding with a clear explanation of:
  - Features that work immediately without sign-in.
  - Features that require optional Entra ID App registration and sign-in.
- Reorganized Extension Settings into:
  - Works without sign-in.
  - Requires sign-in.
  - Optional usage telemetry.

## User-facing behavior

- Background image customization and privacy masking continue to work without sign-in.
- Empty Resource Group highlighting and the Direct user RBAC panel continue to require ARM sign-in.
- Direct user RBAC remains disabled by default.
- Existing authentication and telemetry behavior is preserved.

## Notes

- Reload the extension and refresh existing Azure Portal tabs after upgrading.
- This release focuses on onboarding and settings clarity; no new authentication flow was introduced.

## Full history

See `CHANGELOG.md` for the complete project history.
