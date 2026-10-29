from pathlib import Path
import re
p=Path('ci-artifacts/credential-components.log')
log=p.read_text()
for name in (
 'real credential component requires fresh scoped verification and posts frozen policy',
 'real credential component binds reapproval to selected generation and disables revoked nodes',
 'credential policy bounds and missing-proof checks reject before network mutation',
):
 assert re.search(r'^ok \d+ - '+re.escape(name)+r'$',log,re.M), name
for summary in ('# tests 3','# pass 3','# fail 0','# skipped 0'):
 assert summary in log,summary
print('Observed all three real component/API tests, no skips or failures.')
