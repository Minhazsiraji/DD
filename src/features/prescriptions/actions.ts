"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { acceptVersion } from "@/features/encounters/version-contract";
import { getMedicineSuggestions, getPrescription, getReviewBundle } from "./queries";
import {
  RX_ADVANCED_MESSAGE,
  RX_CONFLICT_UNLOADABLE_MESSAGE,
  RX_UNCONFIRMED_MESSAGE,
  translateRxError,
} from "./errors";
import { classifyWrite } from "./recovery";
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

/**
 * What became of one write.
 *
 * `ok: true` means BOTH that the write committed AND that the screen is now in
 * step with the record — it is the only outcome that may carry on writing. Every
 * other kind answers a different question, and the caller must treat them
 * differently:
 *
 *   conflict             refused, and here is what the record now holds
 *   conflict-unloadable  refused, and we could not load what it holds
 *   write-confirmed-advanced   COMMITTED, then somebody else moved the record
 *   unconfirmed          we cannot tell whether it committed
 *   error                refused for a reason the doctor can act on
 *
 * The two "refused" kinds preserve the doctor's typed text, because it is their
 * only copy. The two kinds where the write may or did land close the form,
 * because resubmitting is how a medicine gets onto a prescription twice.
 */
export type RxResult =
  | { ok: true; version: number; items: MedicineRow[] }
  | { ok: false; kind: "conflict"; message: string; version: number; items: MedicineRow[] }
  /** Definitely refused. Nothing to adopt — preserve the screen exactly. */
  | { ok: false; kind: "conflict-unloadable"; message: string }
  /** Definitely committed, and the record moved again before we read it back. */
  | {
      ok: false;
      kind: "write-confirmed-advanced";
      message: string;
      version: number;
      items: MedicineRow[];
    }
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

/**
 * Turn one RPC answer into an outcome the screen can act on.
 *
 * The decision itself is `classifyWrite` — pure, tabulated and tested away from
 * a database. This function's only job is to gather the three facts it needs
 * and attach the right sentence, so the classification cannot drift into
 * branches nobody can see all of at once.
 */
async function finish(
  action: string,
  prescriptionId: string,
  locationId: string,
  error: { message: string } | null,
  earnedVersion: number | null,
): Promise<RxResult> {
  // An ordinary refusal: nothing was written and there is nothing to recover.
  const translated = error ? safe(action, error.message) : null;
  if (translated && translated.kind !== "conflict") {
    return { ok: false, kind: "error", message: translated.message };
  }
  const refused = translated !== null;

  if (!refused && earnedVersion === null) {
    console.error(`[prescriptions] ${action} returned an unusable version`);
  }

  /**
   * Read back even when refused: knowing what the record now holds is the
   * difference between the doctor being able to settle the conflict here and
   * being sent away to reload.
   */
  const current = await reread(prescriptionId, locationId);
  const kind = classifyWrite({
    refused,
    earnedVersion,
    currentVersion: current?.version ?? null,
  });

  switch (kind) {
    case "ok":
      return { ok: true, version: current!.version, items: current!.items };

    case "conflict":
      return {
        ok: false,
        kind: "conflict",
        message: translated!.message,
        version: current!.version,
        items: current!.items,
      };

    case "conflict-unloadable":
      return { ok: false, kind: "conflict-unloadable", message: RX_CONFLICT_UNLOADABLE_MESSAGE };

    case "write-confirmed-advanced":
      return {
        ok: false,
        kind: "write-confirmed-advanced",
        message: RX_ADVANCED_MESSAGE,
        version: current!.version,
        items: current!.items,
      };

    default:
      if (current && earnedVersion !== null && current.version < earnedVersion) {
        console.error(
          `[prescriptions] ${action} earned v${earnedVersion} but the record reports v${current.version}`,
        );
      }
      return { ok: false, kind: "unconfirmed", message: RX_UNCONFIRMED_MESSAGE };
  }
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

/**
 * Rebuild the canonical review bundle, usually because the layout changed.
 *
 * Returns the SERVER's bundle verbatim. The client never assembles one, never
 * edits one, and never sends one back — Stage 7A dropped the overload that
 * accepted browser-supplied snapshot JSON, and nothing in 7C may reintroduce
 * the shape of that mistake.
 *
 * Note what this does NOT do: it cannot finalise. Stage 7C-1 has no path to
 * `finalize_prescription` from anywhere in the application.
 */
export async function refreshReviewAction(input: {
  prescriptionId: string;
  templateId: string | null;
}): Promise<{ ok: true; review: unknown } | { ok: false; message: string }> {
  const parsed = z
    .object({ prescriptionId: z.uuid(), templateId: z.uuid().nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "That prescription could not be reviewed." };

  const ctx = await requireLocationContext();
  const outcome = await getReviewBundle(
    parsed.data.prescriptionId,
    ctx.locationId,
    parsed.data.templateId,
  );

  if (outcome.ok) return { ok: true, review: outcome.review };

  switch (outcome.reason) {
    case "template-unavailable":
      return { ok: false, message: "That layout is not available for this prescription." };
    case "not-found":
      return {
        ok: false,
        message: "This prescription is no longer available at your current location.",
      };
    case "unsupported-schema":
      return {
        ok: false,
        message: "This prescription needs a newer version of the app to display safely.",
      };
    default:
      return { ok: false, message: "The prescription could not be loaded. Try again in a moment." };
  }
}

export async function medicineSuggestionsAction(query: string): Promise<Suggestion[]> {
  await requireLocationContext();
  return getMedicineSuggestions(query);
}
