import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, requireLocationContext } from "@/lib/auth/session";
import type { AppointmentStatus, VisitType, CancellationReason } from "./schema";

/**
 * Appointment reads.
 *
 * Reads still go through RLS — only WRITES were moved behind RPCs. So there is
 * no owner filter to remember here: Postgres applies "your own appointments
 * anywhere, or any appointment at a location where you run the desk".
 */

export interface AppointmentRow {
  id: string;
  scheduledFor: string;
  sessionDate: string;
  durationMinutes: number;
  visitType: VisitType;
  status: AppointmentStatus;
  reason: string | null;
  tokenNumber: number | null;
  cancellationReason: CancellationReason | null;
  cancellationNote: string | null;
  rescheduledFromId: string | null;
  practiceLocationId: string;
  locationName: string | null;
  ownerDoctorId: string;
  doctorName: string | null;
  patientId: string;
  patientName: string;
  patientNumber: string;
  patientPhone: string | null;
}

const COLUMNS =
  "id, scheduled_for, session_date, duration_minutes, visit_type, status, reason, " +
  "token_number, cancellation_reason, cancellation_note, rescheduled_from_id, " +
  "practice_location_id, owner_doctor_id, " +
  "practice_locations(name), " +
  "patients(id, full_name, patient_number, phone), " +
  "doctor_profiles(id, profiles(full_name))";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRow(r: any): AppointmentRow {
  const doctorProfile = Array.isArray(r.doctor_profiles) ? r.doctor_profiles[0] : r.doctor_profiles;
  const doctorUser = Array.isArray(doctorProfile?.profiles)
    ? doctorProfile.profiles[0]
    : doctorProfile?.profiles;
  const patient = Array.isArray(r.patients) ? r.patients[0] : r.patients;
  const location = Array.isArray(r.practice_locations)
    ? r.practice_locations[0]
    : r.practice_locations;

  return {
    id: r.id,
    scheduledFor: r.scheduled_for,
    sessionDate: r.session_date,
    durationMinutes: r.duration_minutes,
    visitType: r.visit_type,
    status: r.status,
    reason: r.reason ?? null,
    tokenNumber: r.token_number ?? null,
    cancellationReason: r.cancellation_reason ?? null,
    cancellationNote: r.cancellation_note ?? null,
    rescheduledFromId: r.rescheduled_from_id ?? null,
    practiceLocationId: r.practice_location_id,
    locationName: location?.name ?? null,
    ownerDoctorId: r.owner_doctor_id,
    doctorName: doctorUser?.full_name ?? null,
    patientId: patient?.id ?? "",
    patientName: patient?.full_name ?? "Unknown patient",
    patientNumber: patient?.patient_number ?? "",
    patientPhone: patient?.phone ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fail-closed, like patient search. An empty day and a broken query look
 * identical on screen, and "no appointments" is exactly the answer that makes a
 * receptionist send someone home.
 */
export type DayOutcome =
  | { ok: true; appointments: AppointmentRow[] }
  | { ok: false; reason: string };

export async function getAppointmentsForDay(
  sessionDate: string,
  locationId?: string,
): Promise<DayOutcome> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("appointments")
    .select(COLUMNS)
    .eq("session_date", sessionDate)
    .order("scheduled_for", { ascending: true });

  if (locationId) query = query.eq("practice_location_id", locationId);

  const { data, error } = await query;

  if (error) {
    console.error("[appointments] day query failed", error.message);
    return { ok: false, reason: error.message };
  }
  return { ok: true, appointments: (data ?? []).map(toRow) };
}

export async function getAppointment(id: string): Promise<AppointmentRow | null> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("appointments")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[appointments] detail query failed", error.message);
    return null;
  }
  return data ? toRow(data) : null;
}

export interface AppointmentEventRow {
  id: string;
  eventType: string;
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus | null;
  note: string | null;
  createdAt: string;
  actorName: string | null;
}

/** Ordered by `seq`, the authoritative order — see the schema comment. */
export async function getAppointmentHistory(
  appointmentId: string,
): Promise<AppointmentEventRow[]> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("appointment_events")
    .select("id, event_type, from_status, to_status, note, created_at, profiles(full_name)")
    .eq("appointment_id", appointmentId)
    .order("seq", { ascending: true });

  if (error) {
    console.error("[appointments] history query failed", error.message);
    return [];
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => {
    const actor = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return {
      id: r.id,
      eventType: r.event_type,
      fromStatus: r.from_status ?? null,
      toStatus: r.to_status ?? null,
      note: r.note ?? null,
      createdAt: r.created_at,
      actorName: actor?.full_name ?? null,
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface BookableDoctor {
  doctorId: string;
  userId: string;
  fullName: string;
}

/**
 * Doctors practising at a location.
 *
 * Via RPC because reception holds `location_member: NONE` and cannot read
 * membership rows — the function is SECURITY DEFINER and returns names only.
 */
export async function getDoctorsAtLocation(locationId: string): Promise<BookableDoctor[]> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("doctors_at_location", {
    target_location: locationId,
  });

  if (error) {
    console.error("[appointments] doctors_at_location failed", error.message);
    return [];
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data as any[]) ?? []).map((d) => ({
    doctorId: d.doctor_id,
    userId: d.user_id,
    fullName: d.full_name,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface BookablePatient {
  id: string;
  fullName: string;
  patientNumber: string;
  phone: string | null;
  ownerDoctorId: string;
}

/**
 * Patients this user may book, matched on name or phone.
 *
 * RLS scopes it: a doctor sees their own repository, reception sees only
 * patients linked to their location. A doctor's chamber-only patients therefore
 * never appear at the hospital desk — the same rule the booking RPC re-checks.
 */
export type PatientSearchOutcome =
  | { ok: true; patients: BookablePatient[] }
  | { ok: false; reason: string };

export async function searchBookablePatients(
  term: string,
  ownerDoctorId?: string,
): Promise<PatientSearchOutcome> {
  await requireUser();
  const trimmed = term.trim();
  if (trimmed.length < 2) return { ok: true, patients: [] };

  const supabase = await createSupabaseServerClient();
  const escaped = trimmed.replace(/[%_,()]/g, " ").trim();
  if (!escaped) return { ok: true, patients: [] };

  let query = supabase
    .from("patients")
    .select("id, full_name, patient_number, phone, owner_doctor_id")
    .or(
      `full_name.ilike.%${escaped}%,name_normalized.ilike.%${escaped.toLowerCase()}%,` +
        `phone.ilike.%${escaped}%,patient_number.ilike.%${escaped}%`,
    )
    .limit(20);

  if (ownerDoctorId) query = query.eq("owner_doctor_id", ownerDoctorId);

  const { data, error } = await query;

  if (error) {
    console.error("[appointments] patient search failed", error.message);
    return { ok: false, reason: error.message };
  }

  return {
    ok: true,
    patients: (data ?? []).map((p) => ({
      id: p.id as string,
      fullName: p.full_name as string,
      patientNumber: p.patient_number as string,
      phone: (p.phone as string | null) ?? null,
      ownerDoctorId: p.owner_doctor_id as string,
    })),
  };
}

/** Counts for the dashboard, for the active location's clinic day. */
export interface DayCounts {
  total: number;
  waiting: number;
  inConsultation: number;
  completed: number;
  cancelled: number;
}

export type DayCountsOutcome =
  | { ok: true; counts: DayCounts }
  | { ok: false; reason: string };

/**
 * Counts for the dashboard.
 *
 * Returns an outcome, NOT zeros. Rendering "0 appointments" after a failed read
 * tells a doctor their day is empty when the truth is that we could not find
 * out — and that is the version they would act on.
 */
export async function getDayCounts(
  sessionDate: string,
  /**
   * Narrow to one doctor's own appointments.
   *
   * At a shared hospital the location's totals include colleagues' patients.
   * Presenting those to a doctor as "your day" is a cross-doctor count, so the
   * dashboard passes their own id; reception passes nothing and sees the desk's
   * view of the whole location, which is what they are there to run.
   */
  ownerDoctorId?: string | null,
): Promise<DayCountsOutcome> {
  const ctx = await requireLocationContext();
  const outcome = await getAppointmentsForDay(sessionDate, ctx.locationId);

  if (!outcome.ok) return { ok: false, reason: outcome.reason };

  const a = ownerDoctorId
    ? outcome.appointments.filter((x) => x.ownerDoctorId === ownerDoctorId)
    : outcome.appointments;
  return {
    ok: true,
    counts: {
      total: a.filter((x) => x.status !== "CANCELLED").length,
      waiting: a.filter((x) => x.status === "ARRIVED").length,
      inConsultation: a.filter((x) => x.status === "IN_CONSULTATION").length,
      completed: a.filter((x) => x.status === "COMPLETED").length,
      cancelled: a.filter((x) => x.status === "CANCELLED").length,
    },
  };
}
