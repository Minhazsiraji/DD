import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("M6D consultation card and sticky navigation contract", () => {
  const workspace = () => read("src/features/encounters/components/consultation-workspace.tsx");
  const identity = () => read("src/features/encounters/components/consultation-identity.tsx");
  const voice = () => read("src/features/encounters/components/m6a-voice-panel.tsx");

  it("uses the shared Vitals card family for the consultation identity and Voice Assistant", () => {
    expect(identity()).toContain('consultationCard ? SectionCard : "div"');
    expect(workspace()).toContain("consultationCard");
    expect(voice()).toContain("<SectionCard data-m6d-voice-assistant");
  });

  it("keeps the Voice Assistant sticky and derives section clearance from its measured height", () => {
    const source = voice();
    expect(source).toContain('className="sticky top-2');
    expect(source).toContain("getBoundingClientRect().height");
    expect(source).toContain('--m6d-voice-sticky-offset');
    expect(source).toContain("ResizeObserver");
  });

  it("uses direct non-animated start alignment for note, diagnosis and investigation navigation", () => {
    const source = voice();
    expect(source).toContain('scrollIntoView({ behavior: "instant", block: "start" })');
    expect(source).not.toContain('scrollIntoView({ behavior: "smooth"');
    expect(workspace()).toContain('scrollIntoView({ behavior: "instant", block: "start" })');
  });

  it("marks every Guided Voice destination with the shared measured scroll margin", () => {
    const notes = read("src/features/encounters/components/m2-clinical-notes.tsx");
    const followUp = read("src/features/encounters/components/next-visit-fields.tsx");
    expect(notes).toContain("data-m6d-section");
    expect(notes).toContain('scrollMarginTop: "var(--m6d-voice-sticky-offset)"');
    expect(followUp).toContain('id="nextVisitNote"');
    expect(followUp).toContain("data-m6d-section");
    expect(workspace().match(/data-m6d-section/g)).toHaveLength(2);
  });

  it("keeps a bounded, non-overflowing compact assistant on narrow screens", () => {
    const source = voice();
    expect(source).toContain("max-h-[42vh]");
    expect(source).toContain("overflow-y-auto");
    expect(source).toContain("max-w-full");
    expect(source).toContain("Voice settings");
    expect(source).not.toMatch(/w-\[(?:[4-9]\d\d|\d{4,})px\]/);
  });
});
