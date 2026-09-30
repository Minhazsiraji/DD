import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { M6F_VOICE_GUIDE } from "./m6f-voice-guide";
import { parseM6DLocalCommand } from "./m6d-intent-router";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("Doctor Voice Guide presentation authority", () => {
  it("uses the live M6F inventory and derives the displayed count", () => {
    expect(M6F_VOICE_GUIDE.metrics.targets).toBe(M6F_VOICE_GUIDE.entries.length);
    expect(M6F_VOICE_GUIDE.metrics.unsupported).toBe(0);
    const page = read("src/app/(app)/voice-guide/page.tsx");
    expect(page).toContain("M6F_VOICE_GUIDE.metrics.targets");
    expect(page).not.toMatch(/\b68 supported/);
  });

  it("publishes only runtime-certified or explicitly contextual surfaces", () => {
    expect(M6F_VOICE_GUIDE.certification).toHaveLength(M6F_VOICE_GUIDE.entries.length);
    expect(M6F_VOICE_GUIDE.certificationTotals.total).toBe(M6F_VOICE_GUIDE.entries.length);
    expect(M6F_VOICE_GUIDE.certificationTotals.failed).toBe(0);
    expect(M6F_VOICE_GUIDE.certificationTotals.unsupported).toBe(0);
    expect(M6F_VOICE_GUIDE.certificationTotals.verified + M6F_VOICE_GUIDE.certificationTotals.contextual)
      .toBe(M6F_VOICE_GUIDE.entries.length);
  });

  it("represents every consultation and prescription source inventory entry", () => {
    expect(M6F_VOICE_GUIDE.entries.some((entry) => entry.page === "consultation")).toBe(true);
    expect(M6F_VOICE_GUIDE.entries.some((entry) => entry.page === "prescription")).toBe(true);
    expect(new Set(M6F_VOICE_GUIDE.entries.map((entry) => entry.canonicalId)).size).toBe(
      M6F_VOICE_GUIDE.entries.length,
    );
  });

  it("keeps catalogue-backed current-target control examples executable", () => {
    const expected = {
      clear: "NOTE_EDIT",
      undo: "UNDO",
      "remove-last": "REMOVE_LAST_SENTENCE",
      read: "NOTE_EDIT",
      next: "NEXT",
      previous: "PREVIOUS",
    } as const;
    for (const control of M6F_VOICE_GUIDE.controls) {
      if (control.id === "replace") {
        for (const example of Object.values(control.examples)) {
          expect(parseM6DLocalCommand(example)).toMatchObject({ type: "NOTE_EDIT", operation: "REPLACE" });
        }
        continue;
      }
      for (const example of Object.values(control.examples)) {
        expect(parseM6DLocalCommand(example).type).toBe(expected[control.id as keyof typeof expected]);
      }
    }
  });

  it("documents every protected doctor-control boundary", () => {
    const text = M6F_VOICE_GUIDE.safety.map((item) => `${item.title} ${item.description}`).join(" ");
    expect(text).toMatch(/Vitals stay contextual/);
    expect(text).toMatch(/Confirm investigations/);
    expect(text).toMatch(/Add medicine or Save changes/);
    expect(text).toMatch(/Apply selected/);
    expect(text).toMatch(/cannot Finalize, Sign, Complete or Finish/);
  });

  it("keeps every target compact but expandable to all runtime phrases", () => {
    const component = read("src/features/dictation/components/doctor-voice-guide.tsx");
    expect(component).toContain("aria-expanded={expanded}");
    expect(component).toContain("All phrases");
    expect(component).toContain("examples.map((phrase)");
  });

  it("requires no provider endpoint or patient data", () => {
    const page = read("src/app/(app)/voice-guide/page.tsx");
    const component = read("src/features/dictation/components/doctor-voice-guide.tsx");
    expect(page + component).not.toMatch(/fetch\(|\/api\/voice|patient_name|patient_number|phone_e164/i);
  });
});
