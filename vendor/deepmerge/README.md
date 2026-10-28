# Private security patch

This is a private fork of upstream deepmerge 4.3.1, MIT licensed. Version 4.3.2 identifies this local workspace only; it is not a published upstream release. Source: https://registry.npmjs.org/deepmerge/-/deepmerge-4.3.1.tgz (integrity recorded in the prior lockfile).

GHSA-gcqx-w48m-w2h4 can poison the returned object through a target with an enumerable own `__proto__` key or a source merged into a null-prototype target. All three destination assignments now define own data properties instead of invoking inherited setters. The existing inherited/non-enumerable source-key checks remain. Arrays, symbols, custom merges and cloning preserve the existing API.

The npm workspace resolves Rollup's transitive dependency to this reviewed source. CI verifies resolution from the actual Rollup importer, reproduces both exploit paths against the original assignment behavior, checks the patched result, audits all dependencies at low severity, and builds both UIs. Remove this fork once upstream provides a reviewed fix.
