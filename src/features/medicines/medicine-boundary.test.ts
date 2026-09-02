import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The boundaries this stage must not cross, asserted so that crossing one
 * breaks a test rather than a patient.
 *
 * Three separate things are guarded here:
 *
 *   1. The medicine feature confers no prescription authority.
 *   2. A doctor's saved defaults are private, by construction.
 *   3. This branch does not touch the modules other loops are editing.
 */

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

function code(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function sqlCode(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--[^\n]*$/gm, "");
}

const POLICY = "supabase/policies/0043_medicines_v1.sql";

/** Every file in the medicines feature, so a new one cannot skip these rules. */
function medicineFiles(): string[] {
  const root = "src/features/medicines";
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.resolve(process.cwd(), dir), {
      withFileTypes: true,
    })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(p);
    }
  };
  walk(root);
  return out;
}

describe("the medicine library confers no prescription authority", () => {
  /**
   * The library is reference and recall. If a path ever opens from here into a
   * prescription write, the "doctor reviews, then adds, then finalises"
   * sequence has been bypassed by a convenience feature.
   */
  it("no medicine file imports prescription code or calls a finalisation", () => {
    for (const file of medicineFiles()) {
      const text = code(file);
      const forbidden: Array<[RegExp, string]> = [
        [/from\s+["'][^"']*features\/prescriptions/, "imports prescription code"],
        [/from\s+["'][^"']*features\/encounters/, "imports encounter code"],
        [/\bfinalize\w*\s*\(/i, "calls a finalisation"],
        [/finalize_prescription/, "names finalize_prescription"],
        [/add_prescription_item/, "names add_prescription_item"],
        [/\bprescription_items\b/, "touches prescription_items"],
        [/\bencounters\b/, "touches encounters"],
        [/\bpatients\b/, "touches patients"],
      ];
      for (const [pattern, why] of forbidden) {
        expect(pattern.test(text), `${file} ${why}`).toBe(false);
      }
    }
  });

  /**
   * The declared handover shape exists and is deliberately unused on this
   * branch. Loop C is editing the Rx composer right now; wiring it here would
   * collide, and the spec says not to.
   */
  it("declares the Rx seed contract without wiring it into the composer", () => {
    expect(source("src/features/medicines/medicine.ts")).toContain("toRxDraftSeed");

    const composerFiles = [
      "src/features/prescriptions/actions.ts",
      "src/features/prescriptions/queries.ts",
      "src/features/prescriptions/components/medicine-form.tsx",
      "src/features/prescriptions/components/medicine-list.tsx",
    ];
    for (const file of composerFiles) {
      expect(source(file).includes("features/medicines"), `${file}`).toBe(false);
    }
  });

  /** No SQL in this stage grants anything on a clinical table. */
  it("grants no privilege on prescriptions, encounters or patients", () => {
    const sql = sqlCode(POLICY);
    expect(sql).not.toMatch(/grant[^;]*\bon\b[^;]*\bprescription/i);
    expect(sql).not.toMatch(/grant[^;]*\bon\b[^;]*\bencounter/i);
    expect(sql).not.toMatch(/grant[^;]*\bon\b[^;]*\bpatients?\b/i);
    // And no function here writes one.
    expect(sql).not.toMatch(/(insert into|update)\s+public\.(prescription|encounter|patients)/i);
  });
});

describe("a doctor's saved defaults are private", () => {
  const sql = sqlCode(POLICY);

  /**
   * Every policy on `doctor_medicines` keys off `current_doctor_id()`, which
   * resolves the caller's OWN doctor profile from the verified JWT. Reception,
   * a location admin, the platform owner and another doctor are excluded not by
   * a denial rule that could be forgotten, but by the absence of any rule that
   * would admit them.
   */
  it("scopes every personal-library policy to the caller's own doctor profile", () => {
    for (const policy of [
      "doctor_medicines_select",
      "doctor_medicines_insert",
      "doctor_medicines_update",
    ]) {
      expect(sql, policy).toContain(`create policy ${policy}`);
    }
    const occurrences = sql.match(/doctor_profile_id = public\.current_doctor_id\(\)/g) ?? [];
    // select(using) + insert(check) + update(using) + update(check) = 4.
    expect(occurrences.length).toBe(4);
  });

  /**
   * USING and WITH CHECK do different jobs and neither is redundant: USING says
   * which rows may be touched, WITH CHECK says what a row may become. Without
   * the latter a doctor could re-assign their own row to another doctor and
   * inject a default into someone else's library.
   */
  it("keeps both halves of the update policy", () => {
    const start = sql.indexOf("create policy doctor_medicines_update");
    const update = sql.slice(start, sql.indexOf(";", start));
    expect(update).toContain("using (doctor_profile_id = public.current_doctor_id())");
    expect(update).toContain("with check (doctor_profile_id = public.current_doctor_id())");
  });

  it("admits no location role, no owner bypass and no anon", () => {
    const start = sql.indexOf("-- Doctor's personal library");
    const personal = sql.slice(start);
    expect(personal).not.toContain("has_location_role");
    expect(personal).not.toContain("RECEPTIONIST");
    expect(personal).not.toContain("LOCATION_ADMIN");
    expect(personal).not.toContain("is_platform_owner");
    expect(sql).toContain("revoke all on table public.doctor_medicines from anon");
  });

  /** No action takes a doctor id, so a forged body has no victim to name. */
  it("never accepts a doctor id from the caller", () => {
    const actions = code("src/features/medicines/actions.ts");
    expect(actions).not.toMatch(/doctorProfileId\s*:\s*z\./);
    expect(actions).not.toMatch(/doctor_profile_id:\s*(input|parsed\.data|params)/);
    // The one place it is set reads it from the database, not the payload.
    expect(actions).toContain('supabase.rpc("current_doctor_id")');
  });

  /**
   * "That row is not yours" and "that row does not exist" must be
   * indistinguishable, or a caller can probe for the existence of another
   * doctor's saved medicines. A count is still a disclosure, and so is a
   * distinguishable error.
   */
  it("answers identically for another doctor's row and a missing row", () => {
    const actions = source("src/features/medicines/actions.ts");
    const messages = actions.match(/That medicine is not in your library\./g) ?? [];
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(actions).not.toMatch(/belongs to another doctor/i);
    expect(actions).not.toMatch(/not found/i);

    // The RPC is silent on a no-match for the same reason.
    expect(sqlCode(POLICY)).not.toMatch(/raise exception[^;]*not (yours|found)/i);
  });
});

describe("the catalogue cannot be written through the app", () => {
  const sql = sqlCode(POLICY);

  it("revokes every write verb from authenticated and everything from anon", () => {
    expect(sql).toContain(
      "revoke insert, update, delete, truncate on table public.medicine_references from authenticated",
    );
    expect(sql).toContain("revoke all on table public.medicine_references from anon");
    expect(sql).toContain("grant select on table public.medicine_references to authenticated");
  });

  it("defines no insert, update or delete policy on the catalogue", () => {
    for (const verb of ["insert", "update", "delete"]) {
      expect(
        new RegExp(`create policy medicine_references_\\w+\\s+on public\\.medicine_references for ${verb}`, "i").test(sql),
        verb,
      ).toBe(false);
    }
  });

  it("has no medicine feature file writing the catalogue", () => {
    for (const file of medicineFiles()) {
      const text = code(file);
      expect(
        /from\(["']medicine_references["']\)[\s\S]{0,80}\.(insert|update|delete|upsert)\(/.test(text),
        file,
      ).toBe(false);
    }
  });
});

describe("removal is archival, and history is untouched", () => {
  const sql = sqlCode(POLICY);

  it("revokes DELETE so a library entry cannot be destroyed", () => {
    expect(sql).toContain("revoke delete, truncate on table public.doctor_medicines from authenticated");
    expect(sql).toContain("grant select, insert, update on table public.doctor_medicines to authenticated");
    expect(sql).not.toMatch(/create policy doctor_medicines_delete/);
  });

  it("archives by flag, and no action deletes a row", () => {
    const actions = code("src/features/medicines/actions.ts");
    expect(actions).toContain("is_active:");
    expect(actions).not.toMatch(/\.delete\(\)/);
    expect(actions).not.toMatch(/\.remove\(/);
  });

  /**
   * Archiving cannot reach a prescription in either direction: there is no
   * foreign key from `prescription_items` to this table, and the printed text
   * is stored on the prescription itself.
   */
  it("leaves prescription history structurally independent of the library", () => {
    const schema = source("src/db/schema.ts");
    const start = schema.indexOf('export const prescriptionItems = pgTable(');
    const end = schema.indexOf("\n);", start);
    const items = schema.slice(start, end);

    expect(items).not.toContain("doctorMedicines");
    expect(items).not.toContain("medicineReferences");
    // The printed fields live on the prescription row itself.
    expect(items).toContain('displayName: text("display_name").notNull()');
  });

  /**
   * The reverse direction too: a catalogue row going away must not empty a
   * doctor's library. `set null`, never `cascade`.
   */
  it("keeps a saved entry when its catalogue row is removed", () => {
    const schema = source("src/db/schema.ts");
    const start = schema.indexOf("export const doctorMedicines = pgTable(");
    const dm = schema.slice(start, schema.indexOf("\n);", start));
    expect(dm).toContain('{ onDelete: "set null" }');
    expect(dm).not.toMatch(/medicineReferences[\s\S]{0,120}onDelete:\s*"cascade"/);
  });
});

describe("this branch stays inside its lane", () => {
  /**
   * Loop C owns Voice/Deepgram, Module D owns Documents, Loop B owns
   * commercial. A file changed here that belongs to one of them is a merge
   * conflict at best and a silent regression of their work at worst.
   */
  it("adds no dictation, document, commercial or online-consultation code", () => {
    for (const file of medicineFiles()) {
      const text = code(file);
      for (const banned of [
        "features/dictation",
        "features/documents",
        "features/subscriptions",
        "features/owner",
        "deepgram",
        "SpeechRecognition",
      ]) {
        expect(text.includes(banned), `${file} references ${banned}`).toBe(false);
      }
    }
  });
});
