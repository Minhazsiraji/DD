"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, requireLocationContext } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import { normalizeName, normalizePhone } from "@/features/patients/identity";
import { clinicToday } from "@/features/patients/queries";
import { searchBookablePatients } from "./queries";
import {
  bookingSchema,
  rescheduleSchema,
  statusChangeSchema,
  type AppointmentActionState,
} from "./schema";

/**
 * Appointment writes.
 *
 * Every one goes through a database RPC — direct INSERT/UPDATE on appointments
 * was revoked precisely so these functions cannot be bypassed. Nothing here
 * decides authorisation; it validates input, calls the RPC, and translates the
 * database's refusal into a sentence.
 */

const empty = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  }
  return out;
}

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

/**
 * Turn "2026-09-01T15:30" as typed into an instant, using the LOCATION's
 * timezone rather than the server's.
 *
 * `new Date("2026-09-01T15:30")` resolves in the runtime's zone — on Vercel
 * that is UTC, so a 3:30pm Dhaka slot would be stored as 9:30pm Dhaka. The
 * offset comes from the location itself.
 */
async function toInstant(locationId: string, localValue: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("local_time_to_instant", {
    target_location: locationId,
    local_value: localValue,
  });
  if (error) {
    console.error("[appointments] local_time_to_instant failed", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/**
 * Patient search for the booking panel.
 *
 * A Server Action rather than a route handler so the client component can call
 * it directly; RLS scopes the results, so reception never sees a doctor's
 * chamber-only patients here.
 */
export async function searchPatientsAction(term: string, ownerDoctorId?: string) {
  return searchBookablePatients(term, ownerDoctorId);
}

export async function bookAppointmentAction(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const parsed = bookingSchema.safeParse({
    patientId: formData.get("patientId"),
    ownerDoctorId: formData.get("ownerDoctorId"),
    scheduledFor: formData.get("scheduledFor"),
    durationMinutes: formData.get("durationMinutes") || 15,
    visitType: formData.get("visitType") ?? "NEW",
    reason: formData.get("reason") ?? "",
  });

  if (!parsed.success) {
    return { ok: false, values: echo(formData), fieldErrors: fieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const instant = await toInstant(ctx.locationId, v.scheduledFor);
  if (!instant) {
    return { ok: false, values: echo(formData), message: "Could not read that date and time." };
  }

  const { data, error } = await supabase.rpc("create_appointment", {
    p_owner_doctor_id: v.ownerDoctorId,
    p_practice_location_id: ctx.locationId,
    p_patient_id: v.patientId,
    p_scheduled_for: instant,
    p_duration_minutes: v.durationMinutes,
    p_visit_type: v.visitType,
    p_reason: empty(formData.get("reason")),
  });

  if (error || !data) {
    return {
      ok: false,
      values: echo(formData),
      message: `Could not book it: ${error?.message ?? "unknown error"}`,
    };
  }

  await emitAudit({
    action: "appointment.created",
    resourceType: "appointment",
    resourceId: data as string,
    locationId: ctx.locationId,
    actorId: user.id,
    meta: { visitType: v.visitType, forDoctor: v.ownerDoctorId },
  });

  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  revalidatePath(`/patients/${v.patientId}`);

  return { ok: true, message: "Appointment booked.", appointmentId: data as string };
}

export async function changeStatusAction(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const parsed = statusChangeSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    toStatus: formData.get("toStatus"),
    reason: formData.get("reason") || undefined,
    note: formData.get("note") ?? "",
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error), message: "Check the form." };
  }
  const v = parsed.data;

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("set_appointment_status", {
    p_appointment_id: v.appointmentId,
    p_to_status: v.toStatus,
    p_reason: v.reason ?? null,
    p_note: empty(formData.get("note")),
  });

  if (error) {
    return { ok: false, message: translate(error.message) };
  }

  await emitAudit({
    action: "appointment.status_changed",
    resourceType: "appointment",
    resourceId: v.appointmentId,
    locationId: ctx.locationId,
    actorId: user.id,
    meta: { to: v.toStatus, reason: v.reason ?? null },
  });

  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  return { ok: true, message: "Updated.", appointmentId: v.appointmentId };
}

export async function rescheduleAction(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const parsed = rescheduleSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    scheduledFor: formData.get("scheduledFor"),
    durationMinutes: formData.get("durationMinutes") || undefined,
    note: formData.get("note") ?? "",
  });

  if (!parsed.success) {
    return { ok: false, values: echo(formData), fieldErrors: fieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const instant = await toInstant(ctx.locationId, v.scheduledFor);
  if (!instant) {
    return { ok: false, values: echo(formData), message: "Could not read that date and time." };
  }

  const { data, error } = await supabase.rpc("reschedule_appointment", {
    p_appointment_id: v.appointmentId,
    p_scheduled_for: instant,
    p_duration_minutes: v.durationMinutes ?? null,
    p_note: empty(formData.get("note")),
  });

  if (error || !data) {
    return {
      ok: false,
      values: echo(formData),
      message: translate(error?.message ?? "unknown error"),
    };
  }

  await emitAudit({
    action: "appointment.rescheduled",
    resourceType: "appointment",
    resourceId: data as string,
    locationId: ctx.locationId,
    actorId: user.id,
    meta: { from: v.appointmentId },
  });

  revalidatePath("/appointments");
  revalidatePath("/dashboard");
  return { ok: true, message: "Moved to the new time.", appointmentId: data as string };
}

/**
 * Reception registers a walk-in and books them in one go (ADR 0008).
 *
 * Registration goes through register_patient_for_doctor, which establishes
 * ownership from membership rather than the payload. Reception writes
 * demographics only — no conditions, medications, alerts or notes.
 */
const walkInSchema = z.object({
  ownerDoctorId: z.uuid("Choose the doctor this patient is here to see"),
  fullName: z.string().trim().min(2, "Enter the patient's name").max(120),
  approxAgeYears: z.coerce.number().int().min(0).max(130).optional(),
  sex: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  district: z.string().trim().max(120).optional().or(z.literal("")),
});

export interface WalkInState extends AppointmentActionState {
  patientId?: string;
  patientNumber?: string;
  /** Carried back so the booking step can name the patient it just created. */
  patientName?: string;
}

export async function registerWalkInAction(
  _prev: WalkInState,
  formData: FormData,
): Promise<WalkInState> {
  const parsed = walkInSchema.safeParse({
    ownerDoctorId: formData.get("ownerDoctorId"),
    fullName: formData.get("fullName"),
    approxAgeYears: formData.get("approxAgeYears") || undefined,
    sex: formData.get("sex") ?? "UNKNOWN",
    phone: formData.get("phone") ?? "",
    district: formData.get("district") ?? "",
  });

  if (!parsed.success) {
    return { ok: false, values: echo(formData), fieldErrors: fieldErrors(parsed.error) };
  }
  const v = parsed.data;

  // Authentication is still required; the identity itself is not needed here
  // because the RPC reads auth.uid() and audits the caller itself.
  await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const today = clinicToday();

  const { data, error } = await supabase
    .rpc("register_patient_for_doctor", {
      p_owner_doctor_id: v.ownerDoctorId,
      p_practice_location_id: ctx.locationId,
      p_full_name: v.fullName,
      p_name_normalized: normalizeName(v.fullName),
      p_dob: null,
      p_dob_precision: "AGE_ONLY",
      p_approx_age_years: v.approxAgeYears ?? null,
      p_age_recorded_on: today,
      p_sex: v.sex,
      p_phone: empty(formData.get("phone")),
      p_phone_normalized: normalizePhone(String(formData.get("phone") ?? "")),
      p_email: null,
      p_address: null,
      p_district: empty(formData.get("district")),
    })
    .single();

  const created = data as { patient_id: string; patient_number: string } | null;

  if (error || !created?.patient_id) {
    return {
      ok: false,
      values: echo(formData),
      message: translate(error?.message ?? "unknown error"),
    };
  }

  // The RPC audits itself inside the transaction — see ADR 0008. Nothing to
  // add here, and a second emitAudit would double-count the registration.

  revalidatePath("/appointments");
  revalidatePath("/patients");

  return {
    ok: true,
    message: `${v.fullName} registered as ${created.patient_number}.`,
    patientId: created.patient_id,
    patientNumber: created.patient_number,
    patientName: v.fullName,
    values: echo(formData),
  };
}

/**
 * The database speaks in constraint language. Doctors and receptionists should
 * not have to.
 */
function translate(message: string): string {
  const m = message.toLowerCase();

  if (m.includes("cannot move an appointment from")) {
    return "That change is not possible from the appointment's current state — reload and try again.";
  }
  if (m.includes("a cancellation needs a reason")) {
    return "Choose a reason for the cancellation.";
  }
  if (m.includes("already completed") || m.includes("already cancelled") || m.includes("already no_show")) {
    return "This appointment is already finished, so it cannot be moved.";
  }
  if (m.includes("appointment not found")) {
    return "That appointment is no longer available to you.";
  }
  if (m.includes("not on file at this location")) {
    return "That patient is not on file at this location.";
  }
  if (m.includes("belongs to a different doctor")) {
    return "That patient belongs to a different doctor.";
  }
  if (m.includes("does not practise at this location")) {
    return "That doctor does not practise here.";
  }
  if (m.includes("front desk")) {
    return "You do not run the front desk at this location.";
  }
  if (m.includes("appointments_token_per_session")) {
    return "Two check-ins collided. Try again — the patient will get the next token.";
  }
  return `Could not complete that: ${message}`;
}
