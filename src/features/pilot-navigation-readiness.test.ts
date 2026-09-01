import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  safeConsultationReturn,
  withConsultationReturn,
} from "@/features/encounters/return-context";

const read = (p: string) => readFile(path.resolve(p), "utf8");
const CURRENT = "/consultation/8f887357-4252-4041-943e-6194edaf8b86";

describe("historical clinical navigation", () => {
  it("accepts only an exact local consultation return path", () => {
    expect(safeConsultationReturn(CURRENT)).toBe(CURRENT);
    expect(safeConsultationReturn(`https://evil.example${CURRENT}`)).toBeNull();
    expect(safeConsultationReturn(`//evil.example${CURRENT}`)).toBeNull();
    expect(safeConsultationReturn("/patients/8f887357-4252-4041-943e-6194edaf8b86")).toBeNull();
    expect(safeConsultationReturn(`${CURRENT}?x=1`)).toBeNull();
  });

  it("encodes a validated return target on historical links", () => {
    expect(withConsultationReturn("/prescription/rx", CURRENT)).toBe(
      `/prescription/rx?returnTo=${encodeURIComponent(CURRENT)}`,
    );
  });

  it("previous visit links preserve today's consultation", async () => {
    const src = await read("src/features/encounters/components/previous-visit-card.tsx");
    expect(src).toMatch(/useSearchParams/);
    expect(src).toMatch(/Open previous prescription/);
    expect(src).toMatch(/View full previous consultation/);
    expect(src).toMatch(/withConsultationReturn/);
  });

  it("completed historical consultations surface their finalized prescription", async () => {
    const page = await read("src/app/(app)/consultation/[encounterId]/page.tsx");
    const query = await read("src/features/encounters/previous-visit.ts");
    expect(query).toMatch(/getEncounterFinalizedPrescription/);
    expect(query).toMatch(/patient_prescription_history/);
    expect(page).toMatch(/Prescription from this consultation/);
    expect(page).toMatch(/Return to current consultation/);
  });

  it("historical finalized Rx can return directly to today's visit", async () => {
    const page = await read("src/app/(app)/prescription/[prescriptionId]/page.tsx");
    const final = await read("src/features/prescriptions/components/finalized-prescription.tsx");
    expect(page).toMatch(/safeConsultationReturn/);
    expect(page).toMatch(/returnTo=\{returnTo\}/);
    expect(final).toMatch(/Return to current consultation/);
  });
});

describe("pilot wording and safety inputs", () => {
  it("uses Reschedule instead of the ambiguous Move action", async () => {
    const src = await read("src/features/appointments/components/appointment-card.tsx");
    expect(src).toMatch(/>\s*Reschedule\s*</);
    expect(src).toMatch(/use Reschedule instead/);
    expect(src).not.toMatch(/>\s*Move\s*</);
  });

  it("does not allow a negative allergy phrase to become an allergy row", async () => {
    const src = await read("src/features/patients/safety-actions.ts");
    expect(src).toMatch(/NO_KNOWN_ALLERGY/);
    expect(src).toMatch(/no known drug allerg/);
    expect(src).toMatch(/nkda/);
    expect(src).toMatch(/leave the allergy list empty/);
  });
});
