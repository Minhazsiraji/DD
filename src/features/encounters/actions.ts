"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { getServerState } from "./queries";
import { translateSaveError } from "./errors";
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
       * If the follow-up read also fails we must NOT fall back to reporting a
       * plain error — the save really was rejected for a conflict, and calling
       * it something else would invite the doctor to retry into the same wall.
       */
      if (!current) {
        return {
          ok: false,
          kind: "error",
          message:
            "These notes were saved somewhere else, and the newer version could not be loaded. Your text is still here — reload before saving again.",
        };
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

  const version = Number(data);
  if (!Number.isFinite(version)) {
    console.error("[encounters] save returned a non-numeric version", data);
    return { ok: false, kind: "error", message: "Saved, but the screen is out of step. Reload the consultation." };
  }

  return { ok: true, version, savedAt: new Date().toISOString() };
}
