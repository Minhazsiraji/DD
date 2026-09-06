import "server-only";

import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMemberships, requireUser } from "@/lib/auth/session";
import { requiresMfaChallenge } from "@/features/security/policy";
import {
  getM1FinderScope,
  localDateInTimeZone,
} from "@/features/patients/m1-context";
import {
  getDashboardRecentPatients,
  getPatientCount,
} from "@/features/patients/queries";
import { getDashboardDayCounts } from "@/features/appointments/queries";
import { todayInDhaka } from "@/features/appointments/schema";
import { getQueue } from "@/features/queue/queries";

export type M1PerfStage =
  | "verified_user"
  | "mfa_aal"
  | "memberships"
  | "doctor_scope"
  | "patient_count"
  | "recent_patients"
  | "day_counts"
  | "get_queue"
  | "total_server";

export interface M1PreviewDiagnostic {
  vercelRegion: string;
  timingsMs: Record<M1PerfStage, number>;
}
function nowNs(): bigint {
  return process.hrtime.bigint();
}

function elapsedMs(started: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - started) / 1_000_000);
}

async function measure<T>(task: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = nowNs();
  const value = await task();
  return { value, ms: elapsedMs(started) };
}

function requireSuccessfulOutcome(
  ok: boolean,
  stage: Exclude<M1PerfStage, "verified_user" | "mfa_aal" | "memberships" | "doctor_scope" | "total_server">,
): void {
  if (!ok) {
    // Do not surface PostgREST/database error text on the diagnostic page.
    throw new Error(`M1 PERF-01 diagnostic stage failed: ${stage}`);
  }
}

/**
 * Preview-only, authenticated timing harness for M1.
 *
 * The sequence is deliberate: verified identity and MFA are measured first,
 * then the request-local auth cache is warm before membership/data timings.
 * The final get_queue measurement therefore isolates the queue RPC rather than
 * charging another auth verification round-trip to the queue stage.
 */
export async function runM1PreviewDiagnostic(): Promise<M1PreviewDiagnostic> {
  if (process.env.VERCEL_ENV !== "preview") notFound();

  const totalStarted = nowNs();
  const timings = {} as Record<M1PerfStage, number>;

  const verified = await measure(() => requireUser());
  timings.verified_user = verified.ms;

  const supabase = await createSupabaseServerClient();
  const aal = await measure(() => supabase.auth.mfa.getAuthenticatorAssuranceLevel());
  timings.mfa_aal = aal.ms;

  if (aal.value.error) throw new Error("M1 PERF-01 MFA verification failed");
  if (
    requiresMfaChallenge(
      aal.value.data?.currentLevel ?? null,
      aal.value.data?.nextLevel ?? null,
    )
  ) {
    redirect("/mfa");
  }
  const memberships = await measure(() => getMemberships());
  timings.memberships = memberships.ms;
  if (memberships.value.length === 0) redirect("/onboarding");

  const scope = await measure(() => getM1FinderScope());
  timings.doctor_scope = scope.ms;
  const sessionDate = scope.value.timeZone
    ? localDateInTimeZone(scope.value.timeZone)
    : todayInDhaka();

  const patientCount = await measure(() => getPatientCount(scope.value.doctorId));
  timings.patient_count = patientCount.ms;
  requireSuccessfulOutcome(patientCount.value.ok, "patient_count");

  const recentPatients = await measure(() =>
    getDashboardRecentPatients(6, scope.value.doctorId),
  );
  timings.recent_patients = recentPatients.ms;
  requireSuccessfulOutcome(recentPatients.value.ok, "recent_patients");

  const dayCounts = await measure(() =>
    getDashboardDayCounts(
      sessionDate,
      scope.value.locationId,
      scope.value.doctorId,
    ),
  );
  timings.day_counts = dayCounts.ms;
  requireSuccessfulOutcome(dayCounts.value.ok, "day_counts");

  const queue = await measure(() =>
    getQueue(scope.value.locationId, sessionDate),
  );
  timings.get_queue = queue.ms;
  requireSuccessfulOutcome(queue.value.ok, "get_queue");

  timings.total_server = elapsedMs(totalStarted);

  return {
    vercelRegion: process.env.VERCEL_REGION ?? "unknown",
    timingsMs: timings,
  };
}
