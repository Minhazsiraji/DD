#!/usr/bin/env bash
set -euo pipefail
cp .ci/o1f-i2-bootstrap.sh /tmp/o1f-i2-bootstrap-v4-run.sh
python3 - <<'PY'
from pathlib import Path
p = Path('/tmp/o1f-i2-bootstrap-v4-run.sh')
s = p.read_text()
needle = '''cp /tmp/verify-o1f-i2-contract.mjs scripts/verify-o1f-i2-contract.mjs
node --check scripts/verify-o1f-i1-contract.mjs
'''
replacement = '''cp /tmp/verify-o1f-i2-contract.mjs scripts/verify-o1f-i2-contract.mjs
python3 "$OLDPWD/.ci/o1f-i2-postprocess.py"
node --check scripts/verify-o1f-i1-contract.mjs
'''
if s.count(needle) != 1:
    raise SystemExit(f'bootstrap injection anchor mismatch: {s.count(needle)}')
p.write_text(s.replace(needle, replacement, 1))
PY
bash /tmp/o1f-i2-bootstrap-v4-run.sh
