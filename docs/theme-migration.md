# Theme migration: JSON-RPC2 to Connect-Web

Komari's theme manifest remains transport-independent. The current manifest
contract is `schemaVersion: 1`; manifests without `schemaVersion` are treated as
v1 so existing third-party themes continue to load unchanged.

## Manifest contract

- Keep `komari-theme.json` at the theme root.
- Set top-level `schemaVersion` to `1` for newly published themes.
- Keep the existing `configuration.type` values: `managed`, `raw`, or
  `redirect`.
- Use Radix theme tokens and the existing Komari CSS classes. Do not import
  frontend-internal contexts, generated protobuf modules, or transport clients
  from a theme bundle.
- Treat public settings and node data as application data. Do not call
  `/api/rpc2` directly from a theme.

## Browser API migration

The default frontend now prefers generated Connect-Web clients and retains the
old endpoints only as compatibility adapters for older Backends.

| Existing browser data | Connect procedure | Compatibility adapter |
| --- | --- | --- |
| Public site and theme settings | `BrowserService.GetPublicInfo` | `GET /api/public` |
| Visible node list | `BrowserService.ListAgents` | `common:getNodes` |
| Node detail | `BrowserService.GetAgent` | Existing typed frontend adapter until migrated |
| Theme contract | `BrowserService.GetThemeContract` | Missing `schemaVersion` means v1 |

Fallback occurs only when the Connect procedure is unavailable or
unimplemented. Authentication, authorization, validation, cancellation,
deadline, and revision failures are returned to the caller and never retried
through JSON-RPC2.

Every frontend request owns an `AbortSignal` and a deadline. Theme code should
use the host application's public data interfaces rather than creating a second
transport; this lets cancellation, permissions, capability checks, and future
protocol changes remain under Komari's control.

## Sensitive operations

Themes must not provide a direct remote execution path. Execution and WebSSH
interfaces are capability-aware, respect the Backend and Agent remote-control
gates, and require fresh 2FA for each sensitive request. The Backend is the
enforcement boundary even when a theme supplies custom presentation.

## Validation and release

Build, render smoke tests, Connect compatibility tests, and third-party theme
fixtures run in GitHub Actions. The repositories pin a released
`komari-proto` tag; generated files are not edited in the frontend or theme.
During the compatibility window, verify both the current default theme and a v1
manifest without `schemaVersion` before publishing.
