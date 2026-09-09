import { describe, expect, it } from "vitest";
import type { PrescriptionMedicineProposal } from "./contracts";
import {
  canonicalizeExplicitMedicineMention,
  groundProviderProposal,
} from "./proposal-grounding";

function rx(
  medicine: PrescriptionMedicineProposal["medicine"],
): PrescriptionMedicineProposal {
  return {
    kind: "PRESCRIPTION_MEDICINE",
    medicine,
    uncertainties: [],
    requires_review: true,
  };
}

function groundedRx(
  source: string,
  medicine: PrescriptionMedicineProposal["medicine"],
): PrescriptionMedicineProposal {
  const proposal = groundProviderProposal(source, rx(medicine));
  if (proposal.kind !== "PRESCRIPTION_MEDICINE") {
    throw new Error("wrong proposal kind");
  }
  return proposal;
}

describe("PA1 explicit medicine-mention span fidelity", () => {
  it("reconstructs Syp. Ace only from an adjacent authored prefix span", () => {
    const proposal = groundedRx("Syp. Ace 120 mg/5 ml, 5 ml TDS.", {
      display_name: "Ace",
      dosage_form: "Syp.",
      strength_text: "120 mg/5 ml",
    });
    expect(proposal.medicine.display_name).toBe("Syp. Ace");
  });

  it("reconstructs Cap. Seclo only from an adjacent authored prefix span", () => {
    const proposal = groundedRx("Cap. Seclo 20 mg OD.", {
      display_name: "Seclo",
      dosage_form: "Cap.",
      strength_text: "20 mg",
    });
    expect(proposal.medicine.display_name).toBe("Cap. Seclo");
  });

  it("reconstructs Tab. Metformin only from an adjacent authored prefix span", () => {
    const proposal = groundedRx("Tab. Metformin 500 mg, 1 tab BD.", {
      display_name: "Metformin",
      dosage_form: "Tab.",
      strength_text: "500 mg",
    });
    expect(proposal.medicine.display_name).toBe("Tab. Metformin");
  });

  it("reconstructs an adjacent authored dosage-form suffix", () => {
    const proposal = groundedRx("Salbutamol syrup 2 mg per 5 ml, give 5 ml TDS.", {
      display_name: "Salbutamol",
      dosage_form: "syrup",
      strength_text: "2 mg per 5 ml",
    });
    expect(proposal.medicine.display_name).toBe("Salbutamol syrup");
  });

  it("does not merge a later tablet dose word into Napa", () => {
    const proposal = groundedRx("Napa 500 mg, one tablet BD.", {
      display_name: "Napa",
      dosage_form: "tablet",
      strength_text: "500 mg",
      dose_text: "one tablet",
    });
    expect(proposal.medicine.display_name).toBe("Napa");
  });

  it("does not merge a later capsule dose word into Amoxicillin", () => {
    const proposal = groundedRx("Amoxicillin 500 mg, one capsule TDS.", {
      display_name: "Amoxicillin",
      dosage_form: "capsule",
      strength_text: "500 mg",
      dose_text: "one capsule",
    });
    expect(proposal.medicine.display_name).toBe("Amoxicillin");
  });

  it("preserves the duplicate-strength cleanup before adjacency reconstruction", () => {
    const proposal = groundedRx("Napa 500 mg, one tablet BD.", {
      display_name: "Napa 500 mg",
      dosage_form: "tablet",
      strength_text: "500 mg",
    });
    expect(proposal.medicine.display_name).toBe("Napa");
  });

  it("never merges a dosage form that is present but nonadjacent elsewhere", () => {
    const proposal = groundedRx(
      "Tablet stock reviewed. Napa 500 mg, one dose BD.",
      {
        display_name: "Napa",
        dosage_form: "Tablet",
        strength_text: "500 mg",
      },
    );
    expect(proposal.medicine.display_name).toBe("Napa");
  });

  it("preserves the exact authored span wording when provider casing differs", () => {
    expect(
      canonicalizeExplicitMedicineMention(
        "ace",
        "syp.",
        "Syp. Ace 120 mg/5 ml, 5 ml TDS.",
      ),
    ).toBe("Syp. Ace");
  });

  it("keeps proposal kind and Doctor-review requirement unchanged", () => {
    const proposal = groundedRx("Cap. Seclo 20 mg OD.", {
      display_name: "Seclo",
      dosage_form: "Cap.",
      strength_text: "20 mg",
    });
    expect(proposal.kind).toBe("PRESCRIPTION_MEDICINE");
    expect(proposal.requires_review).toBe(true);
  });

  it("does not introduce unsupported clinical fields while reconstructing the name", () => {
    const proposal = groundedRx("Syp. Ace 120 mg/5 ml, 5 ml TDS.", {
      display_name: "Ace",
      dosage_form: "Syp.",
      strength_text: "120 mg/5 ml",
      dose_text: "5 ml",
      schedule_text: "TDS",
      generic_name: "Paracetamol",
      route: "oral",
      quantity_text: "100 ml",
      instructions: "shake well",
      is_prn: false,
      substitution_allowed: false,
    });

    expect(proposal.medicine.display_name).toBe("Syp. Ace");
    expect(proposal.medicine.generic_name).toBeNull();
    expect(proposal.medicine.route).toBeNull();
    expect(proposal.medicine.quantity_text).toBeNull();
    expect(proposal.medicine.instructions).toBeNull();
    expect(proposal.medicine.is_prn).toBeNull();
    expect(proposal.medicine.substitution_allowed).toBeNull();
  });
});
