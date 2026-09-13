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

# Reuse the already-reviewed large SQL + I2-verifier bodies from the temporary
# builder source, but patch I1 directly with robust exact snippets below.
python3 - <<'PY'
from pathlib import Path
import subprocess
src = Path('.github/workflows/o1f-i2-builder.yml').read_text().splitlines()
for idx, name in enumerate([
    'Amend still-unapplied 0047 for F-I2',
    'Add F-I2 contract verifier',
], 1):
    marker = f'      - name: {name}'
    start = src.index(marker)
    run_idx = next(i for i in range(start + 1, len(src)) if src[i] == '        run: |')
    end = len(src)
    for i in range(run_idx + 1, len(src)):
        if src[i].startswith('      - name: ') or src[i].startswith('      - uses: '):
            end = i
            break
    body = [line[10:] if line.startswith('          ') else line for line in src[run_idx + 1:end]]
    script = Path(f'/tmp/o1f_i2_step_{idx}.sh')
    script.write_text('\n'.join(body) + '\n')
    subprocess.run(['bash', '-euo', 'pipefail', str(script)], check=True)
PY

python3 - <<'PY'
from pathlib import Path
p = Path('scripts/verify-o1f-i1-contract.mjs')
s = p.read_text()

def repl(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'I1 patch anchor missing: {label}')
    s = s.replace(old, new, 1)

repl(
"""        has_function_privilege('service_role', 'public.record_engagement_minute(uuid,date,text)', 'EXECUTE') as svc_record,
        has_function_privilege('service_role', 'public.snapshot_engagement_minutes(uuid,date)', 'EXECUTE') as svc_snapshot,""",
"""        has_function_privilege('service_role', 'public.record_engagement_minute(uuid,date,timestamptz,text,text)', 'EXECUTE') as svc_record,
        to_regprocedure('public.record_engagement_minute(uuid,date,text)') is null as old_record_absent,
        has_function_privilege('service_role', 'public.snapshot_engagement_minutes(uuid,date)', 'EXECUTE') as svc_snapshot,""",
'acl signatures')

repl(
"""      a.svc_record && a.svc_snapshot && a.svc_ingest_e && a.svc_read_e && a.svc_close_a && a.svc_close_e,""",
"""      a.svc_record && a.old_record_absent && !a.svc_snapshot && a.svc_ingest_e && a.svc_read_e && a.svc_close_a && a.svc_close_e,""",
'acl expectation')

repl(
"""        has_function_privilege('authenticated', 'public.record_engagement_minute(uuid,date,text)', 'EXECUTE') as record,""",
"""        has_function_privilege('authenticated', 'public.record_engagement_minute(uuid,date,timestamptz,text,text)', 'EXECUTE') as record,""",
'authenticated signature')

start = s.index('  console.log("\\n4. A minute idempotency + cross-request snapshot");')
end = s.index('  console.log("\\n5. E event-key idempotency + privacy allowlist");')
new_minute = r'''  console.log("\n4. A minute idempotency + cross-request snapshot");
  const [{ minuteBucket, minuteDay }] = await sql`
    select
      date_trunc('minute', clock_timestamp())::text as "minuteBucket",
      ((date_trunc('minute', clock_timestamp()) at time zone 'UTC')::date)::text as "minuteDay"
  `;
  const first = await sql.begin((tx) => service(tx, async (sp) => {
    const [row] = await sp`
      select public.record_engagement_minute(
        ${minuteDoctorId}, ${minuteDay}::date, ${minuteBucket}::timestamptz,
        'CONSULTATION', 'UTC'
      ) as inserted
    `;
    return row.inserted;
  }));
  const replay = await sql.begin((tx) => service(tx, async (sp) => {
    const [row] = await sp`
      select public.record_engagement_minute(
        ${minuteDoctorId}, ${minuteDay}::date, ${minuteBucket}::timestamptz,
        'CONSULTATION', 'UTC'
      ) as inserted
    `;
    return row.inserted;
  }));
  check(first === true && replay === false, "same doctor/minute/surface is idempotent");

  const [ctx] = await sql.begin((tx) => service(tx, (sp) => sp`
    select * from public.get_activity_reconciliation_context(
      ${minuteDoctorId}, ${minuteDay}::date
    )
  `));
  const snapshot = await sql.begin((tx) => service(tx, (sp) => sp`
    select minute_bucket, surface
    from public.read_activity_reconciliation_minutes(
      ${minuteDoctorId}, ${minuteDay}::date, ${ctx.evidence_generation}, null, null, 10
    )
  `));
  check(snapshot.length === 1 && snapshot[0].surface === "CONSULTATION", "cross-request authoritative snapshot persists");

  await sql.begin(async (tx) => {
    await expectRefused(tx, "closed A surface vocabulary rejects unknown", "O1A_MINUTE_SURFACE_INVALID", async (sp) => {
      await service(sp, (r) => r`
        select public.record_engagement_minute(
          ${minuteDoctorId}, ${minuteDay}::date, ${minuteBucket}::timestamptz,
          'UNKNOWN', 'UTC'
        )
      `);
    });

    await tx`
      insert into public.engagement_minute_store(
        doctor_id, period_day, minute_bucket, surface
      ) values (
        ${minuteDoctorId}, current_date - 3,
        date_trunc('minute', clock_timestamp() - interval '49 hours'),
        'DASHBOARD'
      )
    `;
    const [purged] = await service(tx, (sp) => sp`
      select public.purge_expired_engagement_minutes() as n
    `);
    const [{ stale }] = await tx`
      select count(*)::int as stale
      from public.engagement_minute_store
      where doctor_id = ${minuteDoctorId}
        and minute_bucket < clock_timestamp() - interval '48 hours'
    `;
    check(Number(purged.n) >= 1 && stale === 0, "stale minute rows older than 48h are physically purged");
  });

'''
s = s[:start] + new_minute + s[end:]

needle = """    check(stillA.state === \"NOT_MEASURED\", \"failed Activity closeout leaves Not measured\");

    await service(tx, (sp) => sp`
      select public.finalize_activity_measurement_day(${targetDay}::date, 1, true)
    `;"""
replacement = """    check(stillA.state === \"NOT_MEASURED\", \"failed Activity closeout leaves Not measured\");

    for (const doctor of doctors) {
      await service(tx, (sp) => sp`
        select public.acknowledge_activity_reconciliation(
          ${doctor.doctorId}, ${targetDay}::date, 0
        )
      `;
    }
    const [wm] = await service(tx, (sp) => sp`
      select * from public.get_activity_reconciliation_day_watermark(${targetDay}::date)
    `);
    await service(tx, (sp) => sp`
      select public.acknowledge_activity_reconciliation_day(
        ${targetDay}::date, ${wm.evidence_generation}, ${wm.eligible_doctor_count}
      )
    `;

    await service(tx, (sp) => sp`
      select public.finalize_activity_measurement_day(${targetDay}::date, 1, true)
    `;"""
repl(needle, replacement, 'zero-day reconciliation')
p.write_text(s)
PY

rm -f \
  .github/workflows/o1f-i2-builder.yml \
  .github/workflows/o1f-i2-runner.yml \
  .github/workflows/o1f-i2-smoke.yml \
  scripts/o1f-i2-bootstrap.sh \
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
  i=$((i + 1))
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
