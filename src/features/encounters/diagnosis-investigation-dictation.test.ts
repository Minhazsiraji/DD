import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("Diagnosis and Investigation local dictation", () => {
  it("keeps Diagnosis dictation draft-only", () => {
    const source = read("src/features/encounters/components/finding-form.tsx");
    expect(source).toContain('fieldLabel="Diagnosis"');
    expect(source).toContain('onInsert={(next) => onChange({ ...value, title: next })}');
    expect(source).toContain('submitLabel');
  });

  it("keeps Investigation dictation in the editable search/staging surface", () => {
    const source = read("src/features/encounters/components/investigation-panel.tsx");
    expect(source).toContain('fieldLabel="Investigation order"');
    expect(source).toContain('onInsert={(next) => updateSearchText(next)}');
    expect(source).toContain('Staged for confirmation');
    expect(source).toContain('confirmationButtonLabel(staged.length)');
  });
});
