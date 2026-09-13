from pathlib import Path

p = Path('scripts/verify-o1f-i1-contract.mjs')
s = p.read_text()

def one(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'missing {label}')
    s = s.replace(old, new, 1)

one(
    "has_function_privilege('service_role', 'public.record_engagement_minute(uuid,date,text)', 'EXECUTE') as svc_record,",
    "has_function_privilege('service_role', 'public.record_engagement_minute(uuid,date,timestamptz,text,text)', 'EXECUTE') as svc_record,\n        to_regprocedure('public.record_engagement_minute(uuid,date,text)') is null as old_record_absent,",
    'service writer ACL',
)
one(
    'a.svc_record && a.svc_snapshot && a.svc_ingest_e && a.svc_read_e && a.svc_close_a && a.svc_close_e,',
    'a.svc_record && a.old_record_absent && !a.svc_snapshot && a.svc_ingest_e && a.svc_read_e && a.svc_close_a && a.svc_close_e,',
    'service expectation',
)
one(
    "has_function_privilege('authenticated', 'public.record_engagement_minute(uuid,date,text)', 'EXECUTE') as record,",
    "has_function_privilege('authenticated', 'public.record_engagement_minute(uuid,date,timestamptz,text,text)', 'EXECUTE') as record,",
    'browser writer ACL',
)

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
      `;
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
    `;
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

status_pos = s.index('"failed Activity closeout leaves Not measured"')
insert_at = s.index('\n\n    await service(tx, (sp) => sp`', status_pos)
ack = r'''

    for (const doctor of doctors) {
      await service(tx, (sp) => sp`
        select public.acknowledge_activity_reconciliation(
          ${doctor.doctorId}, ${targetDay}::date, 0
        )
      `;
    }
    const [wm] = await service(tx, (sp) => sp`
      select * from public.get_activity_reconciliation_day_watermark(${targetDay}::date)
    `;
    await service(tx, (sp) => sp`
      select public.acknowledge_activity_reconciliation_day(
        ${targetDay}::date, ${wm.evidence_generation}, ${wm.eligible_doctor_count}
      )
    `;'''
s = s[:insert_at] + ack + s[insert_at:]
p.write_text(s)
