import crypto from "node:crypto";
import { assert, expectSqlFailure, openLocalAdminDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();
const signal = `QA_DETAIL_${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const keys = Array.from({ length: 13 }, (_, index) => `k${String(index + 1).padStart(2, "0")}`);
const objectFor = (count) => Object.fromEntries(keys.slice(0, count).map((key, index) => [key, index + 1]));

try {
  await sql.unsafe("begin");
  await sql`
    insert into public.health_signal_registry(signal_code, expected_interval)
    values (${signal}, interval '5 minutes')
  `;
  for (const key of keys) {
    await sql`
      insert into public.health_signal_registry_keys(
        signal_code, detail_key, value_type, min_value, max_value
      ) values (${signal}, ${key}, 'INTEGER', 0, 100)
    `;
  }

  const [helper] = await sql`
    select public.p1_jsonb_object_key_count(${sql.json(objectFor(12))}) as twelve,
           public.p1_jsonb_object_key_count('{}'::jsonb) as zero,
           public.p1_jsonb_object_key_count('[]'::jsonb) as non_object
  `;
  assert(helper.twelve === 12 && helper.zero === 0 && helper.non_object === null,
    `object-key helper contract mismatch: ${JSON.stringify(helper)}`);

  await sql`
    insert into public.system_health_signals(signal_code, status, detail)
    values (${signal}, 'OK', ${sql.json(objectFor(2))})
  `;
  await sql`
    insert into public.system_health_signals(signal_code, status, detail)
    values (${signal}, 'OK', ${sql.json(objectFor(12))})
  `;
  await expectSqlFailure(
    sql,
    "13-key health detail must be rejected",
    () => sql`
      insert into public.system_health_signals(signal_code, status, detail)
      values (${signal}, 'OK', ${sql.json(objectFor(13))})
    `,
    ["23514"],
  );
  await expectSqlFailure(
    sql,
    "non-object health detail must be rejected",
    () => sql`
      insert into public.system_health_signals(signal_code, status, detail)
      values (${signal}, 'OK', '[1,2]'::jsonb)
    `,
    ["23514"],
  );

  const [accepted] = await sql`
    select count(*)::int as n from public.system_health_signals where signal_code=${signal}
  `;
  assert(accepted.n === 2, `expected valid+boundary rows only, got ${accepted.n}`);
  console.log("verify-health-signal-detail-bound: PASS (valid accepted; 12-key boundary accepted; 13-key and non-object rejected)");
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
