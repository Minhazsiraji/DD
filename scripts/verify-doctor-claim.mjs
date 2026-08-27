/**
 * DOCTOR PROFILE CLAIM + PLATFORM OWNER APPROVAL, proven against real Postgres.
 *
 * Three things matter more than the happy path:
 *
 *   1. Only a platform owner decides — and a stood-down one no longer does.
 *   2. Approval VERIFIES an identity. It does not publish a doctor. A PRIVATE
 *      profile is still PRIVATE afterwards, because publication is the
 *      doctor's decision and approval is somebody else's.
 *   3. Reviewing a claim grants no clinical access. A reviewer who could read
 *      patients would be a clinical superuser wearing a different hat.
 *
 * HERMETIC. One transaction: apply migration 0020, then policy 0034 — the real
 * deployment order — prove everything, roll it all back. Nothing installed, no
 * row survives, no storage written, db:policies never run.
 */
import postgres from "postgres";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const OWNER_MIGRATION = "drizzle/migrations/0019_open_whizzer.sql";
const OWNER_POLICY = "supabase/policies/0033_platform_owner_authority.sql";
const MIGRATION = "drizzle/migrations/0020_freezing_mister_sinister.sql";
const POLICY = "supabase/policies/0034_doctor_profile_claim.sql";

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const uid = () => crypto.randomUUID();

async function as(tx, user, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: "authenticated" })}, true)`;
  await tx`select set_config('role', 'authenticated', true)`;
  try {
    return await fn();
  } finally {
    await tx`select set_config('role', null, true)`;
    await tx`select set_config('request.jwt.claims', null, true)`;
  }
}

/** Did the database refuse this, for the stated reason? */
async function refused(tx, label, expected, fn) {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
      throw new Error("__ALLOWED__");
    });
    check(false, label, "ALLOWED");
  } catch (e) {
    if (/__ALLOWED__/.test(e.message)) return check(false, label, "ALLOWED");
    const first = e.message.split("\n")[0];
    check(first.includes(expected), label, first.slice(0, 60));
  }
}

async function applyIfMissing(tx, table, file) {
  const [{ exists }] = await tx`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = ${table}
    ) as exists`;
  if (exists) return false;
  const text = await readFile(path.resolve(file), "utf8");
  for (const stmt of text.split("--> statement-breakpoint")) {
    if (stmt.trim()) await tx.unsafe(stmt);
  }
  return true;
}

await sql
  .begin(async (tx) => {
    console.log("\n1. Migration, then policy — the deployment order");
    await applyIfMissing(tx, "platform_owners", OWNER_MIGRATION);
    await tx.unsafe(await readFile(path.resolve(OWNER_POLICY), "utf8"));
    await applyIfMissing(tx, "doctor_profile_claims", MIGRATION);
    await tx.unsafe(await readFile(path.resolve(POLICY), "utf8"));
    check(true, "0019/0033 and 0020/0034 applied in order");

    // -----------------------------------------------------------------
    console.log("\n2. Cast");

    const owner = uid();
    const stoodDown = uid();
    const drA = uid();
    const drB = uid();
    const staff = uid();

    for (const [id, name] of [
      [owner, "The Owner"],
      [stoodDown, "Former Owner"],
      [drA, "Dr A"],
      [drB, "Dr B"],
      [staff, "Reception"],
    ]) {
      await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                       confirmation_token, recovery_token,
                                       email_change_token_new, email_change)
               values (${id}, ${`clm.${id.slice(0, 8)}@qa.invalid`}, '', now(), '', '', '', '')`;
      await tx`insert into public.profiles (id, full_name) values (${id}, ${name})`;
    }

    const [profA] = await tx`insert into public.doctor_profiles
        (user_id, patient_number_prefix, qualification, profile_visibility)
      values (${drA}, 'CA', 'MBBS', 'PRIVATE') returning id`;
    const [profB] = await tx`insert into public.doctor_profiles
        (user_id, patient_number_prefix, profile_visibility)
      values (${drB}, 'CB', 'PRIVATE') returning id`;

    const [loc] = await tx`insert into public.practice_locations (name, type, district, created_by)
                           values ('Claim Chamber','CLINIC','Dhaka',${drA}) returning id`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${loc.id}, ${staff}, 'LOCATION_ADMIN', 'ACTIVE')`;

    const [patient] = await tx`insert into public.patients
        (owner_doctor_id, patient_number, full_name, name_normalized, sex, created_by)
      values (${profA.id}, 'CA-000001', 'Someone Private', 'someone private', 'MALE', ${drA})
      returning id`;

    await tx`insert into public.platform_owners (user_id, note) values (${owner}, 'fixture')`;
    await tx`insert into public.platform_owners (user_id, is_active, revoked_at, note)
             values (${stoodDown}, false, now(), 'stood down')`;
    check(true, "owner, stood-down owner, two doctors, staff, one patient");

    // -----------------------------------------------------------------
    console.log("\n3. Who may file a claim? (1, 12, 13)");

    await refused(tx, "anonymous cannot submit", "permission denied", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select public.submit_doctor_profile_claim('BD','BMDC','A-1','Dr A')`;
    });
    await refused(tx, "anonymous cannot list claims", "permission denied", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select public.my_doctor_profile_claims()`;
    });
    await refused(tx, "anonymous cannot read the table", "permission denied", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select * from public.doctor_profile_claims`;
    });
    await refused(tx, "a doctor cannot write the table directly", "permission denied", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: drA, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`insert into public.doctor_profile_claims
                 (doctor_profile_id, claimant_user_id, country_code, regulator_name,
                  registration_number, claimed_full_name)
               values (${profA.id}, ${drA}, 'BD', 'BMDC', 'A-1', 'Dr A')`;
    });

    const [{ args: submitArgs }] = await tx`
      select oidvectortypes(p.proargtypes) as args from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='submit_doctor_profile_claim'`;
    check(
      !submitArgs.includes("uuid"),
      "submit takes no uuid — claimant and target are never supplied",
      `(${submitArgs})`,
    );

    const claimA = await as(tx, drA, async () => {
      const [r] = await tx`select public.submit_doctor_profile_claim(
        'BD','BMDC','A-12345','Dr A','Registration card attached') as id`;
      return r.id;
    });
    check(!!claimA, "Dr A filed a claim");

    await refused(tx, "…and cannot file a second while it is open", "CLAIM_ALREADY_OPEN", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: drA, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.submit_doctor_profile_claim('BD','BMDC','A-12345','Dr A')`;
    });

    // -----------------------------------------------------------------
    console.log("\n4. Who may read it? (6, 7)");

    const aSees = await as(tx, drA, async () => {
      const [r] = await tx`select public.my_doctor_profile_claims() as v`;
      return r.v.length;
    });
    check(aSees === 1, "Dr A sees their own claim", `${aSees}`);

    const bSees = await as(tx, drB, async () => {
      const [r] = await tx`select public.my_doctor_profile_claims() as v`;
      return r.v.length;
    });
    check(bSees === 0, "Dr B cannot see Dr A's claim", `${bSees}`);

    await refused(tx, "Dr B cannot act on Dr A's claim by id", "CLAIM_NOT_FOUND", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: drB, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.respond_to_doctor_profile_claim(${claimA}, 'CANCEL')`;
    });

    // -----------------------------------------------------------------
    console.log("\n5. Who may decide? (2, 3, 4, 5)");

    await refused(tx, "a doctor cannot decide", "NOT_PLATFORM_OWNER", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: drA, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_decide_doctor_profile_claim(${claimA}, 'APPROVE')`;
    });
    await refused(tx, "a LOCATION_ADMIN cannot decide", "NOT_PLATFORM_OWNER", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: staff, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_decide_doctor_profile_claim(${claimA}, 'APPROVE')`;
    });
    await refused(tx, "a stood-down owner cannot decide", "NOT_PLATFORM_OWNER", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: stoodDown, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_decide_doctor_profile_claim(${claimA}, 'APPROVE')`;
    });
    await refused(tx, "a doctor cannot list the review queue", "NOT_PLATFORM_OWNER", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: drA, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_pending_claims()`;
    });

    const queue = await as(tx, owner, async () => {
      const [r] = await tx`select public.owner_pending_claims() as v`;
      return r.v;
    });
    check(queue.length === 1, "the active owner sees the pending claim", `${queue.length}`);

    // -----------------------------------------------------------------
    console.log("\n6. Review shows professional evidence only (8)");

    const keys = Object.keys(queue[0]).sort();
    check(
      !keys.some((k) => /patient|encounter|prescription|queue|token|diagnos/i.test(k)),
      "no clinical field in the review payload",
      keys.join(","),
    );
    const serialized = JSON.stringify(queue[0]).toLowerCase();
    check(!serialized.includes("someone private"), "the doctor's patient does not appear");

    for (const table of ["patients", "encounters", "prescriptions", "appointments", "queue_entries"]) {
      let outcome;
      try {
        outcome = await tx.savepoint(async (sp) => {
          await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`;
          await sp`select set_config('role', 'authenticated', true)`;
          const rows = await sp.unsafe(`select * from public.${table} limit 1`);
          return `${rows.length} row(s)`;
        });
      } catch (e) {
        outcome = e.message.includes("permission denied") ? "permission denied" : e.message.slice(0, 40);
      }
      check(outcome === "permission denied" || outcome === "0 row(s)", `owner cannot read ${table}`, outcome);
    }

    const ownerSeesPatient = await as(tx, owner, async () => {
      const rows = await tx`select id from public.patients where id = ${patient.id}`;
      return rows.length;
    });
    check(ownerSeesPatient === 0, "owner cannot fetch the patient by id");

    // -----------------------------------------------------------------
    console.log("\n7. Needs-information round trip");

    await as(tx, owner, () =>
      tx`select public.owner_decide_doctor_profile_claim(${claimA}, 'NEEDS_INFORMATION', 'Send a clearer scan')`);
    const [needs] = await tx`select status, decided_at, decided_by from public.doctor_profile_claims where id = ${claimA}`;
    check(needs.status === "NEEDS_INFORMATION", "claim moved to NEEDS_INFORMATION");
    check(needs.decided_at === null, "…and is NOT stamped as decided — it is still open");

    await as(tx, drA, () =>
      tx`select public.respond_to_doctor_profile_claim(${claimA}, 'RESUBMIT', 'Clearer scan attached')`);
    const [back] = await tx`select status from public.doctor_profile_claims where id = ${claimA}`;
    check(back.status === "PENDING", "the claimant resubmitted");

    await refused(tx, "a claimant cannot approve themselves", "INVALID_ACTION", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: drA, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.respond_to_doctor_profile_claim(${claimA}, 'APPROVE')`;
    });

    // -----------------------------------------------------------------
    console.log("\n8. Approval: verified, NOT published (9, 10, 14)");

    const [beforeVis] = await tx`select profile_visibility from public.doctor_profiles where id = ${profA.id}`;
    const first = await as(tx, owner, async () => {
      const [r] = await tx`select public.owner_decide_doctor_profile_claim(${claimA}, 'APPROVE', 'Register checked') as v`;
      return r.v;
    });
    check(first.changed === true && first.status === "APPROVED", "owner approved the claim");

    const [afterVis] = await tx`select profile_visibility from public.doctor_profiles where id = ${profA.id}`;
    check(
      beforeVis.profile_visibility === "PRIVATE" && afterVis.profile_visibility === "PRIVATE",
      "THE INVARIANT: a PRIVATE profile is still PRIVATE after approval",
      `${beforeVis.profile_visibility} → ${afterVis.profile_visibility}`,
    );

    const [decided] = await tx`select status, decided_at, decided_by, decision_note
                               from public.doctor_profile_claims where id = ${claimA}`;
    check(decided.decided_by === owner, "decided_by records the owner");
    check(decided.decided_at !== null, "decided_at is stamped");
    check(decided.decision_note === "Register checked", "the reason is preserved");

    const evBefore = await tx`select from_status, to_status, actor_id from public.doctor_profile_claim_events
                              where claim_id = ${claimA} order by seq`;
    check(evBefore.length === 4, "four events: submit, needs-info, resubmit, approve", `${evBefore.length}`);
    check(
      evBefore.at(-1).from_status === "PENDING" && evBefore.at(-1).to_status === "APPROVED",
      "the last event carries old → new status",
    );

    const repeat = await as(tx, owner, async () => {
      const [r] = await tx`select public.owner_decide_doctor_profile_claim(${claimA}, 'APPROVE', 'again') as v`;
      return r.v;
    });
    check(repeat.changed === false, "IDEMPOTENT: repeating the approval changes nothing");
    const evAfter = await tx`select seq from public.doctor_profile_claim_events where claim_id = ${claimA}`;
    check(evAfter.length === evBefore.length, "…and writes no duplicate event", `${evAfter.length}`);

    await refused(tx, "a settled decision cannot be flipped", "CLAIM_ALREADY_DECIDED", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_decide_doctor_profile_claim(${claimA}, 'REJECT', 'changed my mind')`;
    });

    // -----------------------------------------------------------------
    console.log("\n9. Conflicting ownership is refused (11)");

    const claimB = await as(tx, drB, async () => {
      const [r] = await tx`select public.submit_doctor_profile_claim('BD','BMDC','B-999','Dr B') as id`;
      return r.id;
    });
    // Hand Dr B's profile to somebody else behind the claim's back.
    await tx`update public.doctor_profiles set user_id = ${staff} where id = ${profB.id}`;
    await refused(tx, "approval refuses when the claimant no longer owns the account", "OWNERSHIP_CONFLICT", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_decide_doctor_profile_claim(${claimB}, 'APPROVE')`;
    });

    const [{ n: approvedForA }] = await tx`
      select count(*)::int as n from public.doctor_profile_claims
      where doctor_profile_id = ${profA.id} and status = 'APPROVED'`;
    check(approvedForA === 1, "exactly one approved claim per profile", `${approvedForA}`);

    console.log("\n10. Rolling back");
    throw new Error("__ROLLBACK_ALL__");
  })
  .catch((e) => {
    if (!/__ROLLBACK_ALL__/.test(e.message)) {
      failures += 1;
      console.error("\n  ✗ ABORTED");
      console.error(`    ${e.message.split("\n")[0]}`);
    }
  });

const [{ n: strays }] = await sql`
  select count(*)::int as n from auth.users where email like 'clm.%@qa.invalid'`;
check(strays === 0, "no fixture identity survived", `${strays}`);

console.log(
  failures === 0
    ? "\nDoctor claim + owner approval: all checks passed. Every row rolled back.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
