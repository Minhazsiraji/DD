import { z } from "zod";

export const INVESTIGATION_V1_MAX_BATCH = 100;
export const INVESTIGATION_V1_MAX_NAME = 300;
export const INVESTIGATION_V1_MAX_NOTE = 2000;

const uuid = z.uuid();
const stagedInvestigationSchema = z.object({
  name: z.string().trim().min(1, "Give the investigation a name.").max(INVESTIGATION_V1_MAX_NAME),
  note: z.string().trim().max(INVESTIGATION_V1_MAX_NOTE).nullable().optional(),
});

const confirmationSchema = z.object({
  encounterId: uuid,
  expectedVersion: z.number().int().positive(),
  operationKey: uuid,
  investigations: z
    .array(stagedInvestigationSchema)
    .min(1, "Add at least one investigation before confirming.")
    .max(INVESTIGATION_V1_MAX_BATCH),
});

export interface StagedInvestigation {
  name: string;
  note: string | null;
}

export interface InvestigationConfirmationInput {
  encounterId: string;
  expectedVersion: number;
  operationKey: string;
  investigations: StagedInvestigation[];
}

/**
 * Validate and canonicalise a LOCAL Investigation V1 draft before it crosses
 * the server/database boundary. The database repeats every material check; this
 * helper is UX/input hygiene, never clinical authority.
 */
export function parseInvestigationConfirmationInput(
  input: unknown,
):
  | { ok: true; value: InvestigationConfirmationInput }
  | { ok: false; message: string } {
  const parsed = confirmationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Those investigations could not be confirmed.",
    };
  }

  return {
    ok: true,
    value: {
      encounterId: parsed.data.encounterId,
      expectedVersion: parsed.data.expectedVersion,
      operationKey: parsed.data.operationKey,
      investigations: parsed.data.investigations.map((row) => ({
        name: row.name.trim(),
        note: row.note && row.note.trim() !== "" ? row.note.trim() : null,
      })),
    },
  };
}

export interface ConfirmationRpcRow {
  resultVersion: number;
  confirmedCount: number;
  replayed: boolean;
}

/**
 * Treat an unexpected RPC shape as UNKNOWN OUTCOME, never as a successful
 * mutation. A committed clinical write must not be repeated under a new key
 * merely because PostgREST returned something we cannot interpret.
 */
export function parseConfirmationRpcRow(data: unknown): ConfirmationRpcRow | null {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (!candidate || typeof candidate !== "object") return null;

  const row = candidate as Record<string, unknown>;
  const resultVersion = row.result_version;
  const confirmedCount = row.confirmed_count;
  const replayed = row.replayed;

  if (
    typeof resultVersion !== "number" ||
    !Number.isInteger(resultVersion) ||
    resultVersion <= 0 ||
    typeof confirmedCount !== "number" ||
    !Number.isInteger(confirmedCount) ||
    confirmedCount < 1 ||
    confirmedCount > INVESTIGATION_V1_MAX_BATCH ||
    typeof replayed !== "boolean"
  ) {
    return null;
  }

  return { resultVersion, confirmedCount, replayed };
}
