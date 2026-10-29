#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'CI only'; exit 2; }
backup=$(mktemp -d)
cp src/pages/terminal/WorkspaceBoundary.tsx src/pages/terminal/TerminalPageBoundary.tsx src/pages/terminal/WorkspaceSurface.tsx "$backup/"
trap 'cp "$backup/WorkspaceBoundary.tsx" src/pages/terminal/WorkspaceBoundary.tsx; cp "$backup/TerminalPageBoundary.tsx" src/pages/terminal/TerminalPageBoundary.tsx; cp "$backup/WorkspaceSurface.tsx" src/pages/terminal/WorkspaceSurface.tsx; rm -rf "$backup"' EXIT
for mode in portal provider collected; do
 cp "$backup/WorkspaceBoundary.tsx" src/pages/terminal/WorkspaceBoundary.tsx
 cp "$backup/TerminalPageBoundary.tsx" src/pages/terminal/TerminalPageBoundary.tsx
 cp "$backup/WorkspaceSurface.tsx" src/pages/terminal/WorkspaceSurface.tsx
 python3 - "$mode" <<'PY'
from pathlib import Path
import sys
if sys.argv[1]=='portal':
 p=Path('src/pages/terminal/WorkspaceBoundary.tsx');s=p.read_text()
 assert '<Dialog.Portal>' in s
 p.write_text(s.replace('<Dialog.Portal>','<>').replace('</Dialog.Portal>','</>'))
elif sys.argv[1]=='provider':
 p=Path('src/pages/terminal/TerminalPageBoundary.tsx');s=p.read_text()
 assert '<LiveDataProvider>' in s
 p.write_text(s.replace('<LiveDataProvider>','<>').replace('</LiveDataProvider>','</>'))
else:
 p=Path('src/pages/terminal/WorkspaceSurface.tsx');s=p.read_text()
 before='(workspaceState.knownAgents.has(agentId) || workspaceState.revision(agentId) > 0)'
 assert before in s
 p.write_text(s.replace(before,'workspaceState.knownAgents.has(agentId)'))
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
expected={'portal':'unlock remains in original stacking context','provider':'terminal route omitted or duplicated live stream','collected':'collected workspace reopened as black screen without lock'}[mode]
assert expected in log, 'negative control failed for unrelated reason'
assert re.search(r'^not ok [0-9]+ - ',log,re.M), 'missing actual assertion failure'
assert re.search(r'^# pass 2$',log,re.M) and re.search(r'^# fail 1$',log,re.M), 'negative control also broke unrelated test'
for label in ['cancelled','skipped']:
 assert re.search(r'^# '+label+r' 0$',log,re.M), 'negative control '+label
print('Observed intended runtime failure with disabled '+mode+'; complete logs retained.')
PY
done
