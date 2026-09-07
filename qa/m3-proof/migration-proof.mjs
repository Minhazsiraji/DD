import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { sql, PRODUCT_DIR, closeSql } from "./lib.mjs";

try {
  const [version] = await sql`show server_version`;
  console.log(`M3_EPHEMERAL_POSTGRES_VERSION=${version.server_version}`);

  const files = [
    "0042_m3_prescription_reuse.sql",
    "0043_m3_signed_medicine_history.sql",
    "0044_m3_prescription_print_audit.sql",
  ];

  for (const file of files) {
    const body = await readFile(path.join(PRODUCT_DIR, "supabase", "policies", file), "utf8");
    await sql.unsafe(body);
    console.log(`PASS clean replay ${file}`);
  }

  const [shape] = await sql`select
    to_regclass('public.prescription_reuse_operations') is not null as reuse_table,
    to_regclass('public.prescription_print_operations') is not null as print_table,
    to_regprocedure('public.reuse_finalized_prescription_items(uuid,uuid,uuid,integer,text,uuid[],boolean,text)') is not null as reuse_rpc,
    to_regprocedure('public.prescription_signed_medicine_history(text,text,integer)') is not null as history_rpc,
    to_regprocedure('public.initiate_prescription_print(uuid,uuid,text)') is not null as print_init_rpc,
    to_regprocedure('public.confirm_prescription_print(uuid,integer)') is not null as print_confirm_rpc,
    to_regprocedure('public.prescription_print_history(uuid,uuid)') is not null as print_history_rpc`;
  for (const [name, present] of Object.entries(shape)) {
    assert.equal(present, true, `${name} missing after M3 apply/replay`);
  }

  const [frozen] = await sql`select pg_get_functiondef('public.start_prescription_correction(uuid,uuid,text)'::regprocedure) as body`;
  assert.match(frozen.body, /CORRECTION_WINDOW_EXPIRED/);
  assert.match(frozen.body, /interval '48 hours'/);
  assert.match(frozen.body, /clock_timestamp\(\)/);

  console.log("M3_MIGRATION_REPLAY_PASS files=3 prerequisites=runtime-through-0041");
} finally {
  await closeSql();
}
