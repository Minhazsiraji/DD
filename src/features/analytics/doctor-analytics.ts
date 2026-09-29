import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getM1DoctorAuthority, localDateInTimeZone } from "@/features/patients/m1-context";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/features/appointments/schema";
import { analyticsDateRange } from "./period";
import type { AnalyticsPeriod } from "./doctor-analytics-types";

export { ANALYTICS_PERIODS, type AnalyticsPeriod } from "./doctor-analytics-types";

export interface DoctorAnalytics {
  period: AnalyticsPeriod;
  startDate: string | null;
  endDateInclusive: string;
  locationName: string;
  timeZone: string;
  patientCount: number;
  financials: { status: "authoritative"; cost: string; income: string; netIncome: string; reason: string; };
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
  startDate: string | null,
  endDateExclusive: string,
): boolean {
  if (!instant) return false;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return false;
  const localDate = localDateInTimeZone(timeZone, parsed);
  return (startDate === null || localDate >= startDate) && localDate < endDateExclusive;
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

async function supabaseScope(doctorId: string, activeLocationId: string, requested: string) {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc("doctor_expense_chambers");
  if (result.error || !Array.isArray(result.data)) return null;
  const chambers = result.data as unknown as {locationId:string;locationName:string;timezone:string}[];
  const chosen = requested === "all" ? chambers : requested === "active" ? chambers.filter(c=>c.locationId===activeLocationId) : chambers.filter(c=>c.locationId===requested);
  if (!chosen.length) return null;
  const zones = new Set(chosen.map(c=>c.timezone));
  return { locationIds: chosen.map(c=>c.locationId), locationName: requested === "all" ? "All Chambers" : chosen[0].locationName, timeZone: zones.size === 1 ? chosen[0].timezone : "Asia/Dhaka" };
}

export async function getDoctorAnalytics(period: AnalyticsPeriod, requestedScope = "active"): Promise<DoctorAnalyticsOutcome> {
  const authority = await getM1DoctorAuthority();
  if (!authority.canClinical || !authority.doctorId || !authority.localDate) {
    return { ok: false, reason: "doctor-required" };
  }

  const scopeResult = await supabaseScope(authority.doctorId, authority.locationId, requestedScope);
  if (!scopeResult) return { ok: false, reason: "unavailable" };
  const { locationIds, locationName, timeZone } = scopeResult;
  const { startDate, endDateExclusive, endDateInclusive } = analyticsDateRange(
    authority.localDate,
    period,
  );
  const utc = startDate ? wideUtcBounds(startDate, endDateExclusive) : null;
  const supabase = await createSupabaseServerClient();

  let appointmentQuery = supabase
    .from("appointments")
    .select("id,status,visit_type,session_date")
    .eq("owner_doctor_id", authority.doctorId)
    .in("practice_location_id", locationIds)
    .lt("session_date", endDateExclusive);
  if (startDate) appointmentQuery = appointmentQuery.gte("session_date", startDate);

  let encounterQuery = supabase
    .from("encounters")
    .select("id,status,started_at,completed_at")
    .eq("owner_doctor_id", authority.doctorId)
    .in("practice_location_id", locationIds)
    .lt("started_at", utc?.to ?? `${endDateExclusive}T12:00:00.000Z`);
  if (utc) encounterQuery = encounterQuery.gte("started_at", utc.from);

  let expenseQuery = supabase.from("doctor_expenses").select("amount,expense_date,practice_location_id").eq("owner_doctor_id", authority.doctorId).in("practice_location_id", locationIds).lt("expense_date", endDateExclusive);
  if (startDate) expenseQuery = expenseQuery.gte("expense_date", startDate);

  let paymentQuery = supabase.from("practice_payments").select("paid_amount,refunded_amount,payment_date,practice_location_id").eq("owner_doctor_id", authority.doctorId).in("practice_location_id", locationIds).lt("payment_date", endDateExclusive);
  if (startDate) paymentQuery = paymentQuery.gte("payment_date", startDate);

  const finalizedQueries = locationIds.map((locationId) =>
    supabase.rpc("finalized_prescriptions_at", {
      p_practice_location_id: locationId,
      p_patient_id: null,
    }),
  );
  const [appointmentResult, encounterResult, finalizedResults, expenseResult, paymentResult] = await Promise.all([
    appointmentQuery,
    encounterQuery,
    Promise.all(finalizedQueries),
    expenseQuery,
    paymentQuery,
  ]);
  const finalizedError = finalizedResults.some((result) => result.error);

  if (appointmentResult.error || encounterResult.error || finalizedError || expenseResult.error || paymentResult.error) {
    console.error("[analytics] primary aggregate read failed");
    return { ok: false, reason: "unavailable" };
  }

  const costCents = (expenseResult.data ?? []).reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
  const cost = (costCents / 100).toFixed(2);
  const incomeCents = (paymentResult.data ?? []).reduce((sum, row) => sum + Math.round((Number(row.paid_amount) - Number(row.refunded_amount)) * 100), 0);
  const income = (incomeCents / 100).toFixed(2);
  const netIncome = ((incomeCents - costCents) / 100).toFixed(2);

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
  const finalizedRows = finalizedResults.flatMap((result) => result.data ?? []) as unknown as {
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
        .in("practice_location_id", locationIds)
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
      locationName,
      timeZone,
      patientCount: encounters.length,
      financials: { status: "authoritative", cost, income, netIncome, reason: "Income is practice payments received minus refunds; Cost is the Doctor expense ledger. Doctor’s Diary SaaS subscription billing remains excluded." },
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
