/**
 * Suggestions are text-entry accelerators only. Nothing here saves, diagnoses,
 * structures or asserts a fact. The doctor must explicitly choose one and the
 * ordinary encounter autosave path then treats it like any other typed text.
 */
export const COMMON_COMPLAINT_SUGGESTIONS = [
  "Fever",
  "Cough",
  "Pain",
  "Shortness of breath",
  "Vomiting",
  "Loose stool",
] as const;

export const COMMON_SYMPTOM_SUGGESTIONS = [
  "Fever",
  "Cough",
  "Headache",
  "Weakness",
  "Nausea",
  "Dizziness",
] as const;

export function appendTextSuggestion(current: string, suggestion: string): string {
  const next = suggestion.trim();
  if (next === "") return current;

  const base = current.trim();
  if (base === "") return next;

  const existing = base
    .split(/[;\n]+/)
    .map((part) => part.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (existing.includes(next.toLocaleLowerCase())) return current;

  return `${base}; ${next}`;
}

export function uniqueSuggestions(values: readonly (string | null | undefined)[], limit = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw?.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}
