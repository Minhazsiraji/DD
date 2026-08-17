"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { getServerState } from "./queries";
import { translateSaveError } from "./errors";
import {
  CONFLICT_UNLOADABLE_MESSAGE,
  WRITE_UNCONFIRMED_MESSAGE,
  acceptVersion,
} from "./version-contract";
import { saveInputSchema, type SaveInput, type SaveResult } from "./schema";

/**
 * Consultation writes.
 *
 * Both are database RPCs. Direct writes on `encounters` are revoked, so nothing
 * here decides authorisation — this file validates input, calls the function,
 * and turns a refusal into a sentence. The audit row is written inside the
 * transaction by the RPC itself, which is why there is no emitAudit call beside
 * a clinical write (ADR 0007).
 */

function safeMessage(action: string, message: string) {
  const translated = translateSaveError(message);
  if (translated.unexpected) {
    // Server-side only — this is the detail we deliberately do not render.
    console.error(`[encounters] ${action} failed`, message);
  }
  return translated;
}

export type OpenResult =
  | { ok: true; encounterId: string }
  | { ok: false; message: string };

/**
 * Open the consultation for an appointment, or resume the one already open.
 *
 * The appointment must already be IN_CONSULTATION — the doctor starts it from
 * the queue, and this deliberately does not do that for them. One way to move a
 * patient through their day (ADR 0009); the encounter records what happened in
 * it, and never drives it.
 */
export async function openConsultationAction(input: {
  patientId: string;
  appointmentId: string | null;
}): Promise<OpenResult> {
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("open_encounter", {
    p_patient_id: input.patientId,
    p_practice_location_id: ctx.locationId,
    p_appointment_id: input.appointmentId,
  });

  if (error) return { ok: false, message: safeMessage("open_encounter", error.message).message };
  if (!data) {
    console.error("[encounters] open_encounter returned no id");
    return { ok: false, message: "The consultation could not be opened. Try again." };
  }

  revalidatePath("/queue");
  revalidatePath("/dashboard");
  return { ok: true, encounterId: data as string };
}

/**
 * Save the sections and vitals the doctor changed — and only those.
 *
 * The patch carries just the edited fields, so two people working on one
 * consultation overwrite each other only where they genuinely both typed. A
 * rejected save returns the server's current text so the doctor can decide;
 * nothing is merged for them, and their own text is never touched.
 */
export async function saveConsultationAction(input: SaveInput): Promise<SaveResult> {
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Those values could not be saved.";
    return { ok: false, kind: "error", message: first };
  }

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("save_encounter_sections", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_patch: parsed.data.patch,
  });

  if (error) {
    const translated = safeMessage("save_encounter_sections", error.message);

    if (translated.kind === "conflict") {
      const current = await getServerState(parsed.data.encounterId, ctx.locationId);
      /**
       * The refusal is CERTAIN; only the newer version is missing. Reporting a
       * plain error would leave the screen on a stale version and free to try
       * again, and every attempt can only be refused until the state loads.
       */
      if (!current) {
        return { ok: false, kind: "conflict-unloadable", message: CONFLICT_UNLOADABLE_MESSAGE };
      }
      return {
        ok: false,
        kind: "conflict",
        version: current.version,
        values: current.values,
        message: translated.message,
      };
    }

    return { ok: false, kind: "error", message: translated.message };
  }

  /**
   * The SAME contract the list mutations use, and for the same reason.
   *
   * `Number(data)` turned null into 0, accepted fractions and negatives, and
   * waved through a jump of +3 — and the coordinator would then carry a
   * version it never earned into the next write. The version is shared, so
   * validating it on only one side left the defect fully alive on the other.
   *
   * An unusable answer means the save MAY already have committed, so it is
   * reported as unconfirmed rather than as a retryable error.
   */
  const version = acceptVersion(data, parsed.data.expectedVersion);
  if (version === null) {
    console.error("[encounters] save returned an unusable version", data);
    return { ok: false, kind: "write-unconfirmed", message: WRITE_UNCONFIRMED_MESSAGE };
  }

  return { ok: true, version, savedAt: new Date().toISOString() };
}
