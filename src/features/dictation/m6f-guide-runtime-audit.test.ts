import { describe, expect, it } from "vitest";
import { parseM6EPrescriptionVoiceTargeting } from "@/features/prescriptions/m6e-prescription-voice-targeting";
import { parseM6FConsultationCommand } from "./m6f-consultation-controls";
import { parseM6FInvestigationCommand } from "./m6f-investigation-controls";
import { M6F_VOICE_SURFACE_INVENTORY } from "./m6f-voice-surface-inventory";
import { normalizeM6FCommandText } from "./m6f-action-grammar";
import { M6F_VOICE_GUIDE_CERTIFICATION, M6F_VOICE_GUIDE_CERTIFICATION_TOTALS } from "./m6f-voice-guide";
import { readFileSync } from "node:fs";
import path from "node:path";

function recognized(entry: (typeof M6F_VOICE_SURFACE_INVENTORY)[number], phrase: string) {
  if (entry.page === "consultation") {
    const investigation = parseM6FInvestigationCommand(phrase);
    if (investigation.type !== "NONE") return investigation;
    return parseM6FConsultationCommand(phrase, {
      activeTarget: entry.sourceKey as never,
      destination: { kind: "note", target: "examination" },
    });
  }
  return parseM6EPrescriptionVoiceTargeting(phrase, {
    editorOpen: entry.canonicalId !== "prescription.medicine.form",
    fieldTarget: null,
    destinationKind: entry.section === "autopilot" ? "AUTOPILOT" : "MEDICINE_FORM",
    autopilotProposalActive: true,
    medicineResultsActive: entry.canonicalId === "prescription.results",
  });
}

const PRESCRIPTION_ACTION_TYPES: Readonly<Record<string, readonly string[]>> = {
  "prescription.medicines.section": ["TARGET_MEDICINES"],
  "prescription.medicine.form": ["OPEN_ADD"],
  "prescription.medicine.prn": ["SET_PRN"],
  "prescription.medicine.substitution": ["SET_SUBSTITUTION"],
  "prescription.results": ["READ_MEDICINE_MATCHES", "NEXT_MEDICINE_MATCH"],
  "prescription.saved": ["TARGET_MEDICINE", "NEXT_MEDICINE"],
  "prescription.history.signed": ["OPEN_SIGNED_HISTORY"],
  "prescription.history.reuse": ["OPEN_REUSE_HISTORY"],
  "prescription.history.recent": ["OPEN_SIGNED_HISTORY"],
  "prescription.history.frequent": ["OPEN_SIGNED_HISTORY"],
  "prescription.history.favorites": ["SEARCH_MEDICINE"],
  "prescription.history.mine": ["SEARCH_MEDICINE"],
  "prescription.autopilot.destination": ["TARGET_AUTOPILOT"],
  "prescription.autopilot.generate": ["GENERATE_AUTOPILOT"],
  "prescription.autopilot.proposal": ["READ_AUTOPILOT"],
  "prescription.autopilot.select": ["SELECT_AUTOPILOT_MEDICINE"],
  "prescription.autopilot.edit": ["EDIT_AUTOPILOT_MEDICINE"],
  "prescription.autopilot.remove": ["REMOVE_AUTOPILOT_MEDICINE"],
  "prescription.autopilot.discard": ["DISCARD_AUTOPILOT"],
  "prescription.autopilot.apply": ["APPLY_AUTOPILOT"],
  "prescription.autopilot.navigation": ["NEXT_AUTOPILOT_ITEM"],
  "prescription.review": ["REVIEW_PRESCRIPTION"],
};

const CONSULTATION_RUNTIME_TARGETS: Readonly<Record<string, string>> = {
  followUp: "nextVisitNote",
  investigations: "section",
  investigationSearch: "search",
  stagedInvestigations: "stagedList",
  stagedInvestigationTitle: "stagedTitle",
  stagedInvestigationNote: "stagedNote",
  confirmedInvestigationTitle: "confirmedTitle",
  confirmedInvestigationNote: "confirmedNote",
};

function canonicalMismatch(
  entry: (typeof M6F_VOICE_SURFACE_INVENTORY)[number],
  result: ReturnType<typeof recognized>,
): string | null {
  if (entry.page === "consultation") {
    if (entry.canonicalId === "consultation.investigation.confirm") return result.type === "PROTECTED_CONFIRM" ? null : result.type;
    if (entry.canonicalId === "consultation.prescription.open") return result.type === "OPEN_PRESCRIPTION" ? null : result.type;
    const expectedTargets = new Set([entry.sourceKey, CONSULTATION_RUNTIME_TARGETS[entry.sourceKey] ?? entry.sourceKey]);
    return result.type === "TARGET" && "target" in result && expectedTargets.has(String(result.target))
      ? null
      : `${result.type}:${"target" in result ? String(result.target) : ""}`;
  }
  if (entry.canonicalId.startsWith("prescription.medicine.") && entry.editable && !entry.canonicalId.endsWith(".prn") && !entry.canonicalId.endsWith(".substitution")) {
    return result.type === "TARGET_FIELD" && "field" in result && result.field === entry.sourceKey
      ? null
      : `${result.type}:${"field" in result ? String(result.field) : ""}`;
  }
  const expected = PRESCRIPTION_ACTION_TYPES[entry.canonicalId] ?? [];
  return expected.includes(result.type) ? null : `${result.type} (expected ${expected.join(" or ")})`;
}

describe("Voice Guide runtime audit baseline", () => {
  it("certifies every advertised language example through a real runtime parser", () => {
    const failures = M6F_VOICE_SURFACE_INVENTORY.flatMap((entry) => ([
      ["english", entry.aliasesEnglish],
      ["bangla", entry.aliasesBangla],
      ["banglish", entry.aliasesBanglish],
    ] as const).flatMap(([language, phrases]) => phrases.flatMap((phrase) => {
      const result = recognized(entry, phrase);
      expect(normalizeM6FCommandText(phrase).canonicalCommandText).not.toBe("");
      const mismatch = canonicalMismatch(entry, result);
      return mismatch
        ? [{ canonicalId: entry.canonicalId, language, phrase, mismatch }]
        : [];
    })));
    expect(failures).toEqual([]);
  });

  it("classifies every inventory row and proves a runtime dispatcher owns the recognized intents", () => {
    expect(M6F_VOICE_GUIDE_CERTIFICATION).toHaveLength(M6F_VOICE_SURFACE_INVENTORY.length);
    expect(M6F_VOICE_GUIDE_CERTIFICATION_TOTALS.failed).toBe(0);
    expect(M6F_VOICE_GUIDE_CERTIFICATION_TOTALS.unsupported).toBe(0);
    const consultationRuntime = readFileSync(path.resolve("src/features/encounters/components/m6a-voice-panel.tsx"), "utf8");
    const prescriptionRuntime = readFileSync(path.resolve("src/features/prescriptions/use-m6e-prescription-voice.ts"), "utf8");
    for (const intent of ["SET_BP", "SET_FOLLOW_UP", "SET_DRAFT", "CLEAR_DRAFT", "TARGET", "READ_TARGET", "OPEN_PRESCRIPTION", "PROTECTED_CONFIRM_INVESTIGATIONS"]) {
      expect(consultationRuntime).toContain(`intent.type === "${intent}"`);
    }
    for (const intent of ["OPEN_ADD", "TARGET_FIELD", "SET_FIELD", "SEARCH_MEDICINE", "USE_MEDICINE_MATCH", "TARGET_AUTOPILOT", "APPLY_AUTOPILOT", "REVIEW_PRESCRIPTION", "PROHIBITED_FINALIZE"]) {
      expect(prescriptionRuntime).toContain(`case "${intent}"`);
    }
  });

  it("keeps contextual BP-looking speech as Examination dictation", () => {
    expect(parseM6FConsultationCommand("BP 110/80", {
      activeTarget: "examination",
      destination: { kind: "note", target: "examination" },
    })).toEqual({ type: "NONE" });
    expect(parseM6FConsultationCommand("set BP 110/80", {
      activeTarget: "examination",
      destination: { kind: "note", target: "examination" },
    })).toEqual({ type: "SET_BP", systolic: "110", diastolic: "80" });
  });
});
