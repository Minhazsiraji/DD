import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RX_MODULES, type RxModule, type RxModuleSetting } from "@/features/doctor/rx-modules";
import { MODULE_BY_DRAFT_KEY, MODULE_SOURCE, resolveVisibility } from "./module-visibility";
import { CALENDAR_DATE, DRAFT_KEYS, draftPatchSchema, emptyDraft } from "./schema";

/**
 * CONFIGURATION MAY SIMPLIFY FUTURE INPUT.
 * IT MAY NEVER MAKE ALREADY-RECORDED INFORMATION DISAPPEAR.
 *
 * Every test in the first block is that one sentence. The failure it guards is
 * specific and silent: a doctor turns a section off, and clinical text they
 * already wrote is still in the database, still on the prescription, and no
 * longer anywhere on the screen that wrote it.
 */

const EMPTY = { diagnoses: 0, investigations: 0 };

function config(overrides: Partial<Record<RxModule, boolean>>): RxModuleSetting[] {
  return RX_MODULES.map((rxModule) => ({
    module: rxModule,
    useDuringConsultation: overrides[rxModule] ?? true,
    showOnPrint: false,
    printLabel: null,
  }));
}

describe("a section is hidden only when it is BOTH turned off and empty", () => {
  it("ON + empty => shown", () => {
    const v = resolveVisibility(config({}), emptyDraft(), EMPTY);
    expect(v.EXAMINATION.visible).toBe(true);
    expect(v.EXAMINATION.shownBecauseFilled).toBe(false);
  });

  it("OFF + empty => hidden", () => {
    const v = resolveVisibility(config({ EXAMINATION: false }), emptyDraft(), EMPTY);
    expect(v.EXAMINATION.visible).toBe(false);
  });

  it("OFF + existing content => SHOWN, and says why", () => {
    const values = { ...emptyDraft(), examination: "Chest clear. No murmur." };
    const v = resolveVisibility(config({ EXAMINATION: false }), values, EMPTY);
    expect(v.EXAMINATION.visible).toBe(true);
    expect(v.EXAMINATION.shownBecauseFilled).toBe(true);
  });

  it("whitespace is not content — it would pin an empty section open forever", () => {
    const values = { ...emptyDraft(), examination: "   \n  " };
    expect(resolveVisibility(config({ EXAMINATION: false }), values, EMPTY).EXAMINATION.visible)
      .toBe(false);
  });

  it("History needs BOTH its fields empty before it can be hidden", () => {
    /**
     * The printed History section is built from present illness AND past
     * history. Hiding it on one being empty would put the other out of reach
     * while its neighbour stayed on screen.
     */
    const off = config({ HISTORY: false });
    expect(resolveVisibility(off, emptyDraft(), EMPTY).HISTORY.visible).toBe(false);

    for (const key of ["presentIllness", "pastHistory"] as const) {
      const values = { ...emptyDraft(), [key]: "something" };
      const v = resolveVisibility(off, values, EMPTY);
      expect(v.HISTORY.visible, `${key} alone must keep History on screen`).toBe(true);
      expect(v.HISTORY.shownBecauseFilled).toBe(true);
    }
  });

  it("Vitals stay on screen if ANY single reading was taken", () => {
    const off = config({ VITALS: false });
    expect(resolveVisibility(off, emptyDraft(), EMPTY).VITALS.visible).toBe(false);
    const values = { ...emptyDraft(), vitalPulseBpm: "88" };
    expect(resolveVisibility(off, values, EMPTY).VITALS.visible).toBe(true);
  });

  it("Next visit counts a date alone, and a note alone", () => {
    const off = config({ NEXT_VISIT: false });
    expect(resolveVisibility(off, emptyDraft(), EMPTY).NEXT_VISIT.visible).toBe(false);
    expect(
      resolveVisibility(off, { ...emptyDraft(), nextVisitOn: "2026-09-02" }, EMPTY).NEXT_VISIT
        .visible,
    ).toBe(true);
    expect(
      resolveVisibility(off, { ...emptyDraft(), nextVisitNote: "with reports" }, EMPTY).NEXT_VISIT
        .visible,
    ).toBe(true);
  });

  it("a list with rows keeps its section, even turned off", () => {
    const off = config({ DIAGNOSIS: false, INVESTIGATIONS: false });
    const none = resolveVisibility(off, emptyDraft(), EMPTY);
    expect(none.DIAGNOSIS.visible).toBe(false);
    expect(none.INVESTIGATIONS.visible).toBe(false);

    const some = resolveVisibility(off, emptyDraft(), { diagnoses: 1, investigations: 0 });
    expect(some.DIAGNOSIS.visible).toBe(true);
    expect(some.DIAGNOSIS.shownBecauseFilled).toBe(true);
    expect(some.INVESTIGATIONS.visible).toBe(false);
  });

  it("an OLD encounter written before any of this still shows everything it holds", () => {
    /**
     * No migration rewrote prior encounters, so an encounter from before the
     * modules existed is simply one whose fields are full. Every section it
     * holds is visible whatever the doctor has configured since.
     */
    const allOff = config(Object.fromEntries(RX_MODULES.map((m) => [m, false])));
    const legacy = {
      ...emptyDraft(),
      chiefComplaints: "Fever",
      presentIllness: "3 days",
      examination: "Throat congested",
      assessment: "Viral URTI",
      advice: "Fluids and rest",
    };
    const v = resolveVisibility(allOff, legacy, { diagnoses: 2, investigations: 1 });
    for (const rxModule of [
      "CHIEF_COMPLAINT",
      "HISTORY",
      "EXAMINATION",
      "ASSESSMENT",
      "ADVICE",
      "DIAGNOSIS",
      "INVESTIGATIONS",
    ] as const) {
      expect(v[rxModule].visible, `${rxModule} must survive the doctor turning it off`).toBe(true);
    }
    // And the ones it genuinely never held are the only ones hidden.
    expect(v.SYMPTOMS.visible).toBe(false);
    expect(v.NEXT_VISIT.visible).toBe(false);
  });
});

describe("a failed configuration read never hides a clinical field", () => {
  it("null config shows every consultation section", () => {
    const v = resolveVisibility(null, emptyDraft(), EMPTY);
    for (const rxModule of RX_MODULES) {
      if (MODULE_SOURCE[rxModule].kind === "patient-record") continue;
      expect(v[rxModule].visible, `${rxModule} must be shown when the config is unknown`).toBe(true);
    }
  });

  it("a module missing from the configuration defaults to shown", () => {
    const partial = config({}).filter((c) => c.module !== "ASSESSMENT");
    expect(resolveVisibility(partial, emptyDraft(), EMPTY).ASSESSMENT.visible).toBe(true);
  });
});

describe("patient-level modules are not consultation sections", () => {
  it("Allergies and Long-term Medicines have no consultation input at all", () => {
    expect(MODULE_SOURCE.ALLERGY.kind).toBe("patient-record");
    expect(MODULE_SOURCE.LONG_TERM_MEDICINES.kind).toBe("patient-record");
  });

  it("their toggle cannot open a consultation section, in either position", () => {
    for (const use of [true, false]) {
      const v = resolveVisibility(
        config({ ALLERGY: use, LONG_TERM_MEDICINES: use }),
        emptyDraft(),
        EMPTY,
      );
      expect(v.ALLERGY.visible).toBe(false);
      expect(v.LONG_TERM_MEDICINES.visible).toBe(false);
    }
  });

  it("no draft field belongs to them — there is no duplicate encounter editor", () => {
    /**
     * A second place to record an allergy is how two places to record one
     * clinical fact end up disagreeing.
     */
    for (const [, owner] of MODULE_BY_DRAFT_KEY) {
      expect(MODULE_SOURCE[owner].kind).not.toBe("patient-record");
    }
  });

  it("the settings screen says so rather than offering a control that does nothing", async () => {
    const src = await readFile(
      path.resolve("src/features/doctor/components/rx-module-settings.tsx"),
      "utf8",
    );
    expect(src).toMatch(/patientLevel \?/);
    expect(src).toMatch(/Edited on the patient/);
  });
});

describe("consultation visibility and print visibility are different questions", () => {
  it("show_on_print does not decide what the doctor sees while writing", () => {
    const printsButNotWritten = RX_MODULES.map((rxModule) => ({
      module: rxModule,
      useDuringConsultation: false,
      showOnPrint: true,
      printLabel: null,
    }));
    const v = resolveVisibility(printsButNotWritten, emptyDraft(), EMPTY);
    expect(v.EXAMINATION.visible).toBe(false);
  });

  it("use_during_consultation is never read on the print path", async () => {
    /**
     * The review bundle filters on `show_on_print` alone. If it ever consulted
     * the other flag, hiding a field on screen would delete it from a
     * prescription.
     */
    const sql = await readFile(
      path.resolve("supabase/policies/0029_review_bundle_v4.sql"),
      "utf8",
    );
    const builder = sql.slice(sql.indexOf("for v_mod in select"));
    expect(builder).toMatch(/where show_on_print/);
    expect(builder).not.toMatch(/use_during_consultation/);
  });

  it("nothing in the renderer or the bundle view reads the consultation flag", async () => {
    for (const file of [
      "src/features/prescriptions/modular-view.ts",
      "src/features/prescriptions/prescription-view.ts",
      "src/features/prescriptions/renderer-version.ts",
    ]) {
      const text = await readFile(path.resolve(file), "utf8");
      expect(text.includes("useDuringConsultation"), `${file}`).toBe(false);
    }
  });
});

describe("every module's consultation source is declared", () => {
  it("all twelve are accounted for, with no module left undecided", () => {
    for (const rxModule of RX_MODULES) {
      expect(MODULE_SOURCE[rxModule], `${rxModule} has no declared source`).toBeTruthy();
    }
    expect(Object.keys(MODULE_SOURCE).sort()).toEqual([...RX_MODULES].sort());
  });

  it("every draft field belongs to exactly one module", () => {
    /**
     * A field owned by two modules could be hidden by one and shown by the
     * other; a field owned by none could never be hidden at all, silently
     * ignoring the doctor's setting.
     */
    const owned = [...MODULE_BY_DRAFT_KEY.keys()];
    expect(new Set(owned).size).toBe(owned.length);
    for (const key of DRAFT_KEYS) {
      expect(MODULE_BY_DRAFT_KEY.get(key), `${key} belongs to no module`).toBeTruthy();
    }
  });
});

describe("the follow-up date is a day on a calendar, not an instant", () => {
  it("accepts the literal YYYY-MM-DD an <input type=date> emits", () => {
    expect(draftPatchSchema.safeParse({ nextVisitOn: "2026-09-02" }).success).toBe(true);
  });

  it("an empty value clears it, and null clears it", () => {
    expect(draftPatchSchema.safeParse({ nextVisitOn: "" }).success).toBe(true);
    expect(draftPatchSchema.safeParse({ nextVisitOn: null }).success).toBe(true);
  });

  it("REFUSES a timestamp rather than coercing it", () => {
    /**
     * `'2026-09-02T00:00:00Z'::date` resolves through the SESSION timezone, so
     * a doctor in Dhaka choosing the 2nd could have the 1st stored with nothing
     * looking wrong anywhere. A timestamp arriving here means something has
     * already converted a date it should not have touched.
     */
    for (const bad of [
      "2026-09-02T00:00:00Z",
      "2026-09-02T18:30:00+06:00",
      "2026-09-02 00:00:00",
      "02/09/2026",
      "Sep 2 2026",
      "2026-9-2",
    ]) {
      expect(draftPatchSchema.safeParse({ nextVisitOn: bad }).success, bad).toBe(false);
    }
  });

  it("the SQL holds the same rule, so the client copy is not the only one", async () => {
    const sql = await readFile(
      path.resolve("supabase/policies/0032_consultation_adoption.sql"),
      "utf8",
    );
    expect(sql).toMatch(/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
    expect(sql).toMatch(/PATCH_DATE_INVALID/);
    // And the regex the two sides use is the same shape.
    expect(CALENDAR_DATE.source).toBe("^\\d{4}-\\d{2}-\\d{2}$");
  });

  it("no code on this path puts the date through a Date object", async () => {
    /**
     * `new Date("2026-09-02").toISOString()` is 2026-09-01 for every doctor
     * west of UTC. The date never becomes an instant, so it can never shift.
     */
    for (const file of [
      "src/features/encounters/components/next-visit-fields.tsx",
      "src/features/encounters/schema.ts",
      "src/features/encounters/draft-patch.ts",
    ]) {
      const text = (await readFile(path.resolve(file), "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      for (const forbidden of ["new Date(", "toISOString", "getTimezoneOffset", "Date.parse"]) {
        expect(text.includes(forbidden), `${file} must not use ${forbidden}`).toBe(false);
      }
    }
  });

  it("and offers no 'in N days' shortcut that would need a clock", async () => {
    const src = await readFile(
      path.resolve("src/features/encounters/components/next-visit-fields.tsx"),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/addDays|setDate|86400|\+\s*7\b/);
  });
});

describe("Symptoms and Next Visit write to the columns that already exist", () => {
  it("the patch contract carries all three, and no shadow field", () => {
    expect(DRAFT_KEYS).toContain("symptoms");
    expect(DRAFT_KEYS).toContain("nextVisitNote");
    expect(DRAFT_KEYS).toContain("nextVisitOn");
  });

  it("the RPC accepts them and maps them to the existing columns", async () => {
    const sql = await readFile(
      path.resolve("supabase/policies/0032_consultation_adoption.sql"),
      "utf8",
    );
    // All three are in the RPC's allowed-key list, or the write is refused.
    for (const key of ["'symptoms'", "'nextVisitNote'", "'nextVisitOn'"]) {
      expect(sql.includes(key), `${key} missing from assert_patch_shape`).toBe(true);
    }
    expect(sql).toMatch(/symptoms\s+= public\.patch_text\(p_patch, 'symptoms', symptoms\)/);
    expect(sql).toMatch(
      /next_visit_note\s+= public\.patch_text\(p_patch, 'nextVisitNote', next_visit_note\)/,
    );
    expect(sql).toMatch(
      /next_visit_on\s+= public\.patch_date\(p_patch, 'nextVisitOn', next_visit_on\)/,
    );
  });

  it("text is preserved literally — the patch layer never rewrites it", () => {
    const exact = "জ্বর ৩ দিন — 500g sugar/week";
    expect(draftPatchSchema.safeParse({ symptoms: exact }).success).toBe(true);
  });
});
