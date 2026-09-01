import { describe, it, expect } from "vitest";
import { deriveSetupProgress, type SetupSnapshot, type ChamberSnapshot } from "./progress";

/**
 * The checklist is only worth having if it cannot lie. These tests are all
 * variations on one question: does a tick correspond to something that is
 * actually true of the account?
 */

const chamber = (over: Partial<ChamberSnapshot> = {}): ChamberSnapshot => ({
  id: "c1",
  name: "Green Life Chamber",
  hasSchedule: true,
  bookingEnabled: true,
  hasFee: true,
  ...over,
});

const blank: SetupSnapshot = {
  profileExists: true,
  fullName: "Dr Ayesha Rahman",
  qualification: null,
  specialization: null,
  designation: null,
  hasPhoto: false,
  visibility: "PRIVATE",
  slug: null,
  chambers: [],
  placeCount: 0,
  hasPatients: false,
  hasCompletedConsultation: false,
};

const complete: SetupSnapshot = {
  ...blank,
  qualification: "MBBS, FCPS",
  specialization: "Cardiology",
  hasPhoto: true,
  visibility: "PUBLIC",
  slug: "ayesha-rahman",
  chambers: [chamber(), chamber({ id: "c2", name: "City Hospital" })],
  placeCount: 2,
  hasPatients: true,
  hasCompletedConsultation: true,
};

const step = (s: SetupSnapshot, key: string) => {
  const found = deriveSetupProgress(s).steps.find((x) => x.key === key);
  if (!found) throw new Error(`no step ${key}`);
  return found;
};

describe("progress is derived from real state", () => {
  it("marks nothing done on a fresh account beyond the profile itself", () => {
    const progress = deriveSetupProgress(blank);
    expect(progress.doneCount).toBe(1);
    expect(step(blank, "profile").state).toBe("DONE");
  });

  it("marks everything done when everything is true", () => {
    const progress = deriveSetupProgress(complete);
    expect(progress.doneCount).toBe(progress.total);
    expect(progress.percent).toBe(100);
    expect(progress.nextStep).toBeNull();
  });

  it("counts a step done only while its evidence holds", () => {
    expect(step(complete, "booking").state).toBe("DONE");
    const off = { ...complete, chambers: complete.chambers!.map((c) => ({ ...c, bookingEnabled: false })) };
    expect(step(off, "booking").state).toBe("TODO");
  });

  it("reports PARTIAL when some chambers are configured and some are not", () => {
    const mixed: SetupSnapshot = {
      ...complete,
      chambers: [chamber(), chamber({ id: "c2", bookingEnabled: false, hasFee: false })],
    };
    expect(step(mixed, "booking").state).toBe("PARTIAL");
    expect(step(mixed, "booking").evidence).toBe("1 of 2 chambers");
    expect(step(mixed, "fee").state).toBe("PARTIAL");
  });

  it("treats a zero fee as a fee, because free is a decision", () => {
    // hasFee is the caller's answer; the point is that the derivation trusts
    // "a fee was set" and never re-reads the amount to second-guess it.
    const free: SetupSnapshot = { ...complete, chambers: [chamber({ hasFee: true })] };
    expect(step(free, "fee").state).toBe("DONE");
  });
});

describe("a failed read is never reported as work not done", () => {
  it("marks chamber-derived steps UNKNOWN when chambers could not be loaded", () => {
    const unread: SetupSnapshot = { ...complete, chambers: null };
    for (const key of ["chambers", "schedule", "fee", "booking"]) {
      expect(step(unread, key).state, key).toBe("UNKNOWN");
    }
    expect(deriveSetupProgress(unread).incomplete).toBe(true);
  });

  it("marks the patient and consultation steps UNKNOWN rather than TODO", () => {
    const unread: SetupSnapshot = {
      ...complete,
      hasPatients: null,
      hasCompletedConsultation: null,
      hasPhoto: null,
    };
    expect(step(unread, "first-patient").state).toBe("UNKNOWN");
    expect(step(unread, "first-consultation").state).toBe("UNKNOWN");
    expect(step(unread, "photo").state).toBe("UNKNOWN");
  });

  it("never points 'continue setup' at a step it could not read", () => {
    const unread: SetupSnapshot = { ...complete, chambers: null };
    const next = deriveSetupProgress(unread).nextStep;
    expect(next).toBeNull();
  });

  it("does not count an UNKNOWN step as done", () => {
    const unread: SetupSnapshot = { ...complete, hasPatients: null };
    const progress = deriveSetupProgress(unread);
    expect(progress.doneCount).toBe(progress.total - 1);
  });
});

describe("public profile readiness is stated precisely", () => {
  it("is TODO while private", () => {
    expect(step(blank, "visibility").state).toBe("TODO");
    expect(step(blank, "visibility").evidence).toContain("Private");
  });

  it("is PARTIAL when public with no link, because nobody can open it", () => {
    const noSlug: SetupSnapshot = { ...complete, slug: null };
    expect(step(noSlug, "visibility").state).toBe("PARTIAL");
  });

  it("is DONE only with a slug", () => {
    expect(step(complete, "visibility").state).toBe("DONE");
  });
});

describe("a place is not yet a chamber", () => {
  it("reports PARTIAL when the doctor joined a location but described none", () => {
    const joined: SetupSnapshot = { ...blank, chambers: [], placeCount: 1 };
    expect(step(joined, "chambers").state).toBe("PARTIAL");
    expect(step(joined, "chambers").evidence).toContain("not described");
  });

  it("reports TODO when there is genuinely nothing", () => {
    expect(step(blank, "chambers").state).toBe("TODO");
  });
});

describe("the checklist carries no clinical information", () => {
  it("exposes existence only — never a patient, a date or a diagnosis", () => {
    const keys = Object.keys(complete);
    for (const key of keys) {
      expect(key, `snapshot field ${key} sounds clinical`).not.toMatch(
        /patientName|patientId|diagnos|prescription|encounterId|complaint/i,
      );
    }
    // The two clinical-adjacent fields are booleans, and nothing else.
    expect(typeof complete.hasPatients).toBe("boolean");
    expect(typeof complete.hasCompletedConsultation).toBe("boolean");
  });

  it("puts no clinical word in any rendered string", () => {
    const rendered = deriveSetupProgress(complete)
      .steps.flatMap((s) => [s.title, s.help, s.evidence ?? ""])
      .join(" ");
    expect(rendered).not.toMatch(/diagnos|prescription|medicine|allerg/i);
  });
});
