import type { M6DTarget } from "./m6d-intent-router";

export type M6GAmbientRisk = "low-risk" | "proposal" | "needs-review";
export type M6GAmbientTarget = M6DTarget | "diagnosis" | "investigation" | "medicine" | "needs-review";

export interface M6GAmbientRoute {
  target: M6GAmbientTarget;
  risk: M6GAmbientRisk;
  text: string;
  reason: string;
  correction?:
    | { type: "remove"; value: string }
    | { type: "replace"; value: string; replacement: string };
}

const INVESTIGATION_TERMS = /\b(?:cbc|hba1c|serum\s+amylase|amylase|lipase|x-?ray|ct\s*(?:scan)?|mri|ecg|echo|creatinine|urine|lft|rft|tsh|test|investigation)\b/iu;
const MEDICINE_TERMS = /\b(?:start|prescribe|medicine|tablet|capsule|syrup|injection|paracetamol|napa|metformin|amlodipine|omeprazole)\b/iu;
const DIAGNOSIS_TERMS = /\b(?:diagnosis|diagnose|assessment\s+(?:suggests|is|likely)|suggests|impression)\b/iu;
const EXAM_TERMS = /\b(?:on\s+examination|examination|exam(?:ination)?[- ]?e|tenderness|crepitations?|wheeze|edema|oedema)\b/iu;
const FOLLOW_UP_TERMS = /\b(?:follow[- ]?up|review\s+after|come\s+back|din\s+por|days?\s+later)\b/iu;
const PAST_TERMS = /\b(?:past\s+history|previous\s+history|history\s+of\s+(?:diabetes|hypertension|asthma|surgery)|drug\s+history|allerg(?:y|ic)|family\s+history|social\s+history|smok(?:e|er|ing))\b/iu;
const HPI_TERMS = /\b(?:for\s+\w+\s+days?|since|radiates?|radiating|vomit(?:ing|ed)?|duration|worse|better|associated|back[- ]?e|dhore|bar\s+hoyeche)\b/iu;
const CHIEF_TERMS = /\b(?:patient(?:-er)?\s+(?:has|with)|complain(?:s|ing)?\s+of|fever|pain|cough|headache|diarrh(?:ea|oea)|vomit(?:ing)?)\b/iu;

function normalized(text: string) {
  return text.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function ambientDedupKey(route: Pick<M6GAmbientRoute, "target" | "text">): string {
  return `${route.target}:${normalized(route.text).toLocaleLowerCase("en-US").replace(/[.,;:!?]+$/gu, "")}`;
}

export function parseAmbientCorrection(text: string): M6GAmbientRoute["correction"] | undefined {
  const value = normalized(text);
  const replace = value.match(/(?:^|\b)(?:not|correction[:,]?|replace\s+that[:,]?)\s+(.+?)(?:,|\s+)\s*(?:actually|with)\s+(.+)$/iu);
  if (replace?.[1] && replace[2]) return { type: "replace", value: replace[1].trim(), replacement: replace[2].trim() };
  const remove = value.match(/^(?:remove|delete)\s+(.+)$/iu);
  if (remove?.[1]) return { type: "remove", value: remove[1].trim() };
  return undefined;
}

export function applyAmbientCorrection(
  current: string,
  correction: NonNullable<M6GAmbientRoute["correction"]>,
): string | null {
  if (!current.trim()) return null;
  const escaped = correction.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(escaped, "iu");
  if (!expression.test(current)) return null;
  if (correction.type === "remove") {
    return current
      .replace(expression, "")
      .replace(/\s{2,}/gu, " ")
      .replace(/\s+([,.;])/gu, "$1")
      .trim();
  }
  return current.replace(expression, correction.replacement);
}

export function routeAmbientUtterance(rawText: string): M6GAmbientRoute {
  const text = normalized(rawText);
  const correction = parseAmbientCorrection(text);
  if (correction) {
    return {
      target: "needs-review",
      risk: "needs-review",
      text,
      reason: "Natural correction requires matching the existing editable note before applying.",
      correction,
    };
  }

  if (
    MEDICINE_TERMS.test(text) &&
    /\b(?:mg|mcg|ml|tablet|capsule|syrup|start|prescribe|medicine|paracetamol|napa|metformin|amlodipine|omeprazole)\b/iu.test(text)
  ) {
    return {
      target: "medicine",
      risk: "proposal",
      text,
      reason: "Medicine, dose, frequency and duration stay in the protected prescription review workflow.",
    };
  }
  if (
    INVESTIGATION_TERMS.test(text) &&
    /\b(?:add|order|do|korte\s+hobe|check|cbc|hba1c|amylase|lipase|x-?ray|ct|mri|ecg|creatinine|tsh)\b/iu.test(text)
  ) {
    return {
      target: "investigation",
      risk: "proposal",
      text,
      reason: "Investigation orders require explicit Doctor confirmation.",
    };
  }
  if (DIAGNOSIS_TERMS.test(text)) {
    return {
      target: "diagnosis",
      risk: "proposal",
      text,
      reason: "Assessment/diagnosis content is clinically consequential and cannot auto-finalize.",
    };
  }
  if (FOLLOW_UP_TERMS.test(text)) {
    return { target: "nextVisitNote", risk: "low-risk", text, reason: "Follow-up documentation is editable low-risk note content." };
  }
  if (EXAM_TERMS.test(text)) {
    return { target: "examination", risk: "low-risk", text, reason: "Examination statement routed to the editable examination note." };
  }
  if (PAST_TERMS.test(text)) {
    return {
      target: "pastHistory",
      risk: "low-risk",
      text,
      reason: "Past/drug/allergy/family/social history is stored in the existing editable history surface.",
    };
  }
  if (HPI_TERMS.test(text)) {
    return { target: "presentIllness", risk: "low-risk", text, reason: "Duration, radiation and associated-symptom context routed to HPI." };
  }
  if (CHIEF_TERMS.test(text)) {
    return {
      target: "chiefComplaints",
      risk: "low-risk",
      text,
      reason: "Primary symptom/complaint statement routed to chief complaints.",
    };
  }
  if (/\b(?:advise|advice|hydration|rest|diet|avoid)\b/iu.test(text)) {
    return { target: "advice", risk: "low-risk", text, reason: "Advice remains an editable note until the encounter is finalized." };
  }
  return {
    target: "needs-review",
    risk: "needs-review",
    text,
    reason: "No reliable deterministic section match; Doctor must choose the destination.",
  };
}

export function isHighRiskAmbientTarget(target: M6GAmbientTarget): boolean {
  return target === "diagnosis" || target === "investigation" || target === "medicine";
}
