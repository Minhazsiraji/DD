import { describe, expect, it } from "vitest";
import type {
  AiProposalPayload,
  PrescriptionMedicineProposal,
} from "./contracts";
import { createHmacProposalIntegrity } from "./integrity";
import { createClinicalProposal } from "./orchestrator";
import {
  canonicalizeDurationText,
  explicitPrnEvidence,
  explicitSubstitutionEvidence,
  groundProviderProposal,
  isSourceGroundedText,
  ProposalGroundingError,
} from "./proposal-grounding";
import type { ClinicalProposalParser } from "./providers";

function rx(medicine: PrescriptionMedicineProposal["medicine"]): PrescriptionMedicineProposal {
  return {
    kind: "PRESCRIPTION_MEDICINE",
    medicine,
    uncertainties: [],
    requires_review: true,
  };
}

function groundedRx(source: string, medicine: PrescriptionMedicineProposal["medicine"]): PrescriptionMedicineProposal {
  const proposal = groundProviderProposal(source, rx(medicine));
  if (proposal.kind !== "PRESCRIPTION_MEDICINE") throw new Error("wrong proposal kind");
  return proposal;
}

const binding = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  doctorProfileId: "22222222-2222-4222-8222-222222222222",
  practiceLocationId: "33333333-3333-4333-8333-333333333333",
  patientId: "44444444-4444-4444-8444-444444444444",
  clinicalRecordId: "55555555-5555-4555-8555-555555555555",
  expectedVersion: 1,
};

const integrity = createHmacProposalIntegrity(
  "pa1-grounding-test-signing-secret-32-bytes-minimum-2026",
);

describe("PA1 deterministic source grounding", () => {
  it("removes duplicated strength suffix from display_name", () => {
    const proposal = groundedRx("Napa 500 mg, one tablet BD.", {
      display_name: "Napa 500 mg",
      strength_text: "500 mg",
    });
    expect(proposal.medicine.display_name).toBe("Napa");
    expect(proposal.medicine.strength_text).toBe("500 mg");
  });

  it("preserves legitimate dosage-form wording in the authored medicine name", () => {
    const proposal = groundedRx("Salbutamol syrup 2 mg per 5 ml, give 5 ml TDS.", {
      display_name: "Salbutamol syrup",
      strength_text: "2 mg per 5 ml",
      dosage_form: "syrup",
    });
    expect(proposal.medicine.display_name).toBe("Salbutamol syrup");
    expect(proposal.medicine.dosage_form).toBe("syrup");
  });

  it("removes only the permitted leading English duration connector", () => {
    expect(canonicalizeDurationText("for 5 days")).toBe("5 days");
    const proposal = groundedRx("Napa for 5 days.", { display_name: "Napa", duration_text: "for 5 days" });
    expect(proposal.medicine.duration_text).toBe("5 days");
  });

  it("preserves an already canonical grounded duration", () => {
    const proposal = groundedRx("Seclo for 14 days.", { display_name: "Seclo", duration_text: "14 days" });
    expect(proposal.medicine.duration_text).toBe("14 days");
  });

  it("removes an unspoken inferred generic name", () => {
    const proposal = groundedRx("Napa 500 mg.", {
      display_name: "Napa",
      generic_name: "Paracetamol",
      strength_text: "500 mg",
    });
    expect(proposal.medicine.generic_name).toBeNull();
  });

  it("removes an unspoken inferred route", () => {
    const proposal = groundedRx("Napa 500 mg, one tablet.", {
      display_name: "Napa",
      route: "oral",
    });
    expect(proposal.medicine.route).toBeNull();
  });

  it("turns is_prn false into null when no PRN cue is explicit", () => {
    const proposal = groundedRx("Napa 500 mg, one tablet BD.", {
      display_name: "Napa",
      is_prn: false,
    });
    expect(explicitPrnEvidence("Napa 500 mg, one tablet BD.")).toBe("NONE");
    expect(proposal.medicine.is_prn).toBeNull();
  });

  it("keeps is_prn true for explicit PRN evidence", () => {
    const proposal = groundedRx("Napa 500 mg PRN.", { display_name: "Napa", is_prn: true });
    expect(explicitPrnEvidence("Napa 500 mg PRN.")).toBe("POSITIVE");
    expect(proposal.medicine.is_prn).toBe(true);
  });

  it("keeps is_prn true for explicit Bangla প্রয়োজন cue", () => {
    const proposal = groundedRx("নাপা ৫০০ মিলিগ্রাম প্রয়োজনে।", {
      display_name: "নাপা",
      is_prn: true,
    });
    expect(explicitPrnEvidence("নাপা ৫০০ মিলিগ্রাম প্রয়োজনে।")).toBe("POSITIVE");
    expect(proposal.medicine.is_prn).toBe(true);
  });

  it("keeps is_prn false only for explicit negative PRN evidence", () => {
    const proposal = groundedRx("Napa 500 mg, not PRN.", { display_name: "Napa", is_prn: false });
    expect(explicitPrnEvidence("Napa 500 mg, not PRN.")).toBe("NEGATIVE");
    expect(proposal.medicine.is_prn).toBe(false);
  });

  it("removes substitution boolean without explicit evidence", () => {
    const proposal = groundedRx("Napa 500 mg.", {
      display_name: "Napa",
      substitution_allowed: true,
    });
    expect(explicitSubstitutionEvidence("Napa 500 mg.")).toBe("NONE");
    expect(proposal.medicine.substitution_allowed).toBeNull();
  });

  it("keeps grounded investigation names", () => {
    const proposal: AiProposalPayload = {
      kind: "INVESTIGATION_LIST",
      investigations: [{ name: "CBC" }, { name: "Serum TSH" }],
      uncertainties: [],
      requires_review: true,
    };
    const grounded = groundProviderProposal("Please do CBC and Serum TSH.", proposal);
    expect(grounded.kind).toBe("INVESTIGATION_LIST");
    if (grounded.kind !== "INVESTIGATION_LIST") throw new Error("wrong kind");
    expect(grounded.investigations.map((row) => row.name)).toEqual(["CBC", "Serum TSH"]);
  });

  it("removes an ungrounded extra investigation and ungrounded notes", () => {
    const proposal: AiProposalPayload = {
      kind: "INVESTIGATION_LIST",
      investigations: [
        { name: "CBC", note: "fasting required" },
        { name: "MRI brain" },
      ],
      uncertainties: [],
      requires_review: true,
    };
    const grounded = groundProviderProposal("Please do CBC only.", proposal);
    if (grounded.kind !== "INVESTIGATION_LIST") throw new Error("wrong kind");
    expect(grounded.investigations).toEqual([{ name: "CBC", note: null }]);
  });

  it("fails closed when no returned investigation is source-grounded", () => {
    const proposal: AiProposalPayload = {
      kind: "INVESTIGATION_LIST",
      investigations: [{ name: "MRI brain" }],
      uncertainties: [],
      requires_review: true,
    };
    expect(() => groundProviderProposal("Please do CBC only.", proposal)).toThrow(
      new ProposalGroundingError("AI_GROUNDING_NO_EXPLICIT_INVESTIGATIONS"),
    );
  });

  it("never changes proposal kind or Doctor-review semantics", () => {
    const prescription = groundedRx("Napa 500 mg.", { display_name: "Napa", strength_text: "500 mg" });
    expect(prescription.kind).toBe("PRESCRIPTION_MEDICINE");
    expect(prescription.requires_review).toBe(true);

    const navigation: AiProposalPayload = {
      kind: "NAVIGATION_COMMAND",
      command: "OPEN_PATIENT_SEARCH",
      requires_review: false,
    };
    expect(groundProviderProposal("open patient search", navigation)).toEqual(navigation);
  });

  it("uses grounding in the real orchestrator before exposing the final DD proposal", async () => {
    const rawProposal = {
      kind: "PRESCRIPTION_MEDICINE",
      medicine: {
        display_name: "Napa 500 mg",
        brand_name: null,
        generic_name: "Paracetamol",
        strength_text: "500 mg",
        dose_text: "one tablet",
        dosage_form: "tablet",
        route: "oral",
        schedule_text: "BD",
        duration_text: "for 5 days",
        quantity_text: null,
        food_relation: "after food",
        is_prn: false,
        instructions: null,
        substitution_allowed: false,
      },
      uncertainties: [],
      requires_review: true,
    } as const;

    const parser: ClinicalProposalParser = {
      async parse() {
        return {
          rawProposal,
          provider: { provider: "mock", model: "grounding-order" },
          usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsdMicros: 0 },
        };
      },
    };

    const result = await createClinicalProposal(
      {
        operationId: "op-grounding-order",
        taskType: "PRESCRIPTION_MEDICINE",
        binding,
        text: "Napa 500 mg, one tablet BD after food for 5 days.",
      },
      {
        parser,
        integrity,
        now: () => new Date("2026-09-09T06:00:00Z"),
      },
    );

    expect(result.envelope.proposal.kind).toBe("PRESCRIPTION_MEDICINE");
    if (result.envelope.proposal.kind !== "PRESCRIPTION_MEDICINE") throw new Error("wrong kind");
    expect(result.envelope.proposal.medicine).toMatchObject({
      display_name: "Napa",
      generic_name: null,
      strength_text: "500 mg",
      dose_text: "one tablet",
      dosage_form: "tablet",
      route: null,
      schedule_text: "BD",
      duration_text: "5 days",
      food_relation: "after food",
      is_prn: null,
      substitution_allowed: null,
    });
    expect(result.envelope.proposal.requires_review).toBe(true);
    expect(isSourceGroundedText("Napa", "Napa 500 mg")).toBe(true);
  });
});
