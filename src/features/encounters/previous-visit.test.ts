import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { opensPreviousVisit } from "./visit-type";

/**
 * PERSIST FACTS. CARRY FORWARD STABLE HISTORY.
 * NEVER SILENTLY CARRY FORWARD FRESH CLINICAL FINDINGS.
 *
 * A returning patient's previous visit must be visible without leaving the
 * consultation — and must not leak into today's record. The two halves are one
 * rule: a value that appears by itself is, once saved, indistinguishable from
 * one somebody measured today.
 */

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const read = async (p: string) => strip(await readFile(path.resolve(p), "utf8"));

const QUERY = "src/features/encounters/previous-visit.ts";
const CARD = "src/features/encounters/components/previous-visit-card.tsx";
const FIELDS = "src/features/encounters/components/draft-fields.tsx";
const WORKSPACE = "src/features/encounters/components/consultation-workspace.tsx";

describe("which visit is shown", () => {
  it("opens itself for the visits that are ABOUT the last one", () => {
    expect(opensPreviousVisit("REPORT_REVIEW")).toBe(true);
    expect(opensPreviousVisit("FOLLOW_UP")).toBe(true);
  });

  it("stays collapsed for a new complaint, and for a walk-in with no appointment", () => {
    // Reading a new complaint through the lens of an old visit is its own error.
    expect(opensPreviousVisit("NEW")).toBe(false);
    expect(opensPreviousVisit("PROCEDURE")).toBe(false);
    expect(opensPreviousVisit("EMERGENCY")).toBe(false);
    expect(opensPreviousVisit(null)).toBe(false);
  });

  it("is the IMMEDIATELY preceding completed visit, never the first one", async () => {
    /**
     * Visit 3 shows visit 2. Pinning the first consultation would freeze the
     * context on a visit the doctor has already moved past.
     */
    const src = await read(QUERY);
    expect(src).toMatch(/\.order\("started_at", \{ ascending: false \}\)/);
    expect(src).toMatch(/\.limit\(1\)/);
  });

  it("excludes this encounter, drafts and anything not completed", async () => {
    const src = await read(QUERY);
    expect(src).toMatch(/\.eq\("status", "COMPLETED"\)/);
    expect(src).toMatch(/\.neq\("id", currentEncounterId\)/);
  });

  it("never blocks the consultation when it cannot be read", async () => {
    // Today's notes matter more than last month's context.
    const src = await read(QUERY);
    expect(src).toMatch(/if \(error\) \{[\s\S]{0,200}return null;/);
  });
});

describe("authorisation stays on the existing clinical read boundaries", () => {
  it("never takes a doctor id from anywhere — the policy/RPC supplies it", async () => {
    /**
     * `encounters_select` is `owner_doctor_id = current_doctor_id()`, and the
     * prescription history RPC resolves the current doctor internally. A
     * browser-supplied doctor id would reopen the exact trust-boundary defect
     * this project has already closed elsewhere.
     */
    const src = await read(QUERY);
    expect(src).not.toMatch(/doctorId|owner_doctor_id|ownerDoctorId/);
    expect(src).not.toMatch(/service|admin|SERVICE_ROLE/i);
  });

  it("reads the previous finalized prescription through the doctor-owned history RPC", async () => {
    /**
     * Direct authenticated SELECT on prescription tables is deliberately
     * revoked. Returning-visit context must therefore reuse the existing
     * doctor-only ownership RPC instead of widening grants or silently losing
     * the prescription.
     */
    const src = await read(QUERY);
    expect(src).toMatch(/rpc\("patient_prescription_history"/);
    expect(src).toMatch(/p_patient_id: patientId/);
    expect(src).toMatch(/row\.encounter_id === encounterId/);
    expect(src).not.toMatch(/\.from\("prescriptions"\)/);
  });

  it("prefers the current correction leaf and never reads why it was corrected", async () => {
    const src = await read(QUERY);
    expect(src).toMatch(/candidate\.superseded_by === null/);
    expect(src).toMatch(/superseded_by/);

    /**
     * That one was superseded is operational and safe to show. WHY is clinical
     * and belongs to the correction record alone.
     */
    for (const file of [QUERY, CARD]) {
      expect(await read(file), file).not.toMatch(/replacement_reason|replacementReason/);
    }
  });
});

describe("today's record stays today's", () => {
  it("the previous-visit card contains no input and no write", async () => {
    const src = await read(CARD);
    expect(src).not.toMatch(/<input|<textarea|onChange=/);
    expect(src).not.toMatch(/Action\(|useActionState|fetch\(/);
  });

  it("only height, weight and past history are ever offered", async () => {
    const src = await read(FIELDS);
    const chooser = src.slice(src.indexOf("function previousFor"));
    expect(chooser).toMatch(/vitalHeightCm/);
    expect(chooser).toMatch(/vitalWeightKg/);

    /**
     * Temperature, pulse, BP, respiratory rate and SpO2 are readings of a
     * MOMENT. Carrying one forward would document a fever that had resolved.
     */
    for (const forbidden of [
      "vitalTemperatureC",
      "vitalPulseBpm",
      "vitalSystolic",
      "vitalDiastolic",
      "vitalRespRate",
      "vitalSpo2",
    ]) {
      expect(chooser, `${forbidden} must never be carried forward`).not.toMatch(forbidden);
    }
  });

  it("no fresh clinical finding is offered — not even by an explicit press", async () => {
    const src = await read(FIELDS);
    // Past history is the ONE section offered; the rest are observations of a visit.
    expect(src).toMatch(/section\.key === "pastHistory"/);
    for (const forbidden of ["chiefComplaints", "presentIllness", "examination", "assessment"]) {
      expect(src, `${forbidden} must not be carried forward`).not.toMatch(
        new RegExp(`section\\.key === "${forbidden}"`),
      );
    }
  });

  it("carrying forward is a PRESS, never a prefill", async () => {
    /**
     * The whole safety argument. A value that appears by itself is, once saved,
     * indistinguishable from one measured today.
     */
    const src = await read(FIELDS);
    expect(src).toMatch(/Use previous/);
    expect(src).toMatch(/onUse=\{\(\) =>/);
    // Offered only into an EMPTY field: otherwise it is a one-press way to
    // overwrite what the doctor just wrote.
    expect(src).toMatch(/values\[vital\.key\] === ""/);
    expect(src).toMatch(/values\[section\.key\] === ""/);
  });

  it("the workspace decides what is carryable in exactly one place", async () => {
    const src = await read(WORKSPACE);
    const memo = src.slice(src.indexOf("const carryForward"), src.indexOf("const carryForward") + 400);
    expect(memo).toMatch(/heightCm/);
    expect(memo).toMatch(/weightKg/);
    expect(memo).toMatch(/pastHistory/);
    expect(memo).not.toMatch(/advice|assessment|examination|chiefComplaints/);
  });
});

describe("an order is not a result", () => {
  it("the card says plainly that results are not recorded", async () => {
    const src = await readFile(path.resolve(CARD), "utf8");
    expect(src).toMatch(/Investigations ordered/);
    expect(src).toMatch(/Results are not recorded in Doctor/);
  });

  it("and shows no status, value or interpretation for them", async () => {
    const src = await read(CARD);
    // Bounded to the investigations block itself: `value=` is an ordinary JSX
    // prop elsewhere in the file and matching it would prove nothing.
    const start = src.indexOf("visit.investigations.length > 0");
    const section = src.slice(start, src.indexOf("Previous advice", start));
    expect(section).not.toMatch(/normal|abnormal|pending|completed|\bresult(?!s are not)/i);
  });
});
