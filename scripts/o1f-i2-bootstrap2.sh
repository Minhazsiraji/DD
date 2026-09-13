#!/usr/bin/env bash
set -euo pipefail
START_SHA=9f75403c948ccf26b9bc644f3f476683d74bb522
BRANCH=o1/f-integration-closure-i2

install_postgres_driver() {
  rm -rf node_modules/postgres
  mkdir -p node_modules/postgres
  local tgz
  tgz=$(npm pack postgres@3.4.9 --silent)
  tar -xzf "$tgz" -C node_modules/postgres --strip-components=1
  rm -f "$tgz"
}

python3 - <<'PY'
from pathlib import Path
import subprocess
src = Path('.github/workflows/o1f-i2-builder.yml').read_text().splitlines()
for idx, name in enumerate(['Amend still-unapplied 0047 for F-I2','Add F-I2 contract verifier'], 1):
    marker = f'      - name: {name}'
    start = src.index(marker)
    run_idx = next(i for i in range(start + 1, len(src)) if src[i] == '        run: |')
    end = len(src)
    for i in range(run_idx + 1, len(src)):
        if src[i].startswith('      - name: ') or src[i].startswith('      - uses: '):
            end = i
            break
    body = [line[10:] if line.startswith('          ') else line for line in src[run_idx + 1:end]]
    script = Path(f'/tmp/o1f_i2_body_{idx}.sh')
    script.write_text('\n'.join(body) + '\n')
    subprocess.run(['bash','-euo','pipefail',str(script)], check=True)
PY
python3 scripts/o1f-i2-patch-i1.py

rm -f \
  .github/workflows/o1f-i2-builder.yml \
  .github/workflows/o1f-i2-runner.yml \
  .github/workflows/o1f-i2-smoke.yml \
  scripts/o1f-i2-bootstrap.sh \
  scripts/o1f-i2-bootstrap2.sh \
  scripts/o1f-i2-patch-i1.py \
  o1f-i2-smoke-trigger.txt

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git commit -m "feat(o1-f-i2): close reconciliation runtime races"
FINAL_SHA=$(git rev-parse HEAD)
FINAL_BLOB=$(git rev-parse HEAD:supabase/policies/0047_o1_owner_analytics_authority.sql)
FINAL_SHA256=$(sha256sum supabase/policies/0047_o1_owner_analytics_authority.sql | awk '{print $1}')
echo "FINAL_SHA=$FINAL_SHA"
echo "FINAL_0047_BLOB=$FINAL_BLOB"
echo "FINAL_0047_SHA256=$FINAL_SHA256"
echo "FINAL_CHANGED_FILES:"
git diff --name-only "$START_SHA"..HEAD
git push origin "HEAD:$BRANCH"

git worktree add --detach ../o1f-i2-exact "$FINAL_SHA"
cd ../o1f-i2-exact
[[ $(git rev-parse HEAD) == "$FINAL_SHA" ]]
[[ $(git rev-parse HEAD:supabase/policies/0047_o1_owner_analytics_authority.sql) == "$FINAL_BLOB" ]]
install_postgres_driver

tests=(
  verify-o1f-activity-day-grain.mjs
  verify-o1f-owner-aal2-and-consent.mjs
  verify-o1f-owner-surface.mjs
  verify-o1f-pilot-plane-isolation.mjs
  verify-o1f-r2-contract.mjs
  verify-o1f-r3-contract.mjs
  verify-o1f-i1-contract.mjs
  verify-o1f-i2-contract.mjs
)
i=0
for test in "${tests[@]}"; do
  i=$((i+1))
  db="o1f_i2_${i}"
  createdb -h localhost -U postgres "$db"
  echo "===== $test :: $db ====="
  DATABASE_URL="postgres://postgres:postgres@localhost:5432/$db" node "scripts/$test"
done

echo "POST_HEAD=$(git rev-parse HEAD)"
echo "POST_BLOB=$(git rev-parse HEAD:supabase/policies/0047_o1_owner_analytics_authority.sql)"
echo "POST_SHA256=$(sha256sum supabase/policies/0047_o1_owner_analytics_authority.sql | awk '{print $1}')"
[[ $(git rev-parse HEAD) == "$FINAL_SHA" ]]
[[ $(git rev-parse HEAD:supabase/policies/0047_o1_owner_analytics_authority.sql) == "$FINAL_BLOB" ]]
[[ $(sha256sum supabase/policies/0047_o1_owner_analytics_authority.sql | awk '{print $1}') == "$FINAL_SHA256" ]]
[[ -z $(git status --porcelain) ]]
[[ -z $(git diff --name-only "$START_SHA"..HEAD -- supabase/policies/0041* supabase/policies/0042* supabase/policies/0043* supabase/policies/0044* supabase/policies/0045* supabase/policies/0046*) ]]
[[ -z $(find supabase/policies -maxdepth 1 -type f -name '0048*' -print) ]]
