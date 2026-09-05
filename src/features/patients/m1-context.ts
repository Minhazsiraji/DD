import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { getQueue } from "@/features/queue/queries";
import type { AppointmentStatus } from "@/features/appointments/schema";
import { getCurrentDoctorId } from "./queries";

export type M1PatientState =
  | "IN_CONSULTATION"
  | "ARRIVED"
  | "CONFIRMED"
  | "SCHEDULED"
  | "COMPLETED"
  | "NONE";

export interface PatientAppointmentContext {
  state: M1PatientState;
  appointmentId: string | null;
  tokenNumber: number | null;
  scheduledFor: string | null;
  sessionDate: string | null;
}

export interface M1DoctorAuthority {
  doctorId: string | null;
  canClinical: boolean;
  canMarkArrived: boolean;
  locationId: string;
  locationName: string;
  timeZone: string | null;
  localDate: string | null;
  roles: readonly string[];
}

const NONE: PatientAppointmentContext = {
  state: "NONE",
  appointmentId: null,
  tokenNumber: null,
  scheduledFor: null,
  sessionDate: null,
};

function missingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    /could not find the function|function .* does not exist/i.test(error.message ?? "")
  );
}

export function localDateInTimeZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(now);
}

export async function getLocationLocalDate(locationId: string): Promise<{
  timeZone: string;
  localDate: string;
} | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("practice_locations")
    .select("timezone")
    .eq("id", locationId)
    .maybeSingle();

  if (error || !data?.timezone) {
    console.error("[m1] location timezone read failed", error?.message ?? "timezone unavailable");
    return null;
  }
  const timeZone = data.timezone as string;
  return { timeZone, localDate: localDateInTimeZone(timeZone) };
}

/**
 * Server-derived clinical authority for M1 affordances.
 *
 * Database V2 supplies capability + active-location checks. The accepted main
 * frontend still has the pre-cutover role model, so an explicitly missing V2
 * helper falls back to the current-main DOCTOR role for PREVIEW compatibility.
 * Any real RPC error fails closed, and every clinical mutation is still
 * re-authorised inside its database RPC.
 */
export const getM1DoctorAuthority = cache(async function getM1DoctorAuthority(): Promise<M1DoctorAuthority> {
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const [locationDate, doctorId] = await Promise.all([
    getLocationLocalDate(ctx.locationId),
    getCurrentDoctorId(),
  ]);
  const timeZone = locationDate?.timeZone ?? null;
  const localDate = locationDate?.localDate ?? null;

  const roleAllowsDoctor = ctx.roles.includes("DOCTOR");
  let capability = false;
  let activeAtLocation = false;

  if (doctorId && roleAllowsDoctor) {
    const [capabilityResult, activeResult] = await Promise.all([
      supabase.rpc("has_capability", {
        subject_profile_id: ctx.user.id,
        requested: "DOCTOR",
      }),
      supabase.rpc("doctor_active_at", {
        location_key: ctx.locationId,
        doctor_key: doctorId,
      }),
    ]);

    capability = capabilityResult.error
      ? missingRpc(capabilityResult.error)
        ? roleAllowsDoctor
        : false
      : capabilityResult.data === true;

    activeAtLocation = activeResult.error
      ? missingRpc(activeResult.error)
        ? roleAllowsDoctor
        : false
      : activeResult.data === true;
  }

  const canClinical = Boolean(doctorId && roleAllowsDoctor && capability && activeAtLocation);

  return {
    doctorId,
    canClinical,
    canMarkArrived: canClinical,
    locationId: ctx.locationId,
    locationName: ctx.locationName,
    timeZone,
    localDate,
    roles: ctx.roles,
  };
});

type AppointmentContextRow = {
  id: string;
  patientId: string;
  status: AppointmentStatus;
  scheduledFor: string;
  sessionDate: string;
};

async function readAppointmentRows(
  patientIds: readonly string[],
  authority: M1DoctorAuthority,
): Promise<AppointmentContextRow[] | null> {
  if (!authority.doctorId || patientIds.length === 0) return [];
  const localDate = authority.localDate;
  if (!localDate) return null;
  const supabase = await createSupabaseServerClient();

  const run = async (patientColumn: "clinical_patient_id" | "patient_id") => {
    const result = await supabase
      .from("appointments")
      .select(`id,status,scheduled_for,session_date,${patientColumn}`)
      .eq("owner_doctor_id", authority.doctorId!)
      .eq("practice_location_id", authority.locationId)
      .eq("session_date", localDate)
      .in(patientColumn, [...patientIds]);
    return { ...result, patientColumn };
  };

  // V2 first. Accepted main still uses patient_id until the later DB cutover.
  let result = await run("clinical_patient_id");
  if (result.error && /clinical_patient_id|column .* does not exist/i.test(result.error.message)) {
    result = await run("patient_id");
  }
  if (result.error) {
    console.error("[m1] appointment context read failed", result.error.message);
    return null;
  }

  return ((result.data as unknown as Record<string, unknown>[]) ?? []).map((row) => ({
    id: String(row.id),
    patientId: String(row[result.patientColumn]),
    status: row.status as AppointmentStatus,
    scheduledFor: String(row.scheduled_for),
    sessionDate: String(row.session_date),
  }));
}

const STATE_PRIORITY: Record<M1PatientState, number> = {
  IN_CONSULTATION: 0,
  ARRIVED: 1,
  CONFIRMED: 2,
  SCHEDULED: 3,
  COMPLETED: 4,
  NONE: 5,
};

/** One batched current-location/current-day context read for up to many patients. */
export async function getPatientAppointmentContexts(
  patientIds: readonly string[],
  authority: M1DoctorAuthority,
): Promise<Map<string, PatientAppointmentContext> | null> {
  const unique = [...new Set(patientIds)].filter(Boolean);
  const localDate = authority.localDate;
  if (authority.doctorId && !localDate) return null;
  const rows = await readAppointmentRows(unique, authority);
  if (!rows) return null;

  const queue = authority.doctorId
    ? await getQueue(authority.locationId, localDate!)
    : { ok: true as const, rows: [] };
  if (!queue.ok) {
    console.error("[m1] queue context read failed", queue.reason);
    return null;
  }
  const tokenByAppointment = new Map(
    queue.rows.map((row) => [row.appointmentId, row.tokenNumber] as const),
  );

  const byPatient = new Map<string, PatientAppointmentContext>();
  for (const patientId of unique) byPatient.set(patientId, { ...NONE });

  for (const row of rows) {
    if (row.status === "CANCELLED" || row.status === "NO_SHOW") continue;
    const state = row.status as M1PatientState;
    if (!(state in STATE_PRIORITY)) continue;
    const current = byPatient.get(row.patientId) ?? { ...NONE };
    const currentPriority = STATE_PRIORITY[current.state];
    const nextPriority = STATE_PRIORITY[state];
    if (
      nextPriority < currentPriority ||
      (nextPriority === currentPriority &&
        (current.scheduledFor === null || row.scheduledFor > current.scheduledFor))
    ) {
      byPatient.set(row.patientId, {
        state,
        appointmentId: row.id,
        tokenNumber: tokenByAppointment.get(row.id) ?? null,
        scheduledFor: row.scheduledFor,
        sessionDate: row.sessionDate,
      });
    }
  }

  return byPatient;
}
