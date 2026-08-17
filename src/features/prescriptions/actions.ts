"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { acceptVersion } from "@/features/encounters/version-contract";
import { getMedicineSuggestions, getPrescription } from "./queries";
import { RX_UNCONFIRMED_MESSAGE, translateRxError } from "./errors";
import { medicineInputSchema, type MedicineRow, type Suggestion } from "./schema";

/**
 * Prescription writes.
 *
 * Every one is a Stage 7A RPC. Direct writes are revoked, so nothing here
 * decides authorisation — this file validates input, calls the function, and
 * turns a refusal into a sentence. Nothing here can finalise: Stage 7B is a
 * DRAFT workflow and `finalize_prescription` is not called from anywhere in it.
 */

function safe(action: string, message: string) {
  const t = translateRxError(message);
  if (t.unexpected) {
    // Server-side only — the detail we deliberately do not render.
    console.error(`[prescriptions] ${action} failed`, message);
  }
  return t;
}

export type RxResult =
  | { ok: true; version: number; items: MedicineRow[] }
  | { ok: false; kind: "conflict"; message: string; version: number; items: MedicineRow[] }
  /** The write may have landed and we could not find out. Never a plain error. */
  | { ok: false; kind: "unconfirmed"; message: string }
  | { ok: false; kind: "error"; message: string };

/**
 * Re-read after a mutation.
 *
 * The RPCs return a version, not rows, and positions shift when something is
 * removed — so the list is re-read rather than patched locally. A screen that
 * guesses at the new order disagrees with the record about what the doctor
 * wrote down.
 */
async function reread(prescriptionId: string, locationId: string) {
  const outcome = await getPrescription(prescriptionId, locationId);
  return outcome.ok ? outcome.prescription : null;
}

async function finish(
  action: string,
  prescriptionId: string,
  locationId: string,
  error: { message: string } | null,
  earnedVersion: number | null,
): Promise<RxResult> {
  if (error) {
    const t = safe(action, error.message);

    if (t.kind === "conflict") {
      const current = await reread(prescriptionId, locationId);
      /**
       * The refusal is CERTAIN; only the current state is missing. Reporting a
       * plain error would leave the screen on a stale version, free to retry
       * into the same wall.
       */
      if (!current) {
        return { ok: false, kind: "unconfirmed", message: RX_UNCONFIRMED_MESSAGE };
      }
      return {
        ok: false,
        kind: "conflict",
        message: t.message,
        version: current.version,
        items: current.items,
      };
    }
    return { ok: false, kind: "error", message: t.message };
  }

  /**
   * A version we cannot believe means the write MAY have committed. Same
   * contract the notes editor uses: never a retryable error, because that is
   * what produces a duplicate.
   */
  if (earnedVersion === null) {
    console.error(`[prescriptions] ${action} returned an unusable version`);
    return { ok: false, kind: "unconfirmed", message: RX_UNCONFIRMED_MESSAGE };
  }

  const current = await reread(prescriptionId, locationId);
  if (!current) return { ok: false, kind: "unconfirmed", message: RX_UNCONFIRMED_MESSAGE };

  /**
   * The version we EARNED, checked against what the record now reports. A
   * higher number means somebody else moved it between our write and this
   * read; adopting it silently would hide a real conflict.
   */
  if (current.version !== earnedVersion) {
    return {
      ok: false,
      kind: "conflict",
      message:
        "This prescription changed somewhere else while your change was saving. What you typed is still here.",
      version: current.version,
      items: current.items,
    };
  }

  return { ok: true, version: current.version, items: current.items };
}

export async function openPrescriptionAction(input: {
  encounterId: string;
  replacementReason?: string | null;
}): Promise<{ ok: true; prescriptionId: string } | { ok: false; message: string }> {
  const parsed = z
    .object({ encounterId: z.uuid(), replacementReason: z.string().trim().max(500).nullish() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "That consultation could not be opened." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("open_prescription", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_replacement_reason: parsed.data.replacementReason ?? null,
  });

  if (error) return { ok: false, message: safe("open_prescription", error.message).message };
  if (!data) {
    console.error("[prescriptions] open returned no id");
    return { ok: false, message: "The prescription could not be opened. Try again." };
  }

  revalidatePath(`/consultation/${parsed.data.encounterId}`);
  return { ok: true, prescriptionId: data as string };
}

export async function addMedicineAction(input: unknown): Promise<RxResult> {
  const parsed = medicineInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "error", message: "Give the medicine a name." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { prescriptionId, expectedVersion, patch } = parsed.data;

  const { error } = await supabase.rpc("add_prescription_item", {
    p_prescription_id: prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: expectedVersion,
    p_patch: patch,
  });

  // add returns the new row's id; the version it earns is expectedVersion + 1
  // (ADR 0011 §6c, asserted by db:verify:encounters and db:verify:prescriptions).
  return finish("add_prescription_item", prescriptionId, ctx.locationId, error, expectedVersion + 1);
}

export async function updateMedicineAction(input: unknown): Promise<RxResult> {
  const parsed = medicineInputSchema.extend({ itemId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, kind: "error", message: "That change could not be saved." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { prescriptionId, expectedVersion, itemId, patch } = parsed.data;

  if (Object.keys(patch).length === 0) {
    return { ok: false, kind: "error", message: "Nothing has changed." };
  }

  const { data, error } = await supabase.rpc("update_prescription_item", {
    p_prescription_id: prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: expectedVersion,
    p_item_id: itemId,
    p_patch: patch,
  });

  return finish(
    "update_prescription_item",
    prescriptionId,
    ctx.locationId,
    error,
    acceptVersion(data, expectedVersion),
  );
}

export async function removeMedicineAction(input: {
  prescriptionId: string;
  expectedVersion: number;
  itemId: string;
}): Promise<RxResult> {
  const parsed = z
    .object({ prescriptionId: z.uuid(), expectedVersion: z.number().int().positive(), itemId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, kind: "error", message: "That medicine could not be removed." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("remove_prescription_item", {
    p_prescription_id: parsed.data.prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_item_id: parsed.data.itemId,
  });

  return finish(
    "remove_prescription_item",
    parsed.data.prescriptionId,
    ctx.locationId,
    error,
    acceptVersion(data, parsed.data.expectedVersion),
  );
}

export async function moveMedicineAction(input: {
  prescriptionId: string;
  expectedVersion: number;
  itemId: string;
  toPosition: number;
}): Promise<RxResult> {
  const parsed = z
    .object({
      prescriptionId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      itemId: z.uuid(),
      toPosition: z.number().int().positive(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, kind: "error", message: "That medicine could not be moved." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("move_prescription_item", {
    p_prescription_id: parsed.data.prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_item_id: parsed.data.itemId,
    p_to_position: parsed.data.toPosition,
  });

  return finish(
    "move_prescription_item",
    parsed.data.prescriptionId,
    ctx.locationId,
    error,
    acceptVersion(data, parsed.data.expectedVersion),
  );
}

/** Recover from "we do not know what the prescription holds". */
export async function refreshPrescriptionAction(
  prescriptionId: string,
): Promise<{ ok: true; version: number; items: MedicineRow[] } | { ok: false }> {
  const ctx = await requireLocationContext();
  const current = await reread(prescriptionId, ctx.locationId);
  if (!current) return { ok: false };
  return { ok: true, version: current.version, items: current.items };
}

export async function medicineSuggestionsAction(query: string): Promise<Suggestion[]> {
  await requireLocationContext();
  return getMedicineSuggestions(query);
}
