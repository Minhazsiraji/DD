import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const localUrl = process.env.DD_CORRECTION_WINDOW_LOCAL_URL;
if (!localUrl) throw new Error("DD_CORRECTION_WINDOW_LOCAL_URL is required");

const parsed = new URL(localUrl);
const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (!loopback.has(parsed.hostname)) {
  throw new Error(`Refusing non-local proof host: ${parsed.hostname}`);
}

const [runtime, v2] = await Promise.all([
  readFile("supabase/policies/0041_prescription_correction_window.sql", "utf8"),
  readFile("db/p1/0014_p1_prescription_correction_window.sql", "utf8"),
]);

assert.match(
  runtime,
  /if\s+v_authorized_at\s*>\s*v_rx\.finalized_at\s*\+\s*interval\s*'48 hours'\s+then/i,
);
assert.match(
  v2,
  /if\s+authorized_at\s*>\s*original\.finalized_at\s*\+\s*interval\s*'48 hours'\s+then/i,
);
assert.doesNotMatch(runtime, /v_authorized_at\s*>=\s*v_rx\.finalized_at/i);
assert.doesNotMatch(v2, /authorized_at\s*>=\s*original\.finalized_at/i);

const sql = postgres(localUrl, { max: 1 });
try {
  const [row] = await sql`
    with boundary as (
      select timestamptz '2026-09-06 00:00:00+00' as finalized_at
    )
    select
      (finalized_at + interval '47 hours 59 minutes 59 seconds'
        > finalized_at + interval '48 hours') as before_expired,
      (finalized_at + interval '48 hours'
        > finalized_at + interval '48 hours') as exact_expired,
      (finalized_at + interval '48 hours 0.000001 seconds'
        > finalized_at + interval '48 hours') as first_after_expired
    from boundary
  `;

  assert.equal(row.before_expired, false, "+47:59:59 must be eligible");
  assert.equal(row.exact_expired, false, "exactly +48:00:00 must be eligible");
  assert.equal(row.first_after_expired, true, "first PostgreSQL microsecond after 48h must expire");

  console.log("PASS PostgreSQL exact 48-hour boundary semantics (+47:59:59, +48:00:00, +1us)");
} finally {
  await sql.end({ timeout: 2 });
}
