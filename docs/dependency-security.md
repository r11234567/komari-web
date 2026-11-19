# Build dependency security overrides

The dependency audit includes development dependencies and retains its low
severity threshold. No advisory is suppressed to pass the check.

The lockfile pins `minimatch` to 11.0.1 and `glob` to 14.0.2 through npm
overrides. These are the patched versions for
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
(pattern preprocessing amplification) and
[GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
(continued filesystem traversal after cancellation). The affected transitive
paths include ESLint, typescript-eslint, FileList, and Workbox/PWA builds.

These overrides cross transitive major-version ranges. In addition to running
the complete lint/test/theme/system build checks, `test:dependency-security`
exercises real ESLint legacy override selection, Workbox file discovery/hash
generation, and FileList filtering. The existing local deepmerge security
regressions remain enabled. Remove an override only when the parent dependency
resolves a fixed version and those checks continue to pass.
