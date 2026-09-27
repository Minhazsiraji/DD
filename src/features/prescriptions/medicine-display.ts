import type { MedicineDraft } from "./schema";

function normalized(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function trailingStrengthPattern(strengthText: string): RegExp | null {
  const tokens = strengthText.normalize("NFC").trim().split(/\s+/gu).filter(Boolean);
  if (tokens.length === 0) return null;
  return new RegExp(`\\s+${tokens.map(escapeRegExp).join("\\s+")}$`, "iu");
}

/** Exact normalized suffix equivalence only; no fuzzy dose or number removal. */
export function hasExactTrailingStrength(
  displayName: string | null | undefined,
  strengthText: string | null | undefined,
): boolean {
  const name = normalized(displayName);
  const strength = normalized(strengthText);
  if (!name || !strength) return false;
  if (name === strength) return true;
  return name.endsWith(` ${strength}`);
}

/** Presentation-only compatibility for historical rows that already repeat strength. */
export function medicineDisplayWithStrength(
  displayName: string | null | undefined,
  strengthText: string | null | undefined,
): string {
  const name = (displayName ?? "").trim();
  const strength = (strengthText ?? "").trim();
  if (!strength || hasExactTrailingStrength(name, strength)) return name;
  return [name, strength].filter(Boolean).join(" ");
}

/** Safely split a selected catalogue/library identity into its structured strength. */
export function canonicalizeSelectedMedicineDraft(draft: MedicineDraft): MedicineDraft {
  const strength = draft.strengthText.trim();
  const pattern = trailingStrengthPattern(strength);
  if (!pattern || !hasExactTrailingStrength(draft.displayName, strength)) return { ...draft };

  const displayName = draft.displayName.trim().replace(pattern, "").trim();
  if (!displayName) return { ...draft };
  return { ...draft, displayName };
}
