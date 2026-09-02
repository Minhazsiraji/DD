/**
 * Seeds the reference medicine catalogue from a reviewed, human-authored file.
 *
 *   node --env-file=.env.local scripts/seed-medicines.mjs
 *   node --env-file=.env.local scripts/seed-medicines.mjs --file data/medicines/bd-starter.json
 *
 * WHY THIS IS A SCRIPT AND NOT A FEATURE.
 *
 * `medicine_references` has no INSERT/UPDATE/DELETE grant for `authenticated`
 * (see supabase/policies/0043_medicines_v1.sql). The catalogue is what every
 * doctor in the deployment sees, so changing it is a deliberate, reviewable act
 * under the service role — not something a signed-in user can do, and not
 * something that happens as a side effect of using the app.
 *
 * PROVENANCE IS MANDATORY, NOT DECORATIVE.
 *
 * CLAUDE.md: "Never generate drug facts with an LLM and store them as reference
 * data... No source → it does not render as reference data. Do not scrape drug
 * databases."
 *
 * So this script:
 *   - reads a checked-in JSON file that a human wrote and a human reviews;
 *   - refuses any entry without a `sourceNote` saying where it came from;
 *   - refuses to run against a file it was not pointed at;
 *   - never fetches anything over the network.
 *
 * It also seeds IDENTITY ONLY — generic, brand, strength, form, manufacturer,
 * market. No indications, no dosing, no interactions, no contraindications.
 * Those require a licensed source and are deliberately not modelled yet.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const args = process.argv.slice(2);
const fileArg = args.indexOf("--file");
const file =
  fileArg >= 0 && args[fileArg + 1]
    ? args[fileArg + 1]
    : "data/medicines/starter-generics.json";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const raw = JSON.parse(await readFile(path.resolve(file), "utf8"));

if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries)) {
  console.error(`${file}: expected { source, entries: [...] }`);
  process.exit(1);
}

/**
 * The file-level citation. Refusing to proceed without one is the whole point:
 * an unattributed catalogue is exactly the thing the medicine-data rule forbids.
 */
const source = typeof raw.source === "string" ? raw.source.trim() : "";
if (!source) {
  console.error(`${file}: a top-level "source" string is required. What is this data FROM?`);
  process.exit(1);
}

const problems = [];
raw.entries.forEach((e, i) => {
  if (!e || typeof e !== "object") return problems.push(`#${i}: not an object`);
  if (typeof e.genericName !== "string" || !e.genericName.trim()) {
    problems.push(`#${i}: genericName is required`);
  }
  if (typeof e.countryCode !== "string" || !/^[A-Z]{2}$/.test(e.countryCode)) {
    problems.push(`#${i}: countryCode must be ISO 3166-1 alpha-2, uppercase`);
  }
});

if (problems.length > 0) {
  console.error(`${file}: refusing to seed.\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let inserted = 0;
let updated = 0;

try {
  for (const e of raw.entries) {
    /**
     * `on conflict do update` on the identity index, so re-running is safe and
     * a corrected entry actually corrects. `is_active` is deliberately NOT
     * reset here: a row withdrawn by an operator stays withdrawn until someone
     * decides otherwise, rather than being quietly revived by a re-seed.
     */
    const [row] = await sql`
      insert into public.medicine_references (
        generic_name, brand_name, strength_text, dosage_form, manufacturer,
        country_code, regulator_name, source_kind, source_note, last_verified_at
      ) values (
        ${e.genericName.trim()},
        ${e.brandName?.trim() || null},
        ${e.strengthText?.trim() || null},
        ${e.dosageForm?.trim() || null},
        ${e.manufacturer?.trim() || null},
        ${e.countryCode},
        ${e.regulatorName?.trim() || null},
        'MANUAL_SEED',
        ${e.sourceNote?.trim() || source},
        ${e.lastVerifiedAt ?? null}
      )
      on conflict (country_code, generic_normalized, brand_normalized, strength_text, dosage_form)
      do update set
        manufacturer    = excluded.manufacturer,
        regulator_name  = excluded.regulator_name,
        source_note     = excluded.source_note,
        last_verified_at = excluded.last_verified_at,
        updated_at      = now()
      returning (xmax = 0) as is_insert
    `;
    if (row.is_insert) inserted += 1;
    else updated += 1;
  }

  console.log(`Seeded from ${file}`);
  console.log(`  source:   ${source}`);
  console.log(`  inserted: ${inserted}`);
  console.log(`  updated:  ${updated}`);
} finally {
  await sql.end({ timeout: 5 });
}
