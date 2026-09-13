#!/usr/bin/env bash
set -euo pipefail

START=9f75403c948ccf26b9bc644f3f476683d74bb522
OLD_0047_BLOB=9c74aea5dcab2b83b1ca384eaad9eaf1ac1194ea
CANDIDATE_BRANCH=o1/f-integration-closure-i2
SOURCE_WORKFLOW=.github/workflows/o1f-i2-automation.yml
WORK=/tmp/o1f-i2-candidate
EXACT=/tmp/o1f-i2-exact

rm -rf "$WORK" "$EXACT"
git fetch origin "$CANDIDATE_BRANCH"
test "$(git rev-parse origin/$CANDIDATE_BRANCH)" = "$START"
git worktree add --detach "$WORK" "$START"
cd "$WORK"
test "$(git rev-parse HEAD)" = "$START"
test "$(git hash-object supabase/policies/0047_o1_owner_analytics_authority.sql)" = "$OLD_0047_BLOB"
test -z "$(git status --porcelain)"

# Reuse the already-reviewed payload embedded in the temporary automation file.
# The temporary workflow is never part of the candidate branch.
python3 - "$OLDPWD/$SOURCE_WORKFLOW" <<'PY'
from pathlib import Path
import sys, textwrap
src = Path(sys.argv[1]).read_text()

def between(start, end):
    if start not in src:
        raise SystemExit(f'missing start marker: {start}')
    tail = src.split(start, 1)[1]
    if end not in tail:
        raise SystemExit(f'missing end marker: {end!r}')
    return tail.split(end, 1)[0]

sql = between("cat >> supabase/policies/0047_o1_owner_analytics_authority.sql <<'SQL'\n", "\nSQL\n")
Path('/tmp/o1f-i2.sql').write_text(sql + '\n')

py = between("python3 - <<'PY'\n", "\n          PY\n")
Path('/tmp/o1f-i1-transform.py').write_text(textwrap.dedent(py) + '\n')

js = between("cat > scripts/verify-o1f-i2-contract.mjs <<'JS'\n", "\nJS\n")
# Remove a dead diagnostic that deliberately referenced a nonexistent column;
# caught client-side SQL errors still abort a PostgreSQL transaction.
bad = '''    const [{ n }] = await tx`\n      select count(*)::int as n from telemetry_day_coverage\n      where doctor_id is null\n    `.catch(() => [{ n: -1 }]);\n    void n;\n'''
if bad not in js:
    raise SystemExit('expected verifier diagnostic block not found')
js = js.replace(bad, '')
Path('/tmp/verify-o1f-i2-contract.mjs').write_text(js + '\n')
PY

cat /tmp/o1f-i2.sql >> supabase/policies/0047_o1_owner_analytics_authority.sql
python3 /tmp/o1f-i1-transform.py
cp /tmp/verify-o1f-i2-contract.mjs scripts/verify-o1f-i2-contract.mjs
node --check scripts/verify-o1f-i1-contract.mjs
node --check scripts/verify-o1f-i2-contract.mjs
git diff --check

# Candidate inventory and ancestry are frozen before any runtime execution.
git config user.name "Doctor's Diary O1-F-I2 CI"
git config user.email "o1-f-i2@users.noreply.github.com"
git add \
  supabase/policies/0047_o1_owner_analytics_authority.sql \
  scripts/verify-o1f-i1-contract.mjs \
  scripts/verify-o1f-i2-contract.mjs
git commit -m "feat(o1-f-i2): close activity reconciliation contract"
CANDIDATE_SHA=$(git rev-parse HEAD)
test "$(git rev-parse HEAD^)" = "$START"
printf '%s\n' \
  scripts/verify-o1f-i1-contract.mjs \
  scripts/verify-o1f-i2-contract.mjs \
  supabase/policies/0047_o1_owner_analytics_authority.sql \
  | sort > /tmp/expected-files
git diff --name-only "$START" HEAD | sort > /tmp/actual-files
diff -u /tmp/expected-files /tmp/actual-files
CANDIDATE_0047_BLOB=$(git hash-object supabase/policies/0047_o1_owner_analytics_authority.sql)
CANDIDATE_0047_SHA256=$(sha256sum supabase/policies/0047_o1_owner_analytics_authority.sql | awk '{print $1}')
echo "F_I2_CANDIDATE_SHA=$CANDIDATE_SHA"
echo "F_I2_CANDIDATE_0047_BLOB=$CANDIDATE_0047_BLOB"
echo "F_I2_CANDIDATE_0047_SHA256=$CANDIDATE_0047_SHA256"
echo "F_I2_CHANGED_FILES=PASS"

# Exact detached clean worktree. Dependencies are installed without scripts and
# the tree is rechecked before runtime verification.
cd "$OLDPWD"
git worktree add --detach "$EXACT" "$CANDIDATE_SHA"
cd "$EXACT"
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
test "$(git hash-object supabase/policies/0047_o1_owner_analytics_authority.sql)" = "$CANDIDATE_0047_BLOB"
test -z "$(git status --porcelain)"
npm ci --ignore-scripts
test -z "$(git status --porcelain)"
echo "F_I2_PREVERIFY_HEAD=$CANDIDATE_SHA"
echo "F_I2_PREVERIFY_0047_BLOB=$CANDIDATE_0047_BLOB"

verifiers=(
  scripts/verify-o1f-activity-day-grain.mjs
  scripts/verify-o1f-owner-aal2-and-consent.mjs
  scripts/verify-o1f-owner-surface.mjs
  scripts/verify-o1f-pilot-plane-isolation.mjs
  scripts/verify-o1f-r2-contract.mjs
  scripts/verify-o1f-r3-contract.mjs
  scripts/verify-o1f-i1-contract.mjs
  scripts/verify-o1f-i2-contract.mjs
)

i=0
for verifier in "${verifiers[@]}"; do
  i=$((i+1))
  name="o1fi2pg${i}_${GITHUB_RUN_ID:-local}"
  port=$((55430+i))
  echo "===== RUN $i/8: $verifier ====="
  docker run -d --name "$name" \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_DB=o1f \
    -p "127.0.0.1:${port}:5432" \
    postgres:17 >/dev/null
  cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  for n in $(seq 1 45); do
    if docker exec "$name" pg_isready -U postgres -d o1f >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker exec "$name" pg_isready -U postgres -d o1f >/dev/null
  DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${port}/o1f" node "$verifier"
  cleanup
  trap - EXIT
  echo "===== PASS: $verifier ====="
done
echo "F_I2_EIGHT_VERIFIERS=PASS"

# Post-execution exact-SHA integrity and frozen migration preservation.
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
test "$(git hash-object supabase/policies/0047_o1_owner_analytics_authority.sql)" = "$CANDIDATE_0047_BLOB"
test "$(sha256sum supabase/policies/0047_o1_owner_analytics_authority.sql | awk '{print $1}')" = "$CANDIDATE_0047_SHA256"
test -z "$(git status --porcelain)"
test -z "$(find supabase/policies -maxdepth 1 -type f -name '0048*' -print -quit)"
git diff --exit-code "$START" -- \
  supabase/policies/0041_prescription_correction_window.sql \
  supabase/policies/0042_m3_prescription_reuse.sql \
  supabase/policies/0043_m3_signed_medicine_history.sql \
  supabase/policies/0044_m3_prescription_print_audit.sql \
  supabase/policies/0045_prelaunch_sec01b_security_closure.sql \
  supabase/policies/0046_prelaunch_sec01b_postapply.sql

echo "F_I2_POSTVERIFY_HEAD=$CANDIDATE_SHA"
echo "F_I2_POSTVERIFY_0047_BLOB=$CANDIDATE_0047_BLOB"
echo "F_I2_POSTVERIFY_0047_SHA256=$CANDIDATE_0047_SHA256"
echo "F_I2_POSTVERIFY_CLEAN=PASS"
echo "F_I2_0041_0046_PRESERVED=PASS"
echo "F_I2_NO_0048=PASS"

# Candidate branch moves only after every exact-SHA verifier has passed.
git push origin "$CANDIDATE_SHA":refs/heads/$CANDIDATE_BRANCH
echo "F_I2_PUSHED_SHA=$CANDIDATE_SHA"
