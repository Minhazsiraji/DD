import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type D1ConsultationStatus = "DRAFT" | "COMPLETED";

export interface D1PatientContext {
  id: string;
  patientNumber: string;
  fullName: string;
}

export interface D1RecentConsultation {
  encounterId: string;
  status: D1ConsultationStatus;
  startedAt: string;
  completedAt: string | null;
  patient: D1PatientContext;
}

export interface D1DraftPrescription {
  prescriptionId: string;
  encounterId: string;
  patient: D1PatientContext;
  itemCount: number;
}

export interface D1FinalizedPrescription {
  prescriptionId: string;
  encounterId: string;
  finalizedAt: string;
  patient: D1PatientContext;
  itemCount: number;
}

export interface D1DashboardPilotData {
  recentConsultations: D1RecentConsultation[];
  openConsultationCount: number;
  draftPrescriptions: D1DraftPrescription[];
  draftPrescriptionCount: number;
  finalizedPrescriptions: D1FinalizedPrescription[];
}

export type D1DashboardPilotOutcome =
  | { ok: true; data: D1DashboardPilotData }
  | { ok: false; reason: "unavailable" };

type EncounterRow = {
  id: string;
  status: D1ConsultationStatus;
  started_at: string;
  completed_at: string | null;
  patient_id: string;
};

type PrescriptionRow = {
  prescription_id: string;
  encounter_id: string;
  patient_id: string;
  status: "DRAFT" | "FINALIZED" | "VOIDED";
  finalized_at: string | null;
  item_count: number;
};

type PatientRow = {
  id: string;
  patient_number: string;
  full_name: string;
};

/**
 * Pilot dashboard reads only. No clinical mutation is exposed here.
 *
 * Encounters are protected by AAL2 + owner-doctor RLS. The explicit doctor and
 * location predicates are retained as query constraints, not as authority.
 * Prescription activity comes from the frozen doctor-owned
 * `prescriptions_for_doctor` RPC, which independently derives the Doctor.
 */
export async function getD1DashboardPilotData(
  locationId: string,
  doctorId: string,
  limit = 6,
): Promise<D1DashboardPilotOutcome> {
  const supabase = await createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(10, limit));

  const [recentResult, openCountResult, prescriptionResult] = await Promise.all([
    supabase
      .from("encounters")
      .select("id, status, started_at, completed_at, patient_id")
      .eq("owner_doctor_id", doctorId)
      .eq("practice_location_id", locationId)
      .in("status", ["DRAFT", "COMPLETED"])
      .order("started_at", { ascending: false })
      .limit(safeLimit),
    supabase
      .from("encounters")
      .select("id", { count: "exact", head: true })
      .eq("owner_doctor_id", doctorId)
      .eq("practice_location_id", locationId)
      .eq("status", "DRAFT"),
    supabase.rpc("prescriptions_for_doctor", {
      p_practice_location_id: locationId,
      p_patient_id: null,
    }),
  ]);

  if (recentResult.error || openCountResult.error || prescriptionResult.error) {
    console.error("[dashboard] D1 pilot activity read failed");
    return { ok: false, reason: "unavailable" };
  }

  const encounters = (recentResult.data ?? []) as EncounterRow[];
  const prescriptions = (prescriptionResult.data ?? []) as PrescriptionRow[];
  const drafts = prescriptions.filter((row) => row.status === "DRAFT").slice(0, safeLimit);
  const finalized = prescriptions
    .filter((row) => row.status === "FINALIZED" && typeof row.finalized_at === "string")
    .sort((a, b) => (b.finalized_at ?? "").localeCompare(a.finalized_at ?? ""))
    .slice(0, safeLimit);

  const patientIds = Array.from(
    new Set([
      ...encounters.map((row) => row.patient_id),
      ...drafts.map((row) => row.patient_id),
      ...finalized.map((row) => row.patient_id),
    ]),
  );

  let patientRows: PatientRow[] = [];
  if (patientIds.length > 0) {
    const patientResult = await supabase
      .from("patients")
      .select("id, patient_number, full_name")
      .eq("owner_doctor_id", doctorId)
      .is("deleted_at", null)
      .in("id", patientIds);

    if (patientResult.error) {
      console.error("[dashboard] D1 patient context read failed");
      return { ok: false, reason: "unavailable" };
    }
    patientRows = (patientResult.data ?? []) as PatientRow[];
  }

  const patients = new Map(
    patientRows.map((row) => [
      row.id,
      { id: row.id, patientNumber: row.patient_number, fullName: row.full_name } satisfies D1PatientContext,
    ]),
  );

  const recentConsultations = encounters.flatMap((row) => {
    const patient = patients.get(row.patient_id);
    return patient
      ? [{
          encounterId: row.id,
          status: row.status,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          patient,
        }]
      : [];
  });

  const draftPrescriptions = drafts.flatMap((row) => {
    const patient = patients.get(row.patient_id);
    return patient
      ? [{
          prescriptionId: row.prescription_id,
          encounterId: row.encounter_id,
          patient,
          itemCount: Number(row.item_count ?? 0),
        }]
      : [];
  });

  const finalizedPrescriptions = finalized.flatMap((row) => {
    const patient = patients.get(row.patient_id);
    if (!patient || !row.finalized_at) return [];
    return [{
      prescriptionId: row.prescription_id,
      encounterId: row.encounter_id,
      finalizedAt: row.finalized_at,
      patient,
      itemCount: Number(row.item_count ?? 0),
    }];
  });

  return {
    ok: true,
    data: {
      recentConsultations,
      openConsultationCount: openCountResult.count ?? 0,
      draftPrescriptions,
      draftPrescriptionCount: prescriptions.filter((row) => row.status === "DRAFT").length,
      finalizedPrescriptions,
    },
  };
}
