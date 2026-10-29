#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'CI only'; exit 2; }
backup=$(mktemp -d)
cp src/pages/terminal/WorkspaceBoundary.tsx src/pages/terminal/TerminalPageBoundary.tsx "$backup/"
trap 'cp "$backup/WorkspaceBoundary.tsx" src/pages/terminal/WorkspaceBoundary.tsx; cp "$backup/TerminalPageBoundary.tsx" src/pages/terminal/TerminalPageBoundary.tsx; rm -rf "$backup"' EXIT
for mode in portal provider; do
 cp "$backup/WorkspaceBoundary.tsx" src/pages/terminal/WorkspaceBoundary.tsx
 cp "$backup/TerminalPageBoundary.tsx" src/pages/terminal/TerminalPageBoundary.tsx
 python3 - "$mode" <<'PY'
from pathlib import Path
import sys
if sys.argv[1]=='portal':
 p=Path('src/pages/terminal/WorkspaceBoundary.tsx');s=p.read_text()
 assert '<Dialog.Portal>' in s
 p.write_text(s.replace('<Dialog.Portal>','<>').replace('</Dialog.Portal>','</>'))
else:
 p=Path('src/pages/terminal/TerminalPageBoundary.tsx');s=p.read_text()
 assert '<LiveDataProvider>' in s
 p.write_text(s.replace('<LiveDataProvider>','<>').replace('</LiveDataProvider>','</>'))
PY
 set +e
 bash scripts/ci/run-audit-check.sh "workspace-broken-$mode" node --import ./tests/workspace-ui/setup.mjs --import ./tests/workspace-ui/register.mjs --test --test-reporter=tap tests/workspace-ui/components.test.ts
 status=$?
 set -e
 [[ "$status" -ne 0 ]] || { echo "Broken $mode unexpectedly passed";exit 1; }
 python3 - "$mode" <<'PY'
from pathlib import Path
import sys,re
mode=sys.argv[1];log=Path('ci-artifacts/workspace-broken-'+mode+'.log').read_text()
expected='unlock remains in original stacking context' if mode=='portal' else 'terminal route omitted or duplicated live stream'
assert expected in log, 'negative control failed for unrelated reason'
assert re.search(r'^not ok [0-9]+ - ',log,re.M), 'missing actual assertion failure'
print('Observed intended runtime failure with disabled '+mode+'; complete logs retained.')
PY
done
