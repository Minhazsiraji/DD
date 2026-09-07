"use server";

import { z } from "zod";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RxResult } from "./actions";
import { getFinalizedPrescription, getPrescription } from "./queries";
import {
  RX_ADVANCED_MESSAGE,
  RX_CONFLICT_UNLOADABLE_MESSAGE,
  RX_UNCONFIRMED_MESSAGE,
  translateRxError,
} from "./errors";

function reuseMessage(message: string): string {
  const m = message.toUpperCase();
  if (m.includes("CORRECTION_SUCCESSOR_REUSE_FORBIDDEN")) {
    return "A corrected prescription must start blank. Historical reuse is not available on this correction.";
  }
  if (m.includes("APPEND_CONFIRMATION_REQUIRED")) {
    return "This prescription already has medicines. Confirm that you want to append the selected history.";
  }
  if (m.includes("SOURCE_PRESCRIPTION_NOT_ELIGIBLE") || m.includes("SOURCE_PRESCRIPTION_NOT_FOUND")) {
    return "That previous prescription is not eligible for reuse.";
  }
  if (m.includes("SELECTED_ITEM_NOT_IN_SOURCE") || m.includes("SELECTED_ITEMS_REQUIRED")) {
    return "One of the selected medicines is no longer available in that signed prescription. Reload history and choose again.";
  }
  if (m.includes("IDEMPOTENCY_KEY_CONFLICT")) {
    return "That reuse request changed after it was started. Close it and choose the medicines again.";
  }
  if (m.includes("PRESCRIPTION_FINALIZATION_STATE_INVALID")) {
    return "That historical prescription could not be verified against its signed record, so it was not reused.";
  }
  if (m.includes("ONLY THE TREATING DOCTOR") || m.includes("NOT AUTHENTICATED") || m.includes("PRESCRIPTION NOT FOUND")) {
    return "This historical prescription is not available for reuse in the current prescription.";
  }
  return translateRxError(message).message;
}

const reuseSchema = z.object({
  prescriptionId: z.uuid(),
  sourcePrescriptionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  mode: z.enum(["ALL", "SELECTED"]),
  selectedItemIds: z.array(z.uuid()).max(100).optional(),
  appendConfirmed: z.boolean(),
  idempotencyKey: z.string().min(8).max(128),
});

/** Historical reuse uses the SAME prescription version and is reconciled by a fresh read. */
export async function reusePrescriptionItemsAction(input: unknown): Promise<RxResult> {
  const parsed = reuseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, kind: "error", message: "Choose what you want to reuse from the previous prescription." };
  }
  if (parsed.data.mode === "SELECTED" && (!parsed.data.selectedItemIds || parsed.data.selectedItemIds.length === 0)) {
    return { ok: false, kind: "error", message: "Select at least one medicine to reuse." };
  }
  if (parsed.data.mode === "ALL" && parsed.data.selectedItemIds?.length) {
    return { ok: false, kind: "error", message: "Choose either the whole prescription or selected medicines, not both." };
  }

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const p = parsed.data;
  const { data, error } = await supabase.rpc("reuse_finalized_prescription_items", {
    p_source_prescription_id: p.sourcePrescriptionId,
    p_target_prescription_id: p.prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: p.expectedVersion,
    p_copy_mode: p.mode,
    p_selected_item_ids: p.mode === "SELECTED" ? p.selectedItemIds : null,
    p_append_confirmed: p.appendConfirmed,
    p_idempotency_key: p.idempotencyKey,
  });

  if (error) {
    const translated = translateRxError(error.message);
    if (translated.kind === "conflict") {
      const current = await getPrescription(p.prescriptionId, ctx.locationId);
      if (!current.ok) {
        return { ok: false, kind: "conflict-unloadable", message: RX_CONFLICT_UNLOADABLE_MESSAGE };
      }
      return {
        ok: false,
        kind: "conflict",
        message: translated.message,
        version: current.prescription.version,
        items: current.prescription.items,
      };
    }
    return { ok: false, kind: "error", message: reuseMessage(error.message) };
  }

  const earnedVersion = Number((data as { version?: unknown } | null)?.version ?? NaN);
  if (!Number.isInteger(earnedVersion) || earnedVersion <= p.expectedVersion) {
    console.error("[prescriptions] reuse returned unusable version", data);
    return { ok: false, kind: "unconfirmed", message: RX_UNCONFIRMED_MESSAGE };
  }

  const current = await getPrescription(p.prescriptionId, ctx.locationId);
  if (!current.ok) return { ok: false, kind: "unconfirmed", message: RX_UNCONFIRMED_MESSAGE };
  if (current.prescription.version === earnedVersion) {
    return { ok: true, version: current.prescription.version, items: current.prescription.items };
  }
  if (current.prescription.version > earnedVersion) {
    return {
      ok: false,
      kind: "write-confirmed-advanced",
      message: RX_ADVANCED_MESSAGE,
      version: current.prescription.version,
      items: current.prescription.items,
    };
  }
  return { ok: false, kind: "unconfirmed", message: RX_UNCONFIRMED_MESSAGE };
}

export interface PrintOperation {
  operationId: string;
  prescriptionId: string;
  initiatedAt: string;
  confirmedAt: string | null;
  confirmedCopyCount: number | null;
}

function parsePrintOperation(data: unknown): PrintOperation | null {
  const parsed = z.object({
    operationId: z.uuid(),
    prescriptionId: z.uuid(),
    initiatedAt: z.string(),
    confirmedAt: z.string().nullable(),
    confirmedCopyCount: z.number().int().nullable(),
  }).safeParse(data);
  return parsed.success ? parsed.data : null;
}

function printMessage(message: string): string {
  const m = message.toUpperCase();
  if (m.includes("PRINT_AUTHORITY_REVOKED")) return "Your authority to print this prescription changed. Reload before trying again.";
  if (m.includes("PRINT_CONFIRMATION_CONFLICT")) return "This print was already confirmed with a different copy count. Reload its print record before changing anything.";
  if (m.includes("PRINT_IDEMPOTENCY_CONFLICT") || m.includes("IDEMPOTENCY")) return "That print request no longer matches the one already recorded. Start a new print request.";
  if (m.includes("PRESCRIPTION_FINALIZATION_STATE_INVALID")) return "This finalized prescription could not be verified for printing.";
  if (m.includes("PRESCRIPTION NOT FOUND") || m.includes("NOT AUTHORIZED")) return "You are not currently authorized to print this prescription.";
  return "The print could not be recorded safely. Nothing was confirmed — reload and try again.";
}

export async function initiatePrescriptionPrintAction(input: {
  prescriptionId: string;
  idempotencyKey: string;
}): Promise<{ ok: true; operation: PrintOperation } | { ok: false; message: string }> {
  const parsed = z.object({ prescriptionId: z.uuid(), idempotencyKey: z.string().min(8).max(128) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "That print request could not be read." };

  const ctx = await requireLocationContext();
  const finalized = await getFinalizedPrescription(parsed.data.prescriptionId, ctx.locationId);
  if (!finalized.ok) return { ok: false, message: "This finalized prescription is not available to print." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("initiate_prescription_print", {
    p_prescription_id: parsed.data.prescriptionId,
    p_practice_location_id: finalized.finalized.locationId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return { ok: false, message: printMessage(error.message) };
  const operation = parsePrintOperation(data);
  if (!operation) {
    console.error("[prescriptions] print initiation returned malformed operation", data);
    return { ok: false, message: "The print was not opened because its audit record could not be verified." };
  }
  return { ok: true, operation };
}

export async function confirmPrescriptionPrintAction(input: {
  operationId: string;
  copyCount: number;
}): Promise<{ ok: true; operation: PrintOperation } | { ok: false; message: string }> {
  const parsed = z.object({ operationId: z.uuid(), copyCount: z.number().int().min(1).max(100) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter the number of physical copies that actually printed." };
  await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("confirm_prescription_print", {
    p_operation_id: parsed.data.operationId,
    p_copy_count: parsed.data.copyCount,
  });
  if (error) return { ok: false, message: printMessage(error.message) };
  const operation = parsePrintOperation(data);
  if (!operation) return { ok: false, message: "The print confirmation could not be verified. Do not confirm it again until the page is reloaded." };
  return { ok: true, operation };
}
