import type {
  AiProposalPayload,
  InvestigationListProposal,
  MedicineProposal,
  PrescriptionMedicineProposal,
} from "./contracts";

const PRESCRIPTION_STRING_FIELDS = [
  "display_name",
  "brand_name",
  "generic_name",
  "strength_text",
  "dose_text",
  "dosage_form",
  "route",
  "schedule_text",
  "duration_text",
  "quantity_text",
  "food_relation",
  "instructions",
] as const;

type PrescriptionStringField = (typeof PRESCRIPTION_STRING_FIELDS)[number];

export type ExplicitBooleanEvidence = "POSITIVE" | "NEGATIVE" | "CONFLICT" | "NONE";

export class ProposalGroundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalGroundingError";
  }
}

/**
 * Comparison-only normalization. Never use this value as replacement clinical text.
 */
export function normalizeGroundingText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

/**
 * Source grounding is deliberately lexical and contiguous only: no translation,
 * medical synonyms, fuzzy matching, unit conversion, or clinical inference.
 */
export function isSourceGroundedText(value: string, authoredText: string): boolean {
  const needle = normalizeGroundingText(value);
  if (!needle) return false;
  return normalizeGroundingText(authoredText).includes(needle);
}

/**
 * Removes only the reproduced duplicate-strength suffix class. The returned
 * strength must be an exact suffix of display_name and the remaining name must
 * already be grounded in the authored source.
 */
export function canonicalizeDisplayName(
  displayName: string,
  strengthText: string | null | undefined,
  authoredText: string,
): string {
  const display = displayName.trim();
  const strength = typeof strengthText === "string" ? strengthText.trim() : "";
  if (!strength || display.length <= strength.length || !display.endsWith(strength)) {
    return display;
  }

  const prefix = display.slice(0, display.length - strength.length).trimEnd();
  if (!prefix || !isSourceGroundedText(prefix, authoredText)) return display;
  return prefix;
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function authoredLexicalPart(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .map((part) => escapeRegExpLiteral(part))
    .join("\\s+");
}

function exactAdjacentAuthoredSpan(
  left: string,
  right: string,
  authoredText: string,
): string | null {
  const leftPattern = authoredLexicalPart(left);
  const rightPattern = authoredLexicalPart(right);
  if (!leftPattern || !rightPattern) return null;

  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(${leftPattern}\\s+${rightPattern})(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  );
  return pattern.exec(authoredText)?.[1] ?? null;
}

/**
 * Reconstructs only an explicitly authored medicine mention where the provider
 * split a dosage-form token from display_name. Both prefix and suffix forms are
 * allowed, but only when the exact lexical pair is contiguous in authoredText.
 * The returned value is the authored span itself, preserving source wording.
 */
export function canonicalizeExplicitMedicineMention(
  displayName: string,
  dosageForm: string | null | undefined,
  authoredText: string,
): string {
  const display = displayName.trim();
  const form = typeof dosageForm === "string" ? dosageForm.trim() : "";
  if (!display || !form) return display;

  const adjacentPairs: ReadonlyArray<readonly [string, string]> = [
    [form, display],
    [display, form],
  ];

  for (const [left, right] of adjacentPairs) {
    const normalizedCandidate = `${left} ${right}`;
    if (!isSourceGroundedText(normalizedCandidate, authoredText)) continue;
    const authoredSpan = exactAdjacentAuthoredSpan(left, right, authoredText);
    if (authoredSpan) return authoredSpan;
  }

  return display;
}

/**
 * Duration canonicalization is intentionally tiny: one leading English "for "
 * plus terminal . , ; : punctuation and surrounding whitespace only.
 */
export function canonicalizeDurationText(value: string): string {
  return value
    .trim()
    .replace(/^for\s+/iu, "")
    .replace(/\s*[.,;:]+\s*$/u, "")
    .trim();
}

function prnPositive(authoredText: string): boolean {
  const text = normalizeGroundingText(authoredText);
  return (
    /(?:\bprn\b|\bsos\b|\bas\s+needed\b|\bwhen\s+needed\b)/iu.test(text) ||
    text.includes("প্রয়োজনে") ||
    text.includes("প্রয়োজনে")
  );
}

function prnNegative(authoredText: string): boolean {
  const text = normalizeGroundingText(authoredText);
  return (
    /(?:\bnot\s+prn\b|\bnot\s+sos\b|\bnot\s+as\s+needed\b|\bnot\s+when\s+needed\b)/iu.test(text) ||
    text.includes("প্রয়োজনে নয়") ||
    text.includes("প্রয়োজনে নয়")
  );
}

export function explicitPrnEvidence(authoredText: string): ExplicitBooleanEvidence {
  const positive = prnPositive(authoredText);
  const negative = prnNegative(authoredText);
  if (negative && positive) {
    // Negative phrases contain positive lexical tokens; negative evidence wins
    // only when the positive match is entirely explained by that explicit negation.
    const text = normalizeGroundingText(authoredText);
    const stripped = text
      .replace(/\bnot\s+prn\b/giu, "")
      .replace(/\bnot\s+sos\b/giu, "")
      .replace(/\bnot\s+as\s+needed\b/giu, "")
      .replace(/\bnot\s+when\s+needed\b/giu, "")
      .replace(/প্রয়োজনে নয়/gu, "")
      .replace(/প্রয়োজনে নয়/gu, "");
    const residualPositive =
      /(?:\bprn\b|\bsos\b|\bas\s+needed\b|\bwhen\s+needed\b)/iu.test(stripped) ||
      stripped.includes("প্রয়োজনে") ||
      stripped.includes("প্রয়োজনে");
    return residualPositive ? "CONFLICT" : "NEGATIVE";
  }
  if (negative) return "NEGATIVE";
  if (positive) return "POSITIVE";
  return "NONE";
}

function substitutionPositive(authoredText: string): boolean {
  const text = normalizeGroundingText(authoredText);
  return /(?:\bsubstitution\s+allowed\b|\bmay\s+substitute\b|\bcan\s+substitute\b)/iu.test(text);
}

function substitutionNegative(authoredText: string): boolean {
  const text = normalizeGroundingText(authoredText);
  return /(?:\bdo\s+not\s+substitute\b|\bno\s+substitution\b)/iu.test(text);
}

export function explicitSubstitutionEvidence(authoredText: string): ExplicitBooleanEvidence {
  const positive = substitutionPositive(authoredText);
  const negative = substitutionNegative(authoredText);
  if (positive && negative) return "CONFLICT";
  if (negative) return "NEGATIVE";
  if (positive) return "POSITIVE";
  return "NONE";
}

function groundBoolean(
  value: boolean | null | undefined,
  evidence: ExplicitBooleanEvidence,
): boolean | null | undefined {
  if (value === null || value === undefined) return value;
  if (value === true) return evidence === "POSITIVE" ? true : null;
  return evidence === "NEGATIVE" ? false : null;
}

function groundedPrescriptionString(
  field: PrescriptionStringField,
  value: string | null | undefined,
  proposal: PrescriptionMedicineProposal,
  authoredText: string,
): string | null | undefined {
  if (value === null || value === undefined) return value;

  let candidate = value;
  if (field === "display_name") {
    candidate = canonicalizeDisplayName(value, proposal.medicine.strength_text, authoredText);
    candidate = canonicalizeExplicitMedicineMention(
      candidate,
      proposal.medicine.dosage_form,
      authoredText,
    );
  } else if (field === "duration_text") {
    candidate = canonicalizeDurationText(value);
  }

  return isSourceGroundedText(candidate, authoredText) ? candidate : null;
}

function groundPrescription(
  authoredText: string,
  proposal: PrescriptionMedicineProposal,
): PrescriptionMedicineProposal {
  const medicine: MedicineProposal = { ...proposal.medicine };

  for (const field of PRESCRIPTION_STRING_FIELDS) {
    if (!(field in proposal.medicine)) continue;
    medicine[field] = groundedPrescriptionString(
      field,
      proposal.medicine[field],
      proposal,
      authoredText,
    );
  }

  if ("is_prn" in proposal.medicine) {
    medicine.is_prn = groundBoolean(
      proposal.medicine.is_prn,
      explicitPrnEvidence(authoredText),
    );
  }

  if ("substitution_allowed" in proposal.medicine) {
    medicine.substitution_allowed = groundBoolean(
      proposal.medicine.substitution_allowed,
      explicitSubstitutionEvidence(authoredText),
    );
  }

  return {
    kind: "PRESCRIPTION_MEDICINE",
    medicine,
    uncertainties: proposal.uncertainties.map((item) => ({ ...item })),
    requires_review: true,
  };
}

function groundInvestigations(
  authoredText: string,
  proposal: InvestigationListProposal,
): InvestigationListProposal {
  const investigations = proposal.investigations
    .filter((item) => isSourceGroundedText(item.name, authoredText))
    .map((item) => ({
      name: item.name,
      ...(item.note === undefined
        ? {}
        : {
            note:
              item.note === null || isSourceGroundedText(item.note, authoredText)
                ? item.note
                : null,
          }),
    }));

  if (investigations.length === 0) {
    throw new ProposalGroundingError("AI_GROUNDING_NO_EXPLICIT_INVESTIGATIONS");
  }

  return {
    kind: "INVESTIGATION_LIST",
    investigations,
    uncertainties: proposal.uncertainties.map((item) => ({ ...item })),
    requires_review: true,
  };
}

/**
 * Deterministic source grounding/canonicalization for provider proposals.
 * It may only remove unsupported content or the explicitly allowed wrappers;
 * it never adds, translates, normalizes clinically, or infers a fact.
 */
export function groundProviderProposal(
  authoredText: string,
  proposal: AiProposalPayload,
): AiProposalPayload {
  if (proposal.kind === "PRESCRIPTION_MEDICINE") {
    return groundPrescription(authoredText, proposal);
  }
  if (proposal.kind === "INVESTIGATION_LIST") {
    return groundInvestigations(authoredText, proposal);
  }

  // Clinical Note and Navigation are intentionally outside this narrow
  // semantic-hardening gate; preserve their existing authority/semantics.
  if (proposal.kind === "CLINICAL_NOTE") {
    return {
      kind: "CLINICAL_NOTE",
      text: proposal.text,
      uncertainties: proposal.uncertainties.map((item) => ({ ...item })),
      requires_review: true,
    };
  }
  return {
    kind: "NAVIGATION_COMMAND",
    command: proposal.command,
    requires_review: false,
  };
}
