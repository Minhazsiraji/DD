/**
 * PA1 AI + Voice clinical proposal contracts.
 *
 * Permanent rule: AI output is a PROPOSAL, never clinical truth.
 * This module is deliberately provider-neutral. Every provider output is
 * validated by the same strict server-side contract before a DD write path can
 * see it.
 */

export const AI_TASK_TYPES = [
  "PRESCRIPTION_MEDICINE",
  "INVESTIGATION_LIST",
  "CLINICAL_NOTE",
  "NAVIGATION_COMMAND",
] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const SAFE_NAVIGATION_COMMANDS = [
  "OPEN_PATIENT_SEARCH",
  "OPEN_PRESCRIPTION",
  "SHOW_RECENT_MEDICINES",
  "OPEN_INVESTIGATIONS",
] as const;
export type SafeNavigationCommand = (typeof SAFE_NAVIGATION_COMMANDS)[number];

export const PRESCRIPTION_PROPOSAL_FIELDS = [
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
  "is_prn",
  "instructions",
  "substitution_allowed",
] as const;
export type PrescriptionProposalField = (typeof PRESCRIPTION_PROPOSAL_FIELDS)[number];

export type ProposalUncertaintyCode =
  | "AMBIGUOUS_MEDICINE"
  | "AMBIGUOUS_DOSE"
  | "AMBIGUOUS_UNIT"
  | "AMBIGUOUS_SCHEDULE"
  | "TRANSCRIPT_UNCERTAIN"
  | "MISSING_CLARIFICATION";

export interface ProposalUncertainty {
  field: string;
  code: ProposalUncertaintyCode;
  /** Safe review prompt; do not copy raw transcript/patient content here. */
  message: string;
}

export interface MedicineProposal {
  display_name?: string | null;
  brand_name?: string | null;
  generic_name?: string | null;
  strength_text?: string | null;
  dose_text?: string | null;
  dosage_form?: string | null;
  route?: string | null;
  schedule_text?: string | null;
  duration_text?: string | null;
  quantity_text?: string | null;
  food_relation?: string | null;
  is_prn?: boolean | null;
  instructions?: string | null;
  substitution_allowed?: boolean | null;
}

export interface PrescriptionMedicineProposal {
  kind: "PRESCRIPTION_MEDICINE";
  medicine: MedicineProposal;
  uncertainties: ProposalUncertainty[];
  requires_review: true;
}

export interface InvestigationProposalRow {
  name: string;
  note?: string | null;
}

export interface InvestigationListProposal {
  kind: "INVESTIGATION_LIST";
  investigations: InvestigationProposalRow[];
  uncertainties: ProposalUncertainty[];
  requires_review: true;
}

export interface ClinicalNoteProposal {
  kind: "CLINICAL_NOTE";
  /** Transient Doctor-authored draft text; never owner analytics. */
  text: string;
  uncertainties: ProposalUncertainty[];
  requires_review: true;
}

export interface NavigationProposal {
  kind: "NAVIGATION_COMMAND";
  command: SafeNavigationCommand;
  requires_review: false;
}

export type AiProposalPayload =
  | PrescriptionMedicineProposal
  | InvestigationListProposal
  | ClinicalNoteProposal
  | NavigationProposal;

export interface ProposalBinding {
  actorUserId: string;
  doctorProfileId: string;
  practiceLocationId: string;
  patientId: string | null;
  clinicalRecordId: string | null;
  expectedVersion: number | null;
}

export interface SafeProviderMetadata {
  provider: string;
  model: string;
  /** Provider adapter must make this opaque/non-clinical before returning it. */
  requestRef?: string | null;
}

export interface AiProposalEnvelope<T extends AiProposalPayload = AiProposalPayload> {
  operationId: string;
  createdAt: string;
  expiresAt: string;
  taskType: T["kind"];
  source: "TEXT" | "VOICE_TRANSCRIPT";
  binding: ProposalBinding;
  provider: SafeProviderMetadata;
  proposal: T;
}

export class ProposalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalValidationError";
  }
}

const MAX_TEXT = 500;
const MAX_NOTE = 2000;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const UNCERTAINTY_CODES = new Set<ProposalUncertaintyCode>([
  "AMBIGUOUS_MEDICINE",
  "AMBIGUOUS_DOSE",
  "AMBIGUOUS_UNIT",
  "AMBIGUOUS_SCHEDULE",
  "TRANSCRIPT_UNCERTAIN",
  "MISSING_CLARIFICATION",
]);
const NAV_COMMAND_SET = new Set<string>(SAFE_NAVIGATION_COMMANDS);
const RX_FIELD_SET = new Set<string>(PRESCRIPTION_PROPOSAL_FIELDS);

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProposalValidationError(`${label} must be an object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new ProposalValidationError(`${label} must be a plain object`);
  }
  const out = value as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) throw new ProposalValidationError(`${label} has forbidden key`);
  }
  return out;
}

function exactKeys(
  object: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new ProposalValidationError(`${label} has unexpected field: ${key}`);
  }
  for (const key of required) {
    if (!(key in object)) throw new ProposalValidationError(`${label} is missing field: ${key}`);
  }
}

function nullableText(value: unknown, label: string, max = MAX_TEXT): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new ProposalValidationError(`${label} must be text or null`);
  const trimmed = value.trim();
  if (!trimmed) throw new ProposalValidationError(`${label} must not be blank`);
  if (trimmed.length > max) throw new ProposalValidationError(`${label} is too long`);
  return trimmed;
}

function requiredText(value: unknown, label: string, max = MAX_TEXT): string {
  const parsed = nullableText(value, label, max);
  if (parsed === null) throw new ProposalValidationError(`${label} must not be null`);
  return parsed;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) return null;
  if (typeof value !== "boolean") throw new ProposalValidationError(`${label} must be boolean or null`);
  return value;
}

function parseUncertainties(value: unknown): ProposalUncertainty[] {
  if (!Array.isArray(value)) throw new ProposalValidationError("uncertainties must be an array");
  if (value.length > 20) throw new ProposalValidationError("too many uncertainties");
  return value.map((entry, index) => {
    const row = plainObject(entry, `uncertainties[${index}]`);
    exactKeys(
      row,
      new Set(["field", "code", "message"]),
      new Set(["field", "code", "message"]),
      `uncertainties[${index}]`,
    );
    const field = requiredText(row.field, `uncertainties[${index}].field`, 80);
    const code = row.code;
    if (typeof code !== "string" || !UNCERTAINTY_CODES.has(code as ProposalUncertaintyCode)) {
      throw new ProposalValidationError(`uncertainties[${index}].code is invalid`);
    }
    const message = requiredText(row.message, `uncertainties[${index}].message`, 240);
    return { field, code: code as ProposalUncertaintyCode, message };
  });
}

function parseMedicine(value: unknown): MedicineProposal {
  const row = plainObject(value, "medicine");
  for (const key of Object.keys(row)) {
    if (!RX_FIELD_SET.has(key)) throw new ProposalValidationError(`medicine has unexpected field: ${key}`);
  }
  const out: MedicineProposal = {};
  for (const field of PRESCRIPTION_PROPOSAL_FIELDS) {
    if (!(field in row)) continue;
    const value = row[field];
    if (field === "is_prn" || field === "substitution_allowed") {
      out[field] = nullableBoolean(value, `medicine.${field}`) as never;
    } else {
      out[field] = nullableText(value, `medicine.${field}`) as never;
    }
  }
  return out;
}

function ensureReviewTrue(row: Record<string, unknown>, label: string): void {
  if (row.requires_review !== true) {
    throw new ProposalValidationError(`${label}.requires_review must be true`);
  }
}

export function validateProviderProposal(taskType: AiTaskType, raw: unknown): AiProposalPayload {
  const row = plainObject(raw, "proposal");

  if (taskType === "PRESCRIPTION_MEDICINE") {
    exactKeys(
      row,
      new Set(["kind", "medicine", "uncertainties", "requires_review"]),
      new Set(["kind", "medicine", "uncertainties", "requires_review"]),
      "proposal",
    );
    if (row.kind !== taskType) throw new ProposalValidationError("proposal kind mismatch");
    ensureReviewTrue(row, "proposal");
    const medicine = parseMedicine(row.medicine);
    const uncertainties = parseUncertainties(row.uncertainties);

    // Ambiguity must remain missing/null and visible for Doctor review.
    if ((medicine.display_name ?? null) === null) {
      const disclosed = uncertainties.some((u) => u.code === "AMBIGUOUS_MEDICINE");
      if (!disclosed) throw new ProposalValidationError("missing medicine name must be disclosed as ambiguity");
    }
    return { kind: taskType, medicine, uncertainties, requires_review: true };
  }

  if (taskType === "INVESTIGATION_LIST") {
    exactKeys(
      row,
      new Set(["kind", "investigations", "uncertainties", "requires_review"]),
      new Set(["kind", "investigations", "uncertainties", "requires_review"]),
      "proposal",
    );
    if (row.kind !== taskType) throw new ProposalValidationError("proposal kind mismatch");
    ensureReviewTrue(row, "proposal");
    if (!Array.isArray(row.investigations) || row.investigations.length === 0 || row.investigations.length > 30) {
      throw new ProposalValidationError("investigations must contain 1-30 explicit rows");
    }
    const investigations = row.investigations.map((item, index) => {
      const investigation = plainObject(item, `investigations[${index}]`);
      exactKeys(
        investigation,
        new Set(["name", "note"]),
        new Set(["name"]),
        `investigations[${index}]`,
      );
      return {
        name: requiredText(investigation.name, `investigations[${index}].name`, 240),
        ...(investigation.note === undefined
          ? {}
          : { note: nullableText(investigation.note, `investigations[${index}].note`, 500) }),
      };
    });
    return {
      kind: taskType,
      investigations,
      uncertainties: parseUncertainties(row.uncertainties),
      requires_review: true,
    };
  }

  if (taskType === "CLINICAL_NOTE") {
    exactKeys(
      row,
      new Set(["kind", "text", "uncertainties", "requires_review"]),
      new Set(["kind", "text", "uncertainties", "requires_review"]),
      "proposal",
    );
    if (row.kind !== taskType) throw new ProposalValidationError("proposal kind mismatch");
    ensureReviewTrue(row, "proposal");
    return {
      kind: taskType,
      text: requiredText(row.text, "proposal.text", MAX_NOTE),
      uncertainties: parseUncertainties(row.uncertainties),
      requires_review: true,
    };
  }

  exactKeys(
    row,
    new Set(["kind", "command", "requires_review"]),
    new Set(["kind", "command", "requires_review"]),
    "proposal",
  );
  if (row.kind !== "NAVIGATION_COMMAND") throw new ProposalValidationError("proposal kind mismatch");
  if (row.requires_review !== false) {
    throw new ProposalValidationError("navigation requires_review must be false");
  }
  if (typeof row.command !== "string" || !NAV_COMMAND_SET.has(row.command)) {
    throw new ProposalValidationError("unsafe or unknown navigation command");
  }
  return {
    kind: "NAVIGATION_COMMAND",
    command: row.command as SafeNavigationCommand,
    requires_review: false,
  };
}

/**
 * Provider-facing JSON Schema. Strict additionalProperties=false, unspoken
 * clinical fields optional/null, and all clinical proposals require review.
 */
export function providerJsonSchema(taskType: AiTaskType): Record<string, unknown> {
  const nullableString = { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] };
  const nullableBooleanSchema = { anyOf: [{ type: "boolean" }, { type: "null" }] };
  const uncertainty = {
    type: "object",
    additionalProperties: false,
    required: ["field", "code", "message"],
    properties: {
      field: { type: "string", minLength: 1, maxLength: 80 },
      code: { type: "string", enum: [...UNCERTAINTY_CODES] },
      message: { type: "string", minLength: 1, maxLength: 240 },
    },
  };

  if (taskType === "PRESCRIPTION_MEDICINE") {
    const properties: Record<string, unknown> = {};
    for (const field of PRESCRIPTION_PROPOSAL_FIELDS) {
      properties[field] =
        field === "is_prn" || field === "substitution_allowed"
          ? nullableBooleanSchema
          : nullableString;
    }
    return {
      type: "object",
      additionalProperties: false,
      required: ["kind", "medicine", "uncertainties", "requires_review"],
      properties: {
        kind: { const: taskType },
        medicine: { type: "object", additionalProperties: false, properties },
        uncertainties: { type: "array", maxItems: 20, items: uncertainty },
        requires_review: { const: true },
      },
    };
  }

  if (taskType === "INVESTIGATION_LIST") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["kind", "investigations", "uncertainties", "requires_review"],
      properties: {
        kind: { const: taskType },
        investigations: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name"],
            properties: { name: { type: "string", minLength: 1 }, note: nullableString },
          },
        },
        uncertainties: { type: "array", maxItems: 20, items: uncertainty },
        requires_review: { const: true },
      },
    };
  }

  if (taskType === "CLINICAL_NOTE") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["kind", "text", "uncertainties", "requires_review"],
      properties: {
        kind: { const: taskType },
        text: { type: "string", minLength: 1, maxLength: MAX_NOTE },
        uncertainties: { type: "array", maxItems: 20, items: uncertainty },
        requires_review: { const: true },
      },
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "command", "requires_review"],
    properties: {
      kind: { const: "NAVIGATION_COMMAND" },
      command: { type: "string", enum: [...SAFE_NAVIGATION_COMMANDS] },
      requires_review: { const: false },
    },
  };
}
