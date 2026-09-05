"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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
import { getM1DoctorAuthority } from "@/features/patients/m1-context";

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

function missingRpcSignature(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    /could not find the function|function .* does not exist/i.test(error.message ?? "")
  );
}

async function legacyAppointmentPatientId(
  appointmentId: string,
  locationId: string,
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("patient_id")
    .eq("id", appointmentId)
    .eq("practice_location_id", locationId)
    .maybeSingle();

  if (error) {
    console.error("[encounters] legacy appointment patient lookup failed", error.message);
    return null;
  }
  return data?.patient_id ? String(data.patient_id) : null;
}

async function scopedAppointmentIsAvailable(
  appointmentId: string,
  locationId: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("id")
    .eq("id", appointmentId)
    .eq("practice_location_id", locationId)
    .maybeSingle();
  if (error) {
    console.error("[encounters] appointment scope read failed", error.message);
    return false;
  }
  return Boolean(data);
}

/**
 * Appointment-linked entry is deliberately separate from unscheduled entry.
 * The appointment itself is the authority and must already be IN_CONSULTATION.
 */
export async function openAppointmentConsultationAction(input: {
  appointmentId: string;
}): Promise<OpenResult> {
  const parsed = z.object({ appointmentId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "That appointment could not be opened." };

  const ctx = await requireLocationContext();
  if (!(await scopedAppointmentIsAvailable(parsed.data.appointmentId, ctx.locationId))) {
    return { ok: false, message: "That appointment is no longer available at this location." };
  }

  const supabase = await createSupabaseServerClient();
  let result = await supabase.rpc("open_encounter_for_appointment", {
    appointment_key: parsed.data.appointmentId,
  });

  // Preview is still on the pre-cutover application schema. Fall back only
  // when the exact V2 entry point is absent; database refusals remain final.
  if (missingRpcSignature(result.error)) {
    const patientId = await legacyAppointmentPatientId(parsed.data.appointmentId, ctx.locationId);
    if (!patientId) {
      return { ok: false, message: "That appointment is no longer available at this location." };
    }
    result = await supabase.rpc("open_encounter", {
      p_patient_id: patientId,
      p_practice_location_id: ctx.locationId,
      p_appointment_id: parsed.data.appointmentId,
    });
  }

  const { data, error } = result;
  if (error) {
    return { ok: false, message: safeMessage("open appointment encounter", error.message).message };
  }
  if (!data) {
    console.error("[encounters] open_encounter_for_appointment returned no id");
    return { ok: false, message: "The clinical workspace did not open. Try Resume consultation." };
  }

  revalidatePath("/queue");
  revalidatePath("/dashboard");
  return { ok: true, encounterId: data as string };
}

type DraftColumn = "clinical_patient_id" | "patient_id";

async function findExistingUnscheduledDraft(input: {
  patientId: string;
  locationId: string;
  doctorId: string;
}): Promise<{ id: string } | null> {
  const supabase = await createSupabaseServerClient();

  const read = async (patientColumn: DraftColumn) =>
    supabase
      .from("encounters")
      .select("id")
      .eq("owner_doctor_id", input.doctorId)
      .eq("practice_location_id", input.locationId)
      .eq(patientColumn, input.patientId)
      .eq("status", "DRAFT")
      .is("appointment_id", null)
      .maybeSingle();

  // Database V2 first; accepted main keeps patient_id until the later cutover.
  let result = await read("clinical_patient_id");
  if (result.error && /clinical_patient_id|column .* does not exist/i.test(result.error.message)) {
    result = await read("patient_id");
  }
  if (result.error) {
    console.error("[encounters] unscheduled draft lookup failed", result.error.message);
    return null;
  }
  return result.data ? { id: String(result.data.id) } : null;
}

/**
 * Doctor-owned unscheduled entry. No appointment, queue row or token is made.
 * The pre/post reads turn the accepted unique-draft invariant into a safe
 * idempotent user experience, including concurrent double clicks.
 */
export async function openUnscheduledConsultationAction(input: {
  patientId: string;
}): Promise<OpenResult> {
  const parsed = z.object({ patientId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "That patient could not be opened." };

  const authority = await getM1DoctorAuthority();
  if (!authority.canClinical || !authority.doctorId) {
    return { ok: false, message: "Only an authorised doctor can start a consultation." };
  }

  const existing = await findExistingUnscheduledDraft({
    patientId: parsed.data.patientId,
    locationId: authority.locationId,
    doctorId: authority.doctorId,
  });
  if (existing) return { ok: true, encounterId: existing.id };

  const supabase = await createSupabaseServerClient();
  let result = await supabase.rpc("open_encounter", {
    patient_id: parsed.data.patientId,
    location_id: authority.locationId,
  });

  // Accepted V2 is the target contract. The current Preview still exposes the
  // legacy 3-argument function, so use it only when V2's signature is absent.
  if (missingRpcSignature(result.error)) {
    result = await supabase.rpc("open_encounter", {
      p_patient_id: parsed.data.patientId,
      p_practice_location_id: authority.locationId,
      p_appointment_id: null,
    });
  }

  const { data, error } = result;
  if (!error && data) {
    revalidatePath("/dashboard");
    revalidatePath(`/patients/${parsed.data.patientId}`);
    return { ok: true, encounterId: data as string };
  }

  if (error && /ENCOUNTER_DRAFT_ALREADY_EXISTS|unique/i.test(error.message)) {
    const raced = await findExistingUnscheduledDraft({
      patientId: parsed.data.patientId,
      locationId: authority.locationId,
      doctorId: authority.doctorId,
    });
    if (raced) return { ok: true, encounterId: raced.id };
  }

  if (error) return { ok: false, message: safeMessage("open_encounter", error.message).message };
  console.error("[encounters] open_encounter returned no id");
  return { ok: false, message: "The consultation could not be opened. Try again." };
}

/**
 * Save the sections and vitals the doctor changed — and only those.
 *
 * The patch carries just the edited fields, so two people working on one
 * consultation overwrite each other only where they genuinely both typed. A
 * rejected save returns the server's current text so the doctor can decide;
 * nothing is merged for them, and their own text is never touched.
 */
/**
 * Finish the visit.
 *
 * `close_encounter` has existed since Stage 6 and NOTHING CALLED IT. The
 * appointment screen's "Finish consultation" completes the APPOINTMENT — a
 * different record, owned by Stage 4 — so a doctor could write notes, a
 * diagnosis, a prescription, finalise it and print it, and the encounter stayed
 * DRAFT for ever. The patient's timeline then said "Consultation in progress"
 * about a visit that had plainly ended.
 *
 * Deliberately NOT triggered by finalising a prescription. A doctor often signs
 * the prescription and then adds a last line to the notes; closing the visit
 * underneath them would be the software deciding the consultation is over.
 *
 * IDEMPOTENT IN PRACTICE. The version CAS inside `encounter_for_update` refuses
 * the second of two clicks, so a double click cannot close twice or step the
 * version twice — and an encounter that is ALREADY completed is reported as
 * success, because that is what the doctor asked for and what is now true.
 */
export type FinishResult =
  | { ok: true; alreadyClosed: boolean }
  | { ok: false; kind: "conflict" | "error"; message: string };

export async function finishConsultationAction(input: {
  encounterId: string;
  expectedVersion: number;
}): Promise<FinishResult> {
  const parsed = z
    .object({ encounterId: z.uuid(), expectedVersion: z.number().int().positive() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, kind: "error", message: "This consultation could not be finished." };
  }

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  /**
   * `finish_consultation`, not `close_encounter`.
   *
   * The live queue is built from APPOINTMENTS, so closing the encounter alone
   * left the patient pinned to the top of the queue — IN_CONSULTATION sorts
   * first — and the next patient could never be reached. The orchestrator
   * closes the visit and completes the appointment in one transaction, each
   * through the function that owns that lifecycle.
   */
  const { error } = await supabase.rpc("finish_consultation", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
  });

  if (error) {
    /**
     * A version conflict here usually means it is already finished — another
     * tab, or the second half of a double click. Ask the record before calling
     * it a failure: telling a doctor the visit would not close, when it has,
     * invites them to click again.
     */
    const current = await getServerState(parsed.data.encounterId, ctx.locationId);
    if (current && current.status !== "DRAFT") {
      revalidatePath(`/consultation/${parsed.data.encounterId}`);
      return { ok: true, alreadyClosed: true };
    }

    const translated = safeMessage("finish_consultation", error.message);
    return {
      ok: false,
      kind: translated.kind === "conflict" ? "conflict" : "error",
      message: translated.message,
    };
  }

  revalidatePath(`/consultation/${parsed.data.encounterId}`);
  revalidatePath("/queue");
  return { ok: true, alreadyClosed: false };
}

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
