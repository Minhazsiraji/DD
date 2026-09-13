#!/usr/bin/env bash
set -euo pipefail
cp .ci/o1f-i2-bootstrap.sh /tmp/o1f-i2-bootstrap-debug.sh
python3 - <<'PY'
from pathlib import Path
p = Path('/tmp/o1f-i2-bootstrap-debug.sh')
s = p.read_text()
old = 'node --check scripts/verify-o1f-i2-contract.mjs\n'
new = '''if ! node --check scripts/verify-o1f-i2-contract.mjs; then\n  echo '===== GENERATED I2 VERIFIER AROUND SYNTAX FAILURE ====='\n  nl -ba scripts/verify-o1f-i2-contract.mjs | sed -n '440,485p'\n  exit 1\nfi\n'''
if s.count(old) != 1:
    raise SystemExit(f'node-check anchor mismatch: {s.count(old)}')
p.write_text(s.replace(old, new, 1))
PY
bash /tmp/o1f-i2-bootstrap-debug.sh
