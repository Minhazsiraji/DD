import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import type { QueueRow } from "./schema";

/**
 * Queue reads.
 *
 * Everything goes through `get_queue()`, which is SECURITY INVOKER — RLS decides
 * who sees what, and the ordering comes back already applied. There is no
 * client-side sort anywhere, by design (ADR 0009).
 */

/**
 * Fail-closed. An empty room and a broken query look identical on screen, and
 * "nobody is waiting" is exactly the answer that sends a patient home.
 */
export type QueueOutcome =
  | { ok: true; rows: QueueRow[] }
  | { ok: false; reason: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRow(r: any): QueueRow {
  return {
    appointmentId: r.appointment_id,
    patientId: r.patient_id,
    patientName: r.patient_name,
    patientNumber: r.patient_number,
    ownerDoctorId: r.owner_doctor_id,
    doctorName: r.doctor_name ?? null,
    tokenNumber: r.token_number ?? null,
    status: r.status,
    visitType: r.visit_type,
    scheduledFor: r.scheduled_for,
    arrivedAt: r.arrived_at ?? null,
    calledAt: r.called_at ?? null,
    callCount: r.call_count ?? 0,
    skippedAt: r.skipped_at ?? null,
    skipCount: r.skip_count ?? 0,
    priority: r.priority ?? 0,
    priorityReason: r.priority_reason ?? null,
    priorityNote: r.priority_note ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getQueue(
  practiceLocationId: string,
  sessionDate: string,
): Promise<QueueOutcome> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("get_queue", {
    p_practice_location_id: practiceLocationId,
    p_session_date: sessionDate,
  });

  if (error) {
    console.error("[queue] get_queue failed", error.message);
    return { ok: false, reason: error.message };
  }

  // Order is preserved exactly as returned — see the module comment.
  return { ok: true, rows: ((data as unknown[]) ?? []).map(toRow) };
}
