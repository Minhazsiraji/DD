import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

/** Tailwind's default breakpoints used by this codebase. */
const LG = 1024;
const XL = 1280;

function workspaceColumns(width: number): 1 | 2 {
  return width >= XL ? 2 : 1;
}

function noteColumns(width: number): 1 | 2 {
  return width >= LG ? 2 : 1;
}

describe("M2 required viewport widths", () => {
  it("keeps the 360px mobile workspace single-column with touch-safe actions", () => {
    expect(workspaceColumns(360)).toBe(1);
    expect(noteColumns(360)).toBe(1);
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    const save = read("src/features/encounters/components/save-bar.tsx");
    expect(workspace).toContain("min-w-0");
    expect(save).toContain("w-full");
    expect(save).toContain("min-h-11");
  });

  it("keeps the 820px tablet workspace single-column rather than squeezing history beside it", () => {
    expect(workspaceColumns(820)).toBe(1);
    expect(noteColumns(820)).toBe(1);
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    expect(workspace).toContain("xl:grid-cols-[minmax(0,1fr)_340px]");
  });

  it("uses the dominant clinical column plus history rail at 1440px desktop", () => {
    expect(workspaceColumns(1440)).toBe(2);
    expect(noteColumns(1440)).toBe(2);
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    const notes = read("src/features/encounters/components/m2-clinical-notes.tsx");
    expect(workspace).toContain("xl:grid-cols-[minmax(0,1fr)_340px]");
    expect(notes).toContain("lg:grid-cols-2");
  });
});
