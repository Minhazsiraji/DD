import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  resolve(process.cwd(), "src/features/prescriptions/components/m6e-prescription-voice-panel.tsx"),
  "utf8",
);

describe("M6E authoritative target focus synchronization", () => {
  it("clears stale medicine-field DOM focus when authoritative target becomes a non-field surface", () => {
    expect(panelSource).toContain('if (targetValue.startsWith("FIELD:")) return;');
    expect(panelSource).toContain("const activeElement = document.activeElement;");
    expect(panelSource).toContain("activeElement.dataset.medicineField");
    expect(panelSource).toContain("activeElement.blur();");
  });
});
