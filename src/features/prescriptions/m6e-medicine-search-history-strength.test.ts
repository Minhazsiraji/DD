import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyMedicine } from "./schema";
import {
  canonicalizeSelectedMedicineDraft,
  hasExactTrailingStrength,
  medicineDisplayWithStrength,
} from "./medicine-display";
import {
  m6eMedicineVariantStatus,
  parseM6EPrescriptionVoice,
} from "./m6e-prescription-voice-contract";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const resultContext = {
  editorOpen: true,
  fieldTarget: "displayName" as const,
  autopilotProposalActive: true,
  medicineResultsActive: true,
};

describe("M6E authoritative medicine result commands", () => {
  it.each([
    ["Use medicine 1", 1],
    ["Use medicine number 2", 2],
    ["Use variant 3", 3],
    ["Select variant 1", 1],
    ["Choose variant 2", 2],
    ["Choose medicine 3", 3],
    ["Select medicine 1", 1],
    ["ভ্যারিয়েন্ট এক নাও", 1],
    ["ভ্যারিয়েন্ট দুই সিলেক্ট করো", 2],
    ["মেডিসিন এক নাও", 1],
    ["মেডিসিন দুই সিলেক্ট করো", 2],
    ["variant 1 nao", 1],
    ["variant 2 select koro", 2],
    ["medicine 1 nao", 1],
    ["medicine 2 select koro", 2],
    ["ভ্যারিয়েন্ট ১", 1],
    ["মেডিসিন ৩", 3],
  ])("routes %s to current result %i", (phrase, index) => {
    expect(parseM6EPrescriptionVoice(phrase, resultContext)).toEqual({
      type: "USE_MEDICINE_MATCH",
      index,
    });
  });

  it.each([
    ["Next variant", "NEXT_MEDICINE_MATCH"],
    ["পরের ভ্যারিয়েন্ট", "NEXT_MEDICINE_MATCH"],
    ["Previous variant", "PREVIOUS_MEDICINE_MATCH"],
    ["আগের ভ্যারিয়েন্ট", "PREVIOUS_MEDICINE_MATCH"],
    ["Read variants", "READ_MEDICINE_MATCHES"],
    ["Read medicine matches", "READ_MEDICINE_MATCHES"],
    ["ভ্যারিয়েন্টগুলো পড়ো", "READ_MEDICINE_MATCHES"],
    ["variant gulo poro", "READ_MEDICINE_MATCHES"],
    ["Select current variant", "USE_CURRENT_MEDICINE_MATCH"],
    ["বর্তমান ভ্যারিয়েন্ট নাও", "USE_CURRENT_MEDICINE_MATCH"],
    ["Use exact match", "USE_EXACT_MEDICINE_MATCH"],
  ])("parses %s deterministically", (phrase, type) => {
    expect(parseM6EPrescriptionVoice(phrase, resultContext).type).toBe(type);
  });

  it("protects Autopilot from generic medicine-result commands", () => {
    expect(parseM6EPrescriptionVoice("Select medicine 1", resultContext)).toEqual({
      type: "USE_MEDICINE_MATCH",
      index: 1,
    });
    expect(parseM6EPrescriptionVoice("Select proposal medicine 1", resultContext)).toEqual({
      type: "SELECT_AUTOPILOT_MEDICINE",
      index: 1,
    });
  });

  it("does not reinterpret a bare saved-medicine target without active results", () => {
    expect(parseM6EPrescriptionVoice("Medicine 3", {
      ...resultContext,
      medicineResultsActive: false,
    })).toEqual({ type: "TARGET_MEDICINE", index: 3 });
  });
});

describe("M6E exact strength canonicalization", () => {
  it.each([
    ["Paracetamol 500 mg", "500 mg", "Paracetamol 500 mg"],
    ["Napa Extra", "500 mg", "Napa Extra 500 mg"],
    ["Acyvir 250 mg/vial", "250 mg/vial", "Acyvir 250 mg/vial"],
  ])("prints %s and %s exactly once", (name, strength, expected) => {
    expect(medicineDisplayWithStrength(name, strength)).toBe(expected);
  });

  it("canonicalizes only a complete normalized trailing strength", () => {
    expect(canonicalizeSelectedMedicineDraft({
      ...emptyMedicine(),
      displayName: "Paracetamol   500 MG",
      strengthText: "500 mg",
    })).toMatchObject({ displayName: "Paracetamol", strengthText: "500 mg" });
  });

  it.each([
    ["Vitamin B12", "12"],
    ["Napa Extend", "500 mg"],
    ["Drug 500 mg SR", "500 mg"],
    ["Acyvir 250 mg/vial IV", "250 mg/vial"],
  ])("does not fuzzy-strip %s with %s", (name, strength) => {
    expect(hasExactTrailingStrength(name, strength)).toBe(false);
    expect(canonicalizeSelectedMedicineDraft({
      ...emptyMedicine(),
      displayName: name,
      strengthText: strength,
    }).displayName).toBe(name);
  });
});

describe("M6E result lifecycle and signed-history contracts", () => {
  it("uses one lifted result list for inline, mouse, and voice selection", () => {
    const composer = read("src/features/prescriptions/components/prescription-composer.tsx");
    const form = read("src/features/prescriptions/components/medicine-form.tsx");
    const panel = read("src/features/prescriptions/components/m6e-prescription-voice-panel.tsx");
    expect(composer.match(/prescriptionVoice\.medicineMatches/gu)).toHaveLength(3);
    expect(form).not.toContain("useState<MedicineVariantMatch");
    expect(panel).not.toContain("setMedicineMatches");
  });

  it("renders the authoritative detailed numbered cards exactly once in the editor", () => {
    const form = read("src/features/prescriptions/components/medicine-form.tsx");
    const panel = read("src/features/prescriptions/components/m6e-prescription-voice-panel.tsx");
    expect(form.match(/Available medicine variants/gu)).toHaveLength(2);
    expect(form.match(/visibleVariants\.map/gu)).toHaveLength(1);
    expect(panel).not.toContain("Medicine matches");
    expect(panel).not.toContain("medicineMatches.map");
    expect(panel).not.toContain("data-m6e-medicine-matches");
  });

  it("keeps the sticky Voice result state compact and count-only", () => {
    const composer = read("src/features/prescriptions/components/prescription-composer.tsx");
    const panel = read("src/features/prescriptions/components/m6e-prescription-voice-panel.tsx");
    expect(m6eMedicineVariantStatus(4)).toBe(
      "4 medicine variants found. Say “Use medicine 1”, “Next variant”, or choose a variant below.",
    );
    expect(composer).toContain("medicineMatchCount={prescriptionVoice.medicineMatches.length}");
    expect(panel).toContain("medicineMatchCount: number");
    expect(panel).not.toContain("readonly { key: string; label: string");
  });

  it("opens a staged editor for a Voice search without changing the explicit save boundary", () => {
    const controller = read("src/features/prescriptions/use-m6e-prescription-voice.ts");
    const searchCase = controller.slice(
      controller.indexOf('case "SEARCH_MEDICINE"'),
      controller.indexOf('case "USE_MEDICINE_MATCH"'),
    );
    expect(searchCase).toContain("rx.openAdd()");
    expect(searchCase).toContain("displayName: intent.query.trim()");
    expect(searchCase).toContain("suppressNextInlineSearch.current");
    expect(searchCase).toContain('field: "displayName"');
    expect(searchCase).not.toMatch(/submit|addMedicineAction|updateMedicineAction/);
  });

  it("keeps Read variants as transient textual feedback, not a persistent second panel", () => {
    const controller = read("src/features/prescriptions/use-m6e-prescription-voice.ts");
    const panel = read("src/features/prescriptions/components/m6e-prescription-voice-panel.tsx");
    expect(controller).toContain("function readMedicineMatches(): string");
    expect(controller).toContain("matches.map((match, index) => `${index + 1}. ${match.label}`)");
    expect(panel).not.toContain("medicineMatches.map");
  });

  it("clears compact count feedback with the authoritative result lifecycle", () => {
    const panel = read("src/features/prescriptions/components/m6e-prescription-voice-panel.tsx");
    const composer = read("src/features/prescriptions/components/prescription-composer.tsx");
    expect(panel).toContain("medicineMatchCount > 0");
    expect(panel).toContain("m6eMedicineVariantStatus(medicineMatchCount)");
    expect(panel).not.toContain("previousMedicineMatchCount");
    expect(composer).toContain("onVoiceSessionEnd={prescriptionVoice.clearMedicineMatches}");
  });

  it("keeps the compact sticky shell responsive without a detailed-list expansion", () => {
    const panel = read("src/features/prescriptions/components/m6e-prescription-voice-panel.tsx");
    const form = read("src/features/prescriptions/components/medicine-form.tsx");
    expect(panel).toContain('className="sticky top-2 z-40 min-w-0"');
    expect(panel).toContain("overflow-x-hidden");
    expect(panel).toContain("sm:grid-cols-2");
    expect(panel).not.toMatch(/<ol|medicineMatches\.map/);
    expect(form).toContain("sm:grid-cols-2 xl:grid-cols-3");
  });

  it("invalidates selection authority by generation and query identity", () => {
    const controller = read("src/features/prescriptions/use-m6e-prescription-voice.ts");
    expect(controller).toContain("medicineLookupGeneration.current !== generation");
    expect(controller).toContain("identity.query !== normalizedMedicineQuery(query)");
    expect(controller).toContain("medicineLookupAbort.current?.abort()");
  });

  it("clears result authority on selection, clear, cancel, target change, and editor close", () => {
    const controller = read("src/features/prescriptions/use-m6e-prescription-voice.ts");
    expect(controller).toContain("if (!medicineSearchDestination(next)) clearMedicineMatches()");
    expect(controller).toContain("if (wasOpen && !isOpen) clearMedicineMatches()");
    expect(controller.match(/clearMedicineMatches\(\)/gu)?.length).toBeGreaterThanOrEqual(7);
  });

  it("clears result authority on new, ended, and cancelled Voice sessions", () => {
    const composer = read("src/features/prescriptions/components/prescription-composer.tsx");
    const panel = read("src/features/prescriptions/components/m6e-prescription-voice-panel.tsx");
    expect(composer).toContain("onVoiceSessionStart={prescriptionVoice.clearMedicineMatches}");
    expect(composer).toContain("onVoiceSessionEnd={prescriptionVoice.clearMedicineMatches}");
    expect(panel.match(/onVoiceSessionEnd\(\)/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps selection staged and the explicit Add/Save boundary intact", () => {
    const controller = read("src/features/prescriptions/use-m6e-prescription-voice.ts");
    expect(controller).toContain("rx.setDraft({ ...match.draft })");
    expect(controller).not.toContain("addMedicineAction");
  });

  it("preserves deterministic Recent and Frequent RPC ordering semantics", () => {
    const sql = read("supabase/policies/0043_m3_signed_medicine_history.sql");
    expect(sql).toContain("case when v_order = 'RECENT' then s.latest_use end desc");
    expect(sql).toContain("case when v_order = 'FREQUENT' then s.distinct_rx_count end desc");
    expect(sql).toContain("case when v_order = 'FREQUENT' then s.latest_use end desc");
    expect(sql).toContain("l.normalized_name asc");
  });
});
