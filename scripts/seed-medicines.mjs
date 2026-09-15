import postgres from "postgres";
import { readFileSync } from "node:fs";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const data = JSON.parse(readFileSync(new URL("../data/medicines/starter-generics.json", import.meta.url), "utf8"));
if (typeof data.source !== "string" || data.source.trim() === "") {
  console.error('a top-level "source" string is required');
  process.exit(1);
}
if (!Array.isArray(data.entries)) {
  console.error("entries must be an array");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  for (const entry of data.entries) {
    await sql`
      insert into public.medicine_references (
        generic_name, brand_name, strength_text, dosage_form, manufacturer,
        country_code, regulator_name, source_kind, source_note, last_verified_at
      ) values (
        ${entry.genericName}, ${entry.brandName ?? null}, ${entry.strengthText ?? null},
        ${entry.dosageForm ?? null}, ${entry.manufacturer ?? null}, ${entry.countryCode},
        ${entry.regulatorName ?? null}, 'MANUAL_SEED', ${data.source},
        ${entry.lastVerifiedAt ?? null}
      )
      on conflict (country_code, generic_normalized, brand_normalized, strength_text, dosage_form)
      do update set
        regulator_name = excluded.regulator_name,
        source_note = excluded.source_note,
        last_verified_at = excluded.last_verified_at,
        updated_at = now()
    `;
  }
  console.log(`Seeded/reconciled ${data.entries.length} Medicine starter rows.`);
} finally {
  await sql.end({ timeout: 5 });
}
