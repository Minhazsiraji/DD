import { describe, expect, it } from "vitest";
import { NEXT_VISIT_DATE, SECTIONS, TEXT_KEYS, VITALS } from "@/features/encounters/schema";
import { MEDICINE_FIELDS } from "@/features/prescriptions/schema";
import { M6F_DISCOVERED_GAPS, M6F_EDITABLE_SOURCE_KEYS, M6F_INVENTORY_METRICS, M6F_VOICE_SURFACE_INVENTORY } from "./m6f-voice-surface-inventory";

describe("M6F source/UI voice target parity", () => {
  it("covers every schema-backed consultation and medicine field", () => {
    const keys = new Set(M6F_VOICE_SURFACE_INVENTORY.map((entry) => entry.sourceKey));
    for (const key of [...TEXT_KEYS, ...SECTIONS.map((field) => field.key), ...VITALS.map((field) => field.key), ...MEDICINE_FIELDS.map((field) => field.key), NEXT_VISIT_DATE]) {
      expect(keys.has(key), key).toBe(true);
    }
    for (const key of M6F_EDITABLE_SOURCE_KEYS) expect(keys.has(key), key).toBe(true);
  });

  it("has no unsupported editable target and no language/alias pending entry", () => {
    expect(M6F_DISCOVERED_GAPS).toEqual([]);
    for (const entry of M6F_VOICE_SURFACE_INVENTORY) {
      expect(entry.aliasesEnglish.length, `${entry.canonicalId} English`).toBeGreaterThan(0);
      expect(entry.aliasesBangla.length, `${entry.canonicalId} Bangla`).toBeGreaterThan(0);
      expect(entry.aliasesBanglish.length, `${entry.canonicalId} Banglish`).toBeGreaterThan(0);
    }
    expect(M6F_INVENTORY_METRICS.targets).toBe(M6F_VOICE_SURFACE_INVENTORY.length);
    expect(new Set(M6F_VOICE_SURFACE_INVENTORY.map((entry) => entry.canonicalId)).size).toBe(M6F_VOICE_SURFACE_INVENTORY.length);
  });

  it("records every protected clinical boundary", () => {
    const protectedEntries = M6F_VOICE_SURFACE_INVENTORY.filter((entry) => entry.existingProtectedAction);
    expect(protectedEntries.some((entry) => entry.existingProtectedAction?.includes("Add medicine"))).toBe(true);
    expect(protectedEntries.some((entry) => entry.existingProtectedAction?.includes("Confirm investigations"))).toBe(true);
    expect(protectedEntries.some((entry) => entry.existingProtectedAction?.includes("finalization prohibited"))).toBe(true);
  });
});
