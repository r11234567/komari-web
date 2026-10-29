from pathlib import Path
import re
log=Path('ci-artifacts/workspace-components.log').read_text()
assert re.search(r'^# tests 2$',log,re.M), 'missing component tests'
assert re.search(r'^# pass 2$',log,re.M), 'components did not both pass'
for label in ['fail','cancelled','skipped']:
 assert re.search(r'^# '+label+r' 0$',log,re.M), label
for name in ['file-only workspace verifies above the editor portal','terminal page shares a single real live provider']:
 assert re.search(r'^ok [0-9]+ - '+re.escape(name),log,re.M),name
print('Observed real portal/OTP interaction and live stream transitions, 2 passed, no skips.')
