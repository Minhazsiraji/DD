import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PRESCRIPTION_DICTATION_FIELDS } from "./prescription-dictation";

async function source(file: string) {
  return readFile(path.resolve(file), "utf8");
}

function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("prescription dictation covers the intended editable draft fields", () => {
  it("covers medicine, identity, dose/schedule and patient instruction drafts", () => {
    expect(PRESCRIPTION_DICTATION_FIELDS).toEqual([
      "displayName",
      "brandName",
      "genericName",
      "strengthText",
      "doseText",
      "scheduleText",
      "durationText",
      "quantityText",
      "instructions",
    ]);
  });

  it("does not add voice to form, route or food relation accelerators in this MVP", () => {
    expect(PRESCRIPTION_DICTATION_FIELDS).not.toContain("dosageForm");
    expect(PRESCRIPTION_DICTATION_FIELDS).not.toContain("route");
    expect(PRESCRIPTION_DICTATION_FIELDS).not.toContain("foodRelation");
  });

  it("renders the shared Dictate control only from configured free-text fields", async () => {
    const form = await source("src/features/prescriptions/components/medicine-form.tsx");
    expect(form).toMatch(/medicineFieldSupportsDictation\(field\.key\)/);
    expect(form).toMatch(/<DictateButton/);
    expect(form).toMatch(/value=\{value\[field\.key\]\}/);
  });

  it("preserves caret/insertion behavior instead of replacing existing text", async () => {
    const form = await source("src/features/prescriptions/components/medicine-form.tsx");
    expect(form).toMatch(/onSelect=/);
    expect(form).toMatch(/caretAt=\{carets\[field\.key\]\}/);
    expect(form).toMatch(/setCarets/);
    expect(form).toMatch(/set\(field\.key, next\)/);
  });
});

describe("prescription voice is draft assistance, never prescription authority", () => {
  it("voice insertion only calls the existing local draft onChange path", async () => {
    const form = codeOnly(await source("src/features/prescriptions/components/medicine-form.tsx"));
    expect(form).toMatch(/onInsert=\{\(next, caret\) => \{[\s\S]*set\(field\.key, next\)/);
    expect(form).not.toMatch(/onInsert=\{[\s\S]{0,300}onSubmit\(/);
  });

  it("still requires explicit Add/Save submit", async () => {
    const form = codeOnly(await source("src/features/prescriptions/components/medicine-form.tsx"));
    expect(form).toMatch(/type="submit"/);
    expect(form).toMatch(/if \(canSubmit\) onSubmit\(\)/);
    expect(form).toMatch(/submitLabel/);
  });

  it("does not import prescription actions, finalization or server write authority", async () => {
    for (const file of [
      "src/features/prescriptions/prescription-dictation.ts",
      "src/features/prescriptions/components/medicine-form.tsx",
      "src/features/dictation/provider.ts",
      "src/features/dictation/use-dictation.ts",
      "src/features/dictation/components/dictate-button.tsx",
    ]) {
      const src = codeOnly(await source(file));
      for (const forbidden of [
        /from\s+["'][^"']*actions["']/,
        /\bfinalize\w*\s*\(/i,
        /\bapprove\w*\s*\(/i,
        /\bfinish\w*consultation\w*\s*\(/i,
      ]) {
        expect(forbidden.test(src), `${file}: ${forbidden}`).toBe(false);
      }
    }
  });

  it("keeps normal prescription validation and trusted review/finalize separate", async () => {
    const form = await source("src/features/prescriptions/components/medicine-form.tsx");
    const composer = await source("src/features/prescriptions/components/prescription-composer.tsx");
    expect(form).toMatch(/canSubmit = value\.displayName\.trim\(\) !== ""/);
    expect(composer).toMatch(/Review prescription/);
    expect(composer).not.toMatch(/DictateButton/);
  });
});
