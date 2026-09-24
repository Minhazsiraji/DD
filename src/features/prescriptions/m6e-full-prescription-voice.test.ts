import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AutopilotPrescription } from "@/features/autopilot/contracts";
import {
  proposalWithSelectedMedicines,
  selectionAfterMedicineRemoval,
} from "@/features/autopilot/m6e-voice-adapter";
import {
  parseM6EPrescriptionVoice,
  parseM6EVoiceSessionControl,
  parseStructuredMedicineSpeech,
} from "./m6e-prescription-voice-contract";
import { isDuplicateM6ESessionFinal } from "./components/m6e-prescription-voice-panel";

const noEditor = { editorOpen: false, fieldTarget: null } as const;
const editor = { editorOpen: true, fieldTarget: null } as const;

function proposal(): AutopilotPrescription {
  const medicine = (displayName: string): AutopilotPrescription["medicines"][number] => ({
    medicineReferenceId: null, displayName, brandName: null, genericName: null,
    strengthText: "500 mg", doseText: "1 tablet", dosageForm: "Tablet", route: "Oral",
    scheduleText: "Once daily", durationText: "5 days", quantityText: null,
    foodRelation: null, instructions: null, isPrn: false, substitutionAllowed: true,
    needsReview: [], sourceRefs: [{ kind: "consultation", ref: "assessment" }],
  });
  return {
    type: "AUTOPILOT_PRESCRIPTION", schemaVersion: 1, status: "PROPOSAL",
    medicines: [medicine("Napa"), medicine("Ace"), medicine("ORS")],
    investigations: [], advice: [],
    followUp: { date: null, intervalText: null, note: null, needsReview: [], sourceRefs: [] },
    warnings: [], uncertainties: [],
    context: {
      doctorId: "00000000-0000-4000-8000-000000000001",
      encounterId: "00000000-0000-4000-8000-000000000002",
      patientId: "00000000-0000-4000-8000-000000000003",
      practiceLocationId: "00000000-0000-4000-8000-000000000004",
      prescriptionId: "00000000-0000-4000-8000-000000000005",
      encounterVersion: 1, prescriptionVersion: 1,
    },
  };
}

describe("M6E B-G complete deterministic command contract", () => {
  it.each([
    ["Medicines", { type: "TARGET_MEDICINES" }],
    ["Go to medicines", { type: "TARGET_MEDICINES" }],
    ["Medicine 2", { type: "TARGET_MEDICINE", index: 2 }],
    ["medicine two edit koro", { type: "EDIT_MEDICINE", index: 2 }],
    ["medicine 2 remove koro", { type: "REQUEST_REMOVE", index: 2 }],
    ["ওষুধ যোগ করো", { type: "OPEN_ADD" }],
    ["পরের ওষুধ", { type: "NEXT_MEDICINE" }],
    ["আগের ওষুধ", { type: "PREVIOUS_MEDICINE" }],
    ["Read medicine", { type: "READ_MEDICINE" }],
  ] as const)("routes standalone medicine command %s", (spoken, expected) => {
    expect(parseM6EPrescriptionVoice(spoken, noEditor)).toEqual(expected);
  });

  it.each([
    ["Autopilot", { type: "TARGET_AUTOPILOT" }],
    ["Generate with Autopilot", { type: "GENERATE_AUTOPILOT" }],
    ["Read proposal", { type: "READ_AUTOPILOT" }],
    ["Next proposal item", { type: "NEXT_AUTOPILOT_ITEM" }],
    ["Previous proposal item", { type: "PREVIOUS_AUTOPILOT_ITEM" }],
    ["Select medicine 1", { type: "SELECT_AUTOPILOT_MEDICINE", index: 1 }],
    ["Deselect medicine 2", { type: "DESELECT_AUTOPILOT_MEDICINE", index: 2 }],
    ["Edit medicine 1", { type: "EDIT_AUTOPILOT_MEDICINE", index: 1 }],
    ["Remove medicine 2", { type: "REMOVE_AUTOPILOT_MEDICINE", index: 2 }],
    ["Discard proposal", { type: "DISCARD_AUTOPILOT" }],
    ["Apply selected", { type: "APPLY_AUTOPILOT" }],
  ] as const)("routes proposal command %s only in proposal context", (spoken, expected) => {
    expect(parseM6EPrescriptionVoice(spoken, { ...noEditor, autopilotProposalActive: true })).toEqual(expected);
  });

  it.each([
    ["Pause", "PAUSE"], ["পজ", "PAUSE"], ["Resume", "RESUME"],
    ["চালিয়ে যাও", "RESUME"], ["End", "END"], ["শেষ করো", "END"],
  ] as const)("routes session control %s", (spoken, expected) => {
    expect(parseM6EVoiceSessionControl(spoken)).toBe(expected);
  });

  it("uses exact normalized final medicine speech for English, Bengali, and mixed forms", () => {
    expect(parseStructuredMedicineSpeech("Napa 500 mg one tablet three times daily for five days after food")).toMatchObject({
      displayName: "Napa", strengthText: "500 mg", doseText: "1 tablet",
      scheduleText: "Three times daily", durationText: "5 days", foodRelation: "After food",
    });
    expect(parseStructuredMedicineSpeech("Napa পাঁচশ এমজি একটা ট্যাবলেট দিনে তিনবার পাঁচ দিন খাবারের পরে")).toMatchObject({
      displayName: "Napa", strengthText: "500 mg", doseText: "1 tablet",
      scheduleText: "Three times daily", durationText: "5 days", foodRelation: "After food",
    });
    expect(parseStructuredMedicineSpeech("Napa পাঁচশ mg একটা tablet দিনে তিনবার five days")).toMatchObject({
      displayName: "Napa", strengthText: "500 mg", doseText: "1 tablet",
      scheduleText: "Three times daily", durationText: "5 days",
    });
    expect(parseM6EPrescriptionVoice("Napa", { editorOpen: true, fieldTarget: "displayName" })).toEqual({
      type: "SET_FIELD", field: "displayName", value: "Napa",
    });
    expect(parseStructuredMedicineSpeech("Drug 250 microgram 2 tablets 1+0+1 for দুই week")).toMatchObject({
      displayName: "Drug", strengthText: "250 mcg", doseText: "2 tablets",
      scheduleText: "1+0+1", durationText: "2 weeks",
    });
  });

  it("supports bounded staged field editing without saving", () => {
    expect(parseM6EPrescriptionVoice("change dose to one tablet", editor)).toEqual({ type: "SET_FIELD", field: "doseText", value: "1 tablet" });
    expect(parseM6EPrescriptionVoice("frequency twice daily", editor)).toEqual({ type: "SET_FIELD", field: "scheduleText", value: "Twice daily" });
    expect(parseM6EPrescriptionVoice("duration seven days", editor)).toEqual({ type: "SET_FIELD", field: "durationText", value: "7 days" });
    expect(parseM6EPrescriptionVoice("খাবারের পরে", editor)).toEqual({ type: "SET_FIELD", field: "foodRelation", value: "After food" });
    expect(parseStructuredMedicineSpeech("Napa 500 mg half tablet morning and night for 2 weeks")).toMatchObject({
      doseText: "Half tablet", scheduleText: "Morning and night", durationText: "2 weeks",
    });
  });

  it.each([
    "Patient was prescribed Napa previously",
    "Doctor may review prescription tomorrow",
    "Patient stopped medicine two days ago",
    "He said remove medicine from home",
    "History mentions finalize treatment later",
    "Generate energy with autopilot system",
  ])("does not fire on collision prose: %s", (spoken) => {
    expect(parseM6EPrescriptionVoice(spoken, editor)).toEqual({ type: "UNKNOWN", rawText: spoken });
  });

  it("prohibits every finalize/sign/complete voice form", () => {
    for (const spoken of ["Finalize prescription", "Sign prescription", "Complete prescription", "Prescription finalize"]) {
      expect(parseM6EPrescriptionVoice(spoken, noEditor)).toEqual({ type: "PROHIBITED_FINALIZE" });
    }
  });

  it("filters only explicitly selected proposal medicines and reindexes safely after removal", () => {
    const source = proposal();
    expect(proposalWithSelectedMedicines(source, new Set([0, 2])).medicines.map((row) => row.displayName)).toEqual(["Napa", "ORS"]);
    expect([...selectionAfterMedicineRemoval(new Set([0, 2]), 0)]).toEqual([1]);
    expect(source.medicines).toHaveLength(3);
  });

  it("consumes a duplicate provider session-final without executing twice", () => {
    expect(isDuplicateM6ESessionFinal("Apply selected.", "Apply selected")).toBe(true);
    expect(isDuplicateM6ESessionFinal("Next medicine", "Apply selected")).toBe(false);
  });
});

describe("M6E clinical-authority source boundaries", () => {
  const root = process.cwd();
  const panelSource = readFileSync(resolve(root, "src/features/autopilot/components/m6c2-autopilot-panel.tsx"), "utf8");
  const controllerSource = readFileSync(resolve(root, "src/features/prescriptions/use-m6e-prescription-voice.ts"), "utf8");
  const voiceSource = readFileSync(resolve(root, "src/features/prescriptions/components/m6e-prescription-voice-panel.tsx"), "utf8");

  it("reuses the existing M6C Generate and Apply actions without a second AI engine", () => {
    expect(panelSource).toContain("generateAutopilotPrescriptionProposalAction");
    expect(panelSource).toContain("applyAutopilotProposalToDraftAction");
    expect(controllerSource).toContain("autopilotVoiceRef.current.generate()");
    expect(controllerSource).toContain("autopilotVoiceRef.current.apply()");
  });

  it("has no voice-accessible finalize action import or call", () => {
    expect(voiceSource).not.toContain("finalizePrescriptionAction");
    expect(controllerSource).not.toContain("finalizePrescriptionAction");
    expect(panelSource).not.toContain("finalizePrescriptionAction");
    expect(controllerSource).toContain("Voice cannot Finalize, Sign, or Complete a prescription");
  });

  it("keeps Add, Save, removal, Discard, and Apply on their existing confirmation boundaries", () => {
    expect(controllerSource).toContain("rx.openAdd()");
    expect(controllerSource).not.toContain("rx.submit()");
    expect(controllerSource).toContain("rx.setConfirmingRemoval(row)");
    expect(controllerSource).not.toContain("rx.remove(row)");
    expect(panelSource).toContain("applyAutopilotProposalToDraftAction");
    expect(panelSource).toContain("proposalWithSelectedMedicines");
  });

  it("guards Apply against duplicate execution and keeps one stable key per proposal", () => {
    expect(panelSource).toContain('if (busyRef.current) return "Autopilot is already processing this request."');
    expect(panelSource).toContain('busyRef.current = "apply"');
    expect(panelSource).toContain("applyKey: applyKeyRef.current ?? (applyKeyRef.current = crypto.randomUUID())");
    expect(panelSource).toContain("result.alreadyApplied");
  });

  it("keeps Discard local and zero-write", () => {
    const discardBlock = panelSource.slice(
      panelSource.indexOf("function discard(): string"),
      panelSource.indexOf("function focusProposalMedicine"),
    );
    expect(discardBlock).toContain("setProposal(null)");
    expect(discardBlock).not.toContain("Action(");
    expect(discardBlock).not.toContain("router.refresh");
  });

  it("fails closed when prescription voice is read-only or a required surface is unavailable", () => {
    expect(controllerSource).toContain('if (readOnly) return "This prescription is approved and read-only. Nothing changed."');
    expect(controllerSource).toContain('?? "Autopilot is not available in this prescription context."');
    expect(controllerSource).toContain('if (!row) return `Medicine ${index} does not exist. Nothing changed.`');
  });
});
