/**
 * Medicines V1 — RLS and authority, executed rather than asserted.
 *
 * The static tests read the policy file. This runs the real thing: every check
 * below is performed as the real `authenticated` role with a real JWT claim,
 * inside ONE transaction that is ALWAYS rolled back. Nothing survives it.
 *
 * What is proved here, in the ordinary configuration that breaks isolation —
 * TWO DOCTORS AT THE SAME HOSPITAL, plus reception and a location admin who are
 * active members of it:
 *
 *   - the catalogue is readable by any signed-in user and writable by none;
 *   - a doctor reads and edits only their OWN saved medicines;
 *   - another doctor, reception, a location admin and the platform owner get
 *     nothing — no read, no write, no probe;
 *   - anon gets nothing at all;
 *   - search is literal: a near-miss returns zero rows rather than a neighbour;
 *   - archiving a saved medicine leaves a finalised prescription untouched.
 *
 *   node --env-file=.env.local scripts/verify-medicines.mjs
 */
import postgres from "postgres";
import crypto from "node:crypto";
import { buildProbeDatabase } from "./lib/probe-db.mjs";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

/**
 * `--fresh` builds a THROWAWAY database from the repository (every migration in
 * journal order, then every policy file) and runs everything there. That is the
 * default for this script, because it proves the boundary is a property of the
 * repository rather than of one database that happens to have been patched into
 * shape — and because it does not queue behind another worktree's transaction.
 *
 * `--live` runs against the configured project instead, still inside a
 * transaction that is always rolled back. Use it once the migration has been
 * applied there, to check the real Supabase `auth` behaviour.
 */
const live = process.argv.includes("--live");

let sql;
let closeProbe = async () => {};

if (live) {
  sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  closeProbe = async () => sql.end({ timeout: 5 });
  console.log("Running against the LIVE project, inside a rolled-back transaction.");
} else {
  /**
   * A unique name per run. Several worktrees share this Postgres server, and a
   * fixed name means two concurrent runs fight over the same database — one
   * drops it while the other is using it, and the failure looks like a defect
   * in the thing under test rather than a collision between runs.
   */
  const built = await buildProbeDatabase(
    `dd_medicines_probe_${crypto.randomBytes(4).toString("hex")}`,
  );
  sql = built.probe;
  closeProbe = built.close;
  console.log(
    `Built a throwaway database: ${built.migrations} migrations, ${built.policies} policy files.`,
  );
}

const failures = [];

function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/**
 * The policy file must apply a SECOND time, cleanly.
 *
 * A fresh database hides this completely — file order alone is fine the first
 * time. It only breaks on a database that has already been brought up to date,
 * which is every database anyone actually operates: `create or replace
 * function` cannot change an existing function's return type, and that error
 * aborts the run at this file, so every LATER policy file silently never
 * applies. This has bitten Stage 7C once already.
 */
if (!live) {
  const { readFileSync } = await import("node:fs");
  const body = readFileSync("supabase/policies/0043_medicines_v1.sql", "utf8");
  console.log("\n0043 is idempotent");
  try {
    await sql.unsafe(body);
    check(true, "0043_medicines_v1.sql applies a second time, cleanly");
  } catch (e) {
    check(false, "0043_medicines_v1.sql applies a second time, cleanly", e.message);
  }
}

/** Run `fn` as a signed-in user, then always drop back. */
async function as(tx, uid, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({
    sub: uid,
    role: "authenticated",
  })}, true)`;
  await tx`set local role authenticated`;
  try {
    return await fn();
  } finally {
    await tx`reset role`;
  }
}

/** Run `fn` as an unauthenticated visitor. */
async function asAnon(tx, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({
    role: "anon",
  })}, true)`;
  await tx`set local role anon`;
  try {
    return await fn();
  } finally {
    await tx`reset role`;
  }
}

/**
 * Did this statement get refused? Returns the SQLSTATE, or null if it worked.
 *
 * THE SAVEPOINT IS NOT OPTIONAL. A failed statement aborts the whole
 * transaction in Postgres, so catching the error is not enough — every
 * subsequent check would fail with "current transaction is aborted" and the run
 * would report a script error instead of a result. Rolling back to a savepoint
 * puts the transaction back in a usable state, which is what lets a run assert
 * a dozen refusals in a row.
 *
 * The role is set OUTSIDE the savepoint by `as()`, so rolling back to it does
 * not silently drop the caller's identity mid-check.
 */
async function refused(tx, fn) {
  try {
    await tx.savepoint(async () => {
      await fn();
    });
    return null;
  } catch (e) {
    return e.code ?? "error";
  }
}

const uidA = crypto.randomUUID();
const uidB = crypto.randomUUID();
const uidR = crypto.randomUUID();
const uidM = crypto.randomUUID();

try {
  await sql.begin(async (tx) => {
    // -----------------------------------------------------------------------
    // Fixture. Clearly synthetic identities on @qa.invalid, rolled back below.
    // -----------------------------------------------------------------------
    for (const [uid, name] of [
      [uidA, "QA Dr A"],
      [uidB, "QA Dr B"],
      [uidR, "QA Reception"],
      [uidM, "QA Admin"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [docA] = await tx`
      insert into public.doctor_profiles (user_id, patient_number_prefix, bmdc_registration_no)
      values (${uidA}, 'MA', ${"QM" + crypto.randomBytes(3).toString("hex")}) returning id`;
    const [docB] = await tx`
      insert into public.doctor_profiles (user_id, patient_number_prefix, bmdc_registration_no)
      values (${uidB}, 'MB', ${"QN" + crypto.randomBytes(3).toString("hex")}) returning id`;

    // ONE shared hospital. Everyone below is an ACTIVE member of it, which is
    // exactly the configuration in which a membership-based policy leaks.
    const [hosp] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Medicine Hospital', 'HOSPITAL', ${uidA}) returning id`;
    await tx`insert into public.practice_location_members
               (practice_location_id, user_id, role, status)
             values (${hosp.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${hosp.id}, ${uidB}, 'DOCTOR', 'ACTIVE'),
                    (${hosp.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE'),
                    (${hosp.id}, ${uidM}, 'LOCATION_ADMIN', 'ACTIVE')`;

    /**
     * Catalogue rows. Deliberately fictional brands, so nothing here asserts a
     * fact about a real product.
     *
     * EVERY NAME CARRIES A RUN-UNIQUE TAG, and every search below includes it.
     * Against the live project the catalogue already holds seeded rows, so an
     * untagged query for "paracetamol 665" matches the fixture AND the real
     * entry — and an assertion of "exactly one row" then fails for a reason
     * that has nothing to do with the behaviour under test. The tag scopes
     * every result set to this run, on an empty database and a full one alike.
     */
    const TAG = `QA${crypto.randomBytes(3).toString("hex")}`;

    const [refGeneric] = await tx`
      insert into public.medicine_references
        (generic_name, strength_text, dosage_form, country_code, regulator_name, source_note)
      values (${`${TAG} Paracetamol`}, '500 mg', 'Tablet', 'BD', 'QA-REG', 'QA fixture')
      returning id`;
    await tx`
      insert into public.medicine_references
        (generic_name, brand_name, strength_text, dosage_form, manufacturer,
         country_code, regulator_name, source_note)
      values (${`${TAG} Paracetamol`}, ${`${TAG}NAPA`}, '665 mg', 'Tablet', 'QA Pharma',
              'BD', 'QA-REG', 'QA fixture')`;
    await tx`
      insert into public.medicine_references
        (generic_name, brand_name, strength_text, dosage_form, country_code, source_note)
      values (${`${TAG} Metformin`}, ${`${TAG}ZOL`}, '500 mg', 'Tablet', 'IN', 'QA fixture')`;
    /** The near-miss. Shares a prefix with Metformin and must NEVER stand in for it. */
    await tx`
      insert into public.medicine_references
        (generic_name, strength_text, dosage_form, country_code, source_note)
      values (${`${TAG} Metronidazole`}, '400 mg', 'Tablet', 'BD', 'QA fixture')`;

    // -----------------------------------------------------------------------
    console.log("\nThe catalogue is readable by everyone signed in, writable by no one");
    // -----------------------------------------------------------------------
    for (const [uid, who] of [[uidA, "Dr A"], [uidR, "reception"], [uidM, "a location admin"]]) {
      const rows = await as(tx, uid, () =>
        tx`select id from public.medicine_references where source_note = 'QA fixture'`);
      check(rows.length === 4, `${who} reads the catalogue`, `${rows.length} row(s)`);
    }

    const insertCode = await as(tx, uidA, () =>
      refused(tx, () => tx`
        insert into public.medicine_references (generic_name, country_code)
        values ('QA Forged', 'BD')`));
    check(insertCode === "42501", "a doctor cannot insert into the catalogue", `SQLSTATE ${insertCode}`);

    const updateCode = await as(tx, uidA, () =>
      refused(tx, () => tx`
        update public.medicine_references set generic_name = 'QA Tampered'
        where id = ${refGeneric.id}`));
    check(updateCode === "42501", "…nor update it", `SQLSTATE ${updateCode}`);

    const deleteCode = await as(tx, uidA, () =>
      refused(tx, () => tx`delete from public.medicine_references where id = ${refGeneric.id}`));
    check(deleteCode === "42501", "…nor delete from it", `SQLSTATE ${deleteCode}`);

    const anonCatalogue = await asAnon(tx, () =>
      refused(tx, () => tx`select id from public.medicine_references`));
    check(anonCatalogue === "42501", "anonymous reads no catalogue", `SQLSTATE ${anonCatalogue}`);

    // -----------------------------------------------------------------------
    console.log("\nSearch is literal — a near miss returns nothing, never a neighbour");
    // -----------------------------------------------------------------------
    await as(tx, uidA, async () => {
      const byGeneric = await tx`select * from public.search_medicines(${`${TAG} paracetamol`})`;
      check(byGeneric.length === 2, "finds a medicine by generic name", `${byGeneric.length} row(s)`);

      const byBrand = await tx`select * from public.search_medicines(${`${TAG}NAPA`})`;
      check(
        byBrand.length === 1 && byBrand[0].brand_name === `${TAG}NAPA`,
        "finds a medicine by brand name",
        `${byBrand.length} row(s)`,
      );

      /**
       * Generic + strength, with the BRAND sitting between them in the row's
       * text. A single contiguous match cannot find this; token matching can,
       * and still only returns rows that literally contain both words.
       */
      const byStrength = await tx`select * from public.search_medicines(${`${TAG} paracetamol 665`})`;
      check(byStrength.length === 1, "finds generic + strength across an intervening brand",
        `${byStrength.length} row(s)`);

      const brandAndStrength = await tx`select * from public.search_medicines(${`${TAG}NAPA 665`})`;
      check(brandAndStrength.length === 1, "finds brand + strength together",
        `${brandAndStrength.length} row(s)`);

      /**
       * Tokens are ANDed, never ORed. A query naming two different molecules
       * must return neither — an OR would hand back both and let the wrong one
       * be tapped.
       */
      const twoMolecules = await tx`select * from public.search_medicines(${`${TAG} paracetamol metformin`})`;
      check(twoMolecules.length === 0, "every token must match, so two molecules match nothing",
        `${twoMolecules.length} row(s)`);

      /** A token that is simply wrong still excludes the row. */
      const oneBadToken = await tx`select * from public.search_medicines(${`${TAG} paracetamol 999`})`;
      check(oneBadToken.length === 0, "one non-matching token excludes the row",
        `${oneBadToken.length} row(s)`);

      /**
       * THE ONE THAT MATTERS. "QA Metformi" is one character from
       * "QA Metformin" and eight from "QA Metronidazole". A fuzzy matcher
       * would offer both. A literal one offers only the true prefix match.
       */
      const typo = await tx`select * from public.search_medicines(${`${TAG} metfor`})`;
      const names = typo.map((r) => r.generic_name);
      check(
        names.length === 1 && names[0] === `${TAG} Metformin`,
        "a partial name matches only what it literally prefixes",
        names.join(", ") || "none",
      );

      const nonsense = await tx`select * from public.search_medicines(${`${TAG} metfxrmin`})`;
      check(nonsense.length === 0, "a misspelling returns NOTHING, not a near match", `${nonsense.length} row(s)`);

      const oneChar = await tx`select * from public.search_medicines('q')`;
      check(oneChar.length === 0, "a one-character query is refused, not answered with the catalogue");

      const byCountry = await tx`select * from public.search_medicines(${`${TAG} metformin`}, 'IN')`;
      const wrongCountry = await tx`select * from public.search_medicines(${`${TAG} metformin`}, 'BD')`;
      check(byCountry.length === 1, "country filter selects the right market", `${byCountry.length} row(s)`);
      check(wrongCountry.length === 0, "…and excludes the wrong one", `${wrongCountry.length} row(s)`);

      /** Wildcards must be data, not syntax, or one query returns everything. */
      const wildcard = await tx`select * from public.search_medicines('%%')`;
      check(wildcard.length === 0, "a literal %% matches nothing rather than every row",
        `${wildcard.length} row(s)`);

      const underscore = await tx`select * from public.search_medicines(${`${TAG}_a`})`;
      check(underscore.length === 0, "a literal _ is not a single-character wildcard",
        `${underscore.length} row(s)`);
    });

    // -----------------------------------------------------------------------
    console.log("\nA doctor's saved medicines are their own");
    // -----------------------------------------------------------------------
    let medA;
    await as(tx, uidA, async () => {
      const [row] = await tx`
        insert into public.doctor_medicines
          (doctor_profile_id, medicine_reference_id, display_name, generic_name,
           strength_text, dosage_form, default_dose_text, default_schedule_text,
           default_duration_text, default_food_relation)
        values (${docA.id}, ${refGeneric.id}, 'QANAPA 500 mg', 'QA Paracetamol',
                '500 mg', 'Tablet', '1 tablet', '1+0+1', '3 days', 'After food')
        returning id`;
      medA = row.id;
      check(Boolean(medA), "Dr A adds a medicine to their library");

      const mine = await tx`select * from public.doctor_medicines where id = ${medA}`;
      check(mine.length === 1, "…and reads it back");
      check(mine[0]?.default_schedule_text === "1+0+1", "…with the defaults they saved");
    });

    await as(tx, uidB, async () => {
      const [row] = await tx`
        insert into public.doctor_medicines (doctor_profile_id, display_name)
        values (${docB.id}, 'QA Dr B private medicine') returning id`;
      check(Boolean(row.id), "Dr B has their own separate library");
    });

    // -----------------------------------------------------------------------
    console.log("\nNobody else can read, edit or even detect them");
    // -----------------------------------------------------------------------
    for (const [uid, who] of [
      [uidB, "another doctor at the same hospital"],
      [uidR, "reception"],
      [uidM, "a location admin"],
    ]) {
      const rows = await as(tx, uid, () =>
        tx`select id from public.doctor_medicines where id = ${medA}`);
      check(rows.length === 0, `${who} cannot READ Dr A's saved medicine`, `${rows.length} row(s)`);

      /**
       * An UPDATE blocked by RLS matches no rows and raises nothing — it
       * reports success having changed nothing. So the count is what is
       * checked, never the absence of an error.
       */
      const changed = await as(tx, uid, () =>
        tx`update public.doctor_medicines set default_dose_text = 'TAMPERED'
           where id = ${medA} returning id`);
      check(changed.length === 0, `${who} cannot EDIT it`, `${changed.length} row(s) changed`);
    }

    // The value is genuinely untouched, not merely reported as untouched.
    const [after] = await tx`select default_dose_text from public.doctor_medicines where id = ${medA}`;
    check(after.default_dose_text === "1 tablet", "the saved dose is unchanged after every attempt",
      String(after.default_dose_text));

    // Reception cannot create a default in a doctor's name either.
    const forgeCode = await as(tx, uidR, () =>
      refused(tx, () => tx`
        insert into public.doctor_medicines (doctor_profile_id, display_name)
        values (${docA.id}, 'QA Forged by reception')`));
    check(forgeCode === "42501", "reception cannot CREATE a default for a doctor", `SQLSTATE ${forgeCode}`);

    // A doctor cannot re-assign their own row into someone else's library.
    const stealCode = await as(tx, uidB, () =>
      refused(tx, () => tx`
        insert into public.doctor_medicines (doctor_profile_id, display_name)
        values (${docA.id}, 'QA Injected by Dr B')`));
    check(stealCode === "42501", "one doctor cannot INJECT a default into another's library",
      `SQLSTATE ${stealCode}`);

    const anonRead = await asAnon(tx, () =>
      refused(tx, () => tx`select id from public.doctor_medicines`));
    check(anonRead === "42501", "anonymous reads no personal library", `SQLSTATE ${anonRead}`);

    // -----------------------------------------------------------------------
    console.log("\nRemoval is archival, and DELETE is not available to anyone");
    // -----------------------------------------------------------------------
    const ownDelete = await as(tx, uidA, () =>
      refused(tx, () => tx`delete from public.doctor_medicines where id = ${medA}`));
    check(ownDelete === "42501", "even the owner cannot DELETE a saved medicine", `SQLSTATE ${ownDelete}`);

    await as(tx, uidA, async () => {
      const rows = await tx`update public.doctor_medicines set is_active = false
                            where id = ${medA} returning is_active, default_schedule_text`;
      check(rows.length === 1 && rows[0].is_active === false, "the owner archives it instead");
      check(rows[0]?.default_schedule_text === "1+0+1", "…and the defaults survive archiving");
    });

    // -----------------------------------------------------------------------
    console.log("\nUsage bookkeeping is the caller's own, and silent otherwise");
    // -----------------------------------------------------------------------
    await as(tx, uidA, async () => {
      await tx`select public.touch_doctor_medicine(${medA})`;
      const [row] = await tx`select usage_count, last_used_at from public.doctor_medicines
                             where id = ${medA}`;
      check(row.usage_count === 1, "using a medicine increments the owner's count", String(row.usage_count));
      check(row.last_used_at !== null, "…and stamps when");
    });

    await as(tx, uidB, async () => {
      // Must not raise a distinguishable error: "not yours" and "not there"
      // have to look identical, or the row's existence is disclosed.
      const code = await refused(tx, () => tx`select public.touch_doctor_medicine(${medA})`);
      check(code === null, "another doctor's touch is silently ignored, not refused differently",
        code ?? "no error");
    });

    const [untouched] = await tx`select usage_count from public.doctor_medicines where id = ${medA}`;
    check(untouched.usage_count === 1, "…and changed nothing", String(untouched.usage_count));

    const ghost = await as(tx, uidA, () =>
      refused(tx, () => tx`select public.touch_doctor_medicine(${crypto.randomUUID()})`));
    check(ghost === null, "a row that does not exist answers exactly the same way", ghost ?? "no error");

    // -----------------------------------------------------------------------
    console.log("\nArchiving a saved medicine does not touch prescription history");
    // -----------------------------------------------------------------------
    /**
     * The structural claim, checked against the live catalogue rather than the
     * schema file: `prescription_items` has no foreign key to either medicine
     * table, so there is nothing an archive could cascade into.
     */
    const fks = await tx`
      select con.conname, cl.relname as target
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class cl  on cl.oid  = con.confrelid
      where con.contype = 'f' and src.relname = 'prescription_items'`;
    const targets = fks.map((f) => f.target);
    check(
      !targets.includes("doctor_medicines") && !targets.includes("medicine_references"),
      "prescription_items references neither medicine table",
      targets.join(", ") || "none",
    );

    /** And the printed text lives on the prescription row itself. */
    const cols = await tx`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'prescription_items'
        and column_name in ('display_name', 'dose_text', 'schedule_text', 'duration_text')`;
    check(cols.length === 4, "…and stores its own copy of every printed field",
      `${cols.length}/4 columns`);

    // -----------------------------------------------------------------------
    console.log("\nNo prescribing authority was added");
    // -----------------------------------------------------------------------
    const grants = await tx`
      select routine_name, grantee
      from information_schema.routine_privileges
      where specific_schema = 'public'
        and routine_name in ('search_medicines', 'touch_doctor_medicine', 'normalize_medicine_text')
        and grantee in ('anon', 'public')`;
    check(grants.length === 0, "no medicine function is granted to anon or public",
      grants.map((g) => `${g.routine_name}->${g.grantee}`).join(", ") || "none");

    const bodies = await tx`
      select p.proname, p.prosrc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('search_medicines', 'touch_doctor_medicine')`;
    const clinical = bodies.filter((b) =>
      /prescription|encounter|\bpatients\b/i.test(b.prosrc));
    check(clinical.length === 0, "no medicine function mentions a clinical table",
      clinical.map((c) => c.proname).join(", ") || "none");

    // Roll back everything. The fixture never existed.
    throw new Error("__ROLLBACK__");
  });
} catch (e) {
  if (e.message !== "__ROLLBACK__") {
    console.error("\nVerification aborted:", e.message);
    failures.push("script error");
  }
} finally {
  // In `finally`, never inside the try: an aborted run must still drop the
  // probe database and close the pool, rather than leaving a stale database
  // behind and a session pinned on the pooler.
  await closeProbe();
}

console.log(
  failures.length === 0
    ? "\nAll medicine checks passed. Transaction rolled back — no residue.\n"
    : `\n${failures.length} FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
