#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'CI only';exit 2; }
backup=$(mktemp)
cp src/api/credentialLifecycle.ts "$backup"
trap 'cp "$backup" src/api/credentialLifecycle.ts;rm -f "$backup"' EXIT
python3 - <<'PY'
from pathlib import Path
p=Path('src/api/credentialLifecycle.ts');s=p.read_text()
needle='"X-Komari-Credential-Authorization": token'
assert s.count(needle)==1
p.write_text(s.replace(needle,'"X-Broken-Credential": token'))
PY
set +e
bash scripts/ci/run-audit-check.sh credential-broken-header node --import ./tests/credential/register.mjs --test --test-reporter=tap tests/credential/components.test.ts
status=$?
set -e
[[ "$status" -ne 0 ]] || { echo 'Missing credential header unexpectedly passed';exit 1; }
python3 - <<'PY'
from pathlib import Path
s=Path('ci-artifacts/credential-broken-header.log').read_text()
assert 'not ok 1 - real credential component requires fresh scoped verification and posts frozen policy' in s
assert 'AssertionError' in s or 'ERR_ASSERTION' in s
print('Missing proof header caused the intended runtime assertion failure.')
PY
