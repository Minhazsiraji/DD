from pathlib import Path
import re

sql_path = Path('supabase/policies/0047_o1_owner_analytics_authority.sql')
sql = sql_path.read_text()
old_sql = "target_minute_stamp < v_now - interval '40 minutes'"
new_sql = "target_minute_stamp < v_now - interval '60 minutes'"
if sql.count(old_sql) != 1:
    raise SystemExit(f'writer freshness anchor mismatch: {sql.count(old_sql)}')
sql_path.write_text(sql.replace(old_sql, new_sql, 1))

v_path = Path('scripts/verify-o1f-i2-contract.mjs')
js = v_path.read_text()
old_boundary = "before_stamp >= clock_timestamp() - interval '40 minutes'"
new_boundary = "before_stamp >= clock_timestamp() - interval '60 minutes'"
if js.count(old_boundary) != 1:
    raise SystemExit(f'midnight freshness anchor mismatch: {js.count(old_boundary)}')
js = js.replace(old_boundary, new_boundary, 1)

pattern = re.compile(
    r"(await service\(tx, \(sp\) => sp`\n\s+select public\.ingest_activity_contribution\(.*?\n\s+\)\n\s+)`;",
    re.S,
)
js, count = pattern.subn(r"\1`);", js)
if count != 6:
    raise SystemExit(f'fixture service-call close count mismatch: {count}')

old_finalize = '''    await service(tx, (sp) => sp`\n      select public.finalize_activity_measurement_day(${boundary.race_day}::date, 3, true)\n    `;'''
new_finalize = '''    await service(tx, (sp) => sp`\n      select public.finalize_activity_measurement_day(${boundary.race_day}::date, 3, true)\n    `);'''
if js.count(old_finalize) != 1:
    raise SystemExit(f'late finalizer close anchor mismatch: {js.count(old_finalize)}')
js = js.replace(old_finalize, new_finalize, 1)

old_late = '''    const [late] = await service(tx, (sp) => sp`\n      select public.record_engagement_minute(\n        ${raceDoctors[0].doctorId}, ${boundary.race_day}::date,\n        ${boundary.before_stamp}::timestamptz, 'PATIENTS', ${boundary.name}\n      ) as inserted\n    `;'''
new_late = '''    const [late] = await service(tx, (sp) => sp`\n      select public.record_engagement_minute(\n        ${raceDoctors[0].doctorId}, ${boundary.race_day}::date,\n        ${boundary.before_stamp}::timestamptz, 'PATIENTS', ${boundary.name}\n      ) as inserted\n    `);'''
if js.count(old_late) != 1:
    raise SystemExit(f'late writer close anchor mismatch: {js.count(old_late)}')
js = js.replace(old_late, new_late, 1)

v_path.write_text(js)
