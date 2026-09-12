import "server-only";

import { AiTelemetryValidationError } from "./telemetry-events";

// ---------------------------------------------------------------------------
// Second net: a deep key scan that also serves any caller outside the builders
// ---------------------------------------------------------------------------

const FORBIDDEN_KEY_FRAGMENTS = [
  "patient",
  "encounter",
  "prescription",
  "document",
  "appointment",
  "clinicalrecord",
  "clinicaltext",
  "clinicalpayload",
  "transcript",
  "prompt",
  "completion",
  "authoredtext",
  "securityhandle",
  "binding",
  "rawaudio",
  "audiobytes",
  "medicine",
  "investigation",
  "diagnos",
  "rawrequest",
  "rawresponse",
  "proposalbody",
  "proposalcontent",
];
/** Exact normalized keys forbidden even though a fragment rule would be too broad. */
const FORBIDDEN_EXACT_KEYS = new Set(["proposal", "note", "notes", "dx", "requestref"]);

/**
 * Deep scan for clinical-payload key names. Normalization strips case,
 * underscores and hyphens, so `patientIdentifier`, `patient_id` and
 * `Patient-Id` are all caught — the exact-match denylist this replaces passed
 * all but one of them.
 */
export function assertPrivacySafeTelemetry(value: unknown): void {
  const visit = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, "");
      if (
        FORBIDDEN_EXACT_KEYS.has(normalized) ||
        FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))
      ) {
        throw new AiTelemetryValidationError("PRIVACY_UNSAFE_KEY", key);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "telemetry");
}

