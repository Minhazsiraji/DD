import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getM1DoctorAuthority, localDateInTimeZone } from "@/features/patients/m1-context";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/features/appointments/schema";
import { analyticsDateRange } from "./period";
import type { AnalyticsPeriod } from "./doctor-analytics-types";

export { ANALYTICS_PERIODS, type AnalyticsPeriod } from "./doctor-analytics-types";

export interface DoctorAnalytics {
  period: AnalyticsPeriod;
  startDate: string;
  endDateInclusive: string;
  locationName: string;
  timeZone: string;
  encounters: number;
  completedEncounters: number;
  appointments: number;
  finalizedPrescriptions: number;
  followUps: number;
  queueEntries: number;
  investigationOrders: number;
  appointmentStatuses: readonly { status: AppointmentStatus; count: number }[];
  topDiagnoses: readonly { label: string; count: number }[];
}

export type DoctorAnalyticsOutcome =
  | { ok: true; analytics: DoctorAnalytics }
  | { ok: false; reason: "doctor-required" | "unavailable" };

function inLocalRange(
  instant: string | null,
  timeZone: string,
  startDate: string,
  endDateExclusive: string,
): boolean {
  if (!instant) return false;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return false;
  const localDate = localDateInTimeZone(timeZone, parsed);
  return localDate >= startDate && localDate < endDateExclusive;
}

function wideUtcBounds(startDate: string, endDateExclusive: string) {
  // IANA offsets range from UTC-12 through UTC+14. Fetch that harmlessly wider
  // window, then apply the exact chamber-local calendar filter in memory.
  return {
    from: new Date(Date.parse(`${startDate}T00:00:00Z`) - 14 * 60 * 60 * 1000).toISOString(),
    to: new Date(Date.parse(`${endDateExclusive}T00:00:00Z`) + 12 * 60 * 60 * 1000).toISOString(),
  };
}

function chunks<T>(values: readonly T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function getDoctorAnalytics(period: AnalyticsPeriod): Promise<DoctorAnalyticsOutcome> {
  const authority = await getM1DoctorAuthority();
  if (!authority.canClinical || !authority.doctorId || !authority.localDate) {
    return { ok: false, reason: "doctor-required" };
  }

  const timeZone = authority.timeZone ?? "Asia/Dhaka";
  const { startDate, endDateExclusive, endDateInclusive } = analyticsDateRange(
    authority.localDate,
    period,
  );
  const utc = wideUtcBounds(startDate, endDateExclusive);
  const supabase = await createSupabaseServerClient();

  const [appointmentResult, encounterResult, finalizedResult] = await Promise.all([
    supabase
      .from("appointments")
      .select("id,status,visit_type,session_date")
      .eq("owner_doctor_id", authority.doctorId)
      .eq("practice_location_id", authority.locationId)
      .gte("session_date", startDate)
      .lt("session_date", endDateExclusive),
    supabase
      .from("encounters")
      .select("id,status,started_at,completed_at")
      .eq("owner_doctor_id", authority.doctorId)
      .eq("practice_location_id", authority.locationId)
      .gte("started_at", utc.from)
      .lt("started_at", utc.to),
    supabase.rpc("finalized_prescriptions_at", {
      p_practice_location_id: authority.locationId,
      p_patient_id: null,
    }),
  ]);

  if (appointmentResult.error || encounterResult.error || finalizedResult.error) {
    console.error("[analytics] primary aggregate read failed");
    return { ok: false, reason: "unavailable" };
  }

  const appointments = (appointmentResult.data ?? []) as unknown as {
    id: string;
    status: AppointmentStatus;
    visit_type: string;
    session_date: string;
  }[];
  const encounters = ((encounterResult.data ?? []) as unknown as {
    id: string;
    status: string;
    started_at: string;
    completed_at: string | null;
  }[]).filter((row) => inLocalRange(row.started_at, timeZone, startDate, endDateExclusive));

  const encounterIds = encounters.map((row) => row.id);
  const appointmentIds = appointments.map((row) => row.id);
  const finalizedRows = (finalizedResult.data ?? []) as unknown as {
    encounter_id: string;
    finalized_at: string | null;
  }[];

  const diagnosisRows: { label: string }[] = [];
  const investigationRows: { id: string }[] = [];
  const queueRows: { appointment_id: string }[] = [];
  const ownedFinalizedEncounterIds = new Set<string>();

  const secondaryReads: PromiseLike<boolean>[] = [];
  for (const ids of chunks(encounterIds)) {
    secondaryReads.push(
      Promise.all([
        supabase.from("encounter_diagnoses").select("label").in("encounter_id", ids),
        supabase.from("encounter_investigations").select("id").in("encounter_id", ids),
      ]).then(([diagnoses, investigations]) => {
        if (diagnoses.error || investigations.error) return false;
        diagnosisRows.push(...((diagnoses.data ?? []) as { label: string }[]));
        investigationRows.push(...((investigations.data ?? []) as { id: string }[]));
        return true;
      }),
    );
  }
  for (const ids of chunks(appointmentIds)) {
    secondaryReads.push(
      supabase
        .from("queue_entries")
        .select("appointment_id")
        .in("appointment_id", ids)
        .then((result) => {
          if (result.error) return false;
          queueRows.push(...((result.data ?? []) as { appointment_id: string }[]));
          return true;
        }),
    );
  }

  const finalizedEncounterIds = [...new Set(finalizedRows.map((row) => row.encounter_id).filter(Boolean))];
  for (const ids of chunks(finalizedEncounterIds)) {
    secondaryReads.push(
      supabase
        .from("encounters")
        .select("id")
        .eq("owner_doctor_id", authority.doctorId)
        .eq("practice_location_id", authority.locationId)
        .in("id", ids)
        .then((result) => {
          if (result.error) return false;
          for (const row of (result.data ?? []) as { id: string }[]) ownedFinalizedEncounterIds.add(row.id);
          return true;
        }),
    );
  }

  const secondaryOk = (await Promise.all(secondaryReads)).every(Boolean);
  if (!secondaryOk) {
    console.error("[analytics] secondary aggregate read failed");
    return { ok: false, reason: "unavailable" };
  }

  const diagnosisCounts = new Map<string, { label: string; count: number }>();
  for (const row of diagnosisRows) {
    const label = row.label.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase("en-US");
    const current = diagnosisCounts.get(key);
    diagnosisCounts.set(key, { label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
  }

  const statusCounts = new Map<AppointmentStatus, number>(
    APPOINTMENT_STATUSES.map((status) => [status, 0]),
  );
  for (const appointment of appointments) {
    statusCounts.set(appointment.status, (statusCounts.get(appointment.status) ?? 0) + 1);
  }

  const finalizedPrescriptions = finalizedRows.filter(
    (row) =>
      ownedFinalizedEncounterIds.has(row.encounter_id) &&
      inLocalRange(row.finalized_at, timeZone, startDate, endDateExclusive),
  ).length;

  return {
    ok: true,
    analytics: {
      period,
      startDate,
      endDateInclusive,
      locationName: authority.locationName,
      timeZone,
      encounters: encounters.length,
      completedEncounters: encounters.filter((row) => row.status === "COMPLETED").length,
      appointments: appointments.length,
      finalizedPrescriptions,
      followUps: appointments.filter((row) => row.visit_type === "FOLLOW_UP").length,
      queueEntries: queueRows.length,
      investigationOrders: investigationRows.length,
      appointmentStatuses: APPOINTMENT_STATUSES.map((status) => ({
        status,
        count: statusCounts.get(status) ?? 0,
      })),
      topDiagnoses: [...diagnosisCounts.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 5),
    },
  };
}
