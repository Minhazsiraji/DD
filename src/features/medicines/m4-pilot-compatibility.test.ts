import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MEDICINE_NORMALIZATION_VECTORS,
  MIN_SEARCH_LENGTH,
  draftFromReference,
  isSearchable,
  normalizeMedicineText,
  toRxDraftSeed,
  type DoctorMedicine,
  type MedicineReference,
} from "./medicine";
import { MEDICINE_FIELDS } from "@/features/prescriptions/schema";

const POLICY = "supabase/policies/0051_medicines_v1_reconciliation.sql";
const BASE_M3 = "4ba474224a5ca68d5bb3d290e9158b7e08030cbd";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

function sqlCode(): string {
  return source(POLICY)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--[^\n]*$/gm, "");
}

function reference(over: Partial<MedicineReference> = {}): MedicineReference {
  return {
    id: "ref-1",
    genericName: "Paracetamol",
    brandName: "Napa",
    strengthText: "500 mg",
    dosageForm: "Tablet",
    manufacturer: "Fixture Pharma",
    countryCode: "BD",
    regulatorName: "DGDA",
    sourceKind: "MANUAL_SEED",
    lastVerifiedAt: null,
    ...over,
  };
}

function saved(over: Partial<DoctorMedicine> = {}): DoctorMedicine {
  return {
    id: "dm-1",
    medicineReferenceId: "ref-1",
    displayName: "Napa 500 mg",
    genericName: "Paracetamol",
    brandName: "Napa",
    strengthText: "500 mg",
    dosageForm: "Tablet",
    route: "Oral",
    defaultDoseText: "1 tablet",
    defaultScheduleText: "1+0+1",
    defaultDurationText: "5 days",
    defaultQuantityText: "10 tablets",
    defaultFoodRelation: "After food",
    defaultInstructions: "Fixture instruction",
    defaultIsPrn: false,
    isFavorite: true,
    usageCount: 3,
    lastUsedAt: "2026-09-01T00:00:00Z",
    isActive: true,
    ...over,
  };
}

describe("M4 canonical search and catalogue authority", () => {
  it("keeps TypeScript and SQL normalization aligned", () => {
    for (const [input, expected] of MEDICINE_NORMALIZATION_VECTORS) {
      expect(normalizeMedicineText(input)).toBe(expected);
    }
    expect(source(POLICY)).toContain(
      "lower(btrim(regexp_replace(coalesce(p_text, ''), '\\s+', ' ', 'g')))",
    );
  });

  it("keeps short queries out and the SQL search literal/bounded", () => {
    expect(MIN_SEARCH_LENGTH).toBe(2);
    expect(isSearchable("p")).toBe(false);
    expect(isSearchable("pa")).toBe(true);
    const sql = sqlCode();
    expect(sql).toContain("length(q.needle) >= 2");
    expect(sql).toContain("least(greatest(coalesce(p_limit, 25), 1), 100)");
    for (const banned of ["similarity(", "levenshtein", "soundex", "metaphone", "pg_trgm"])
      expect(sql).not.toContain(banned);
  });

  it("keeps reference data read-only and active-only", () => {
    const sql = sqlCode();
    expect(sql).toContain("using (is_active)");
    expect(sql).toContain(
      "revoke insert, update, delete, truncate on table public.medicine_references from authenticated",
    );
    expect(sql).toContain("revoke all on table public.medicine_references from anon");
  });
});

describe("doctor-private Medicine authority", () => {
  it("scopes select/insert/update to current_doctor_id and has no delete policy", () => {
    const sql = sqlCode();
    expect((sql.match(/doctor_profile_id = public\.current_doctor_id\(\)/g) ?? []).length).toBe(4);
    expect(sql).not.toContain("create policy doctor_medicines_delete");
    expect(sql).toContain("revoke delete, truncate on table public.doctor_medicines from authenticated");
    expect(sql).toContain("revoke all on table public.doctor_medicines from anon");
  });

  it("keeps the usage RPC definer bounded by ownership and closed to anon/PUBLIC", () => {
    const sql = sqlCode();
    expect(sql).toContain("security definer");
    expect(sql).toContain("doctor_profile_id = v_doctor");
    expect(sql).toContain("revoke all on function public.touch_doctor_medicine(uuid) from public, anon");
    expect(sql).toContain("grant execute on function public.touch_doctor_medicine(uuid) to authenticated");
  });

  it("never invents clinical defaults from a catalogue row", () => {
    const draft = draftFromReference(reference());
    expect(draft.displayName).toBe("Napa 500 mg");
    expect(draft.defaultDoseText).toBeNull();
    expect(draft.defaultScheduleText).toBeNull();
    expect(draft.defaultDurationText).toBeNull();
    expect(draft.defaultQuantityText).toBeNull();
    expect(draft.defaultInstructions).toBeNull();
  });
});

describe("frozen M3 Prescription V2 compatibility", () => {
  it("maps a saved doctor medicine onto every shared M3 medicine text field", () => {
    const seed = toRxDraftSeed(saved());
    const m3Keys = new Set(MEDICINE_FIELDS.map((field) => field.key));
    for (const key of [
      "displayName", "brandName", "genericName", "strengthText", "doseText",
      "dosageForm", "route", "scheduleText", "durationText", "quantityText",
      "foodRelation", "instructions",
    ]) expect(m3Keys.has(key as never), key).toBe(true);

    expect(seed).toMatchObject({
      displayName: "Napa 500 mg",
      genericName: "Paracetamol",
      brandName: "Napa",
      strengthText: "500 mg",
      dosageForm: "Tablet",
      doseText: "1 tablet",
      scheduleText: "1+0+1",
      durationText: "5 days",
      quantityText: "10 tablets",
      foodRelation: "After food",
      instructions: "Fixture instruction",
      isPrn: false,
    });
  });

  it("does not import or rewrite frozen Prescription implementation", () => {
    const files = [
      "src/features/medicines/actions.ts",
      "src/features/medicines/queries.ts",
      "src/features/medicines/medicine.ts",
    ];
    for (const file of files) {
      const text = source(file).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(text).not.toMatch(/features\/prescriptions/);
      expect(text).not.toMatch(/finalize_prescription|add_prescription_item/);
    }
    expect(BASE_M3).toHaveLength(40);
  });
});
