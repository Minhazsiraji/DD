import "server-only";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.uuid();

export interface RecentInvestigation {
  name: string;
  lastUsedAt: string;
  usageCount: number;
}

export interface PatientInvestigationHistoryRow {
  investigationId: string;
  encounterId: string;
  investigationName: string;
  note: string | null;
  position: number;
  orderedAt: string;
  encounterStartedAt: string;
  orderingDoctorId: string;
  orderingDoctorName: string | null;
  practiceLocationId: string;
  practiceLocationName: string;
}

function boundedInteger(value: number, min: number, max: number): number | null {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/**
 * Doctor-longitudinal persisted Investigation wording, ordered by actual recent
 * use. There is intentionally no active-location parameter: database authority
 * derives the Doctor and spans that Doctor's own encounters across locations.
 */
export async function getRecentInvestigations(limit = 20): Promise<RecentInvestigation[] | null> {
  const safeLimit = boundedInteger(limit, 1, 50);
  if (safeLimit === null) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("recent_encounter_investigations", {
    p_limit: safeLimit,
  });

  if (error || !Array.isArray(data)) {
    console.error("[encounters] recent Investigation history unavailable");
    return null;
  }

  const rows: RecentInvestigation[] = [];
  for (const raw of data as unknown[]) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    if (
      typeof row.name !== "string" ||
      row.name.trim() === "" ||
      typeof row.last_used_at !== "string" ||
      typeof row.usage_count !== "number" ||
      !Number.isInteger(row.usage_count) ||
      row.usage_count < 1
    ) {
      return null;
    }
    rows.push({
      name: row.name,
      lastUsedAt: row.last_used_at,
      usageCount: row.usage_count,
    });
  }

  return rows;
}

/**
 * Authoritative ordered/requested Investigation history for one patient owned
 * by the current Doctor. The database, not this function, enforces Doctor and
 * patient isolation and returns the original encounter/location context.
 */
export async function getPatientInvestigationHistory(
  patientId: string,
  limit = 100,
): Promise<PatientInvestigationHistoryRow[] | null> {
  const parsedPatientId = uuid.safeParse(patientId);
  const safeLimit = boundedInteger(limit, 1, 200);
  if (!parsedPatientId.success || safeLimit === null) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("patient_investigation_history", {
    p_patient_id: parsedPatientId.data,
    p_limit: safeLimit,
  });

  if (error || !Array.isArray(data)) {
    console.error("[encounters] patient Investigation history unavailable");
    return null;
  }

  const rows: PatientInvestigationHistoryRow[] = [];
  for (const raw of data as unknown[]) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    if (
      typeof row.investigation_id !== "string" ||
      typeof row.encounter_id !== "string" ||
      typeof row.investigation_name !== "string" ||
      row.investigation_name.trim() === "" ||
      (row.note !== null && typeof row.note !== "string") ||
      typeof row.investigation_position !== "number" ||
      !Number.isInteger(row.investigation_position) ||
      row.investigation_position < 0 ||
      typeof row.ordered_at !== "string" ||
      typeof row.encounter_started_at !== "string" ||
      typeof row.ordering_doctor_id !== "string" ||
      (row.ordering_doctor_name !== null && typeof row.ordering_doctor_name !== "string") ||
      typeof row.practice_location_id !== "string" ||
      typeof row.practice_location_name !== "string"
    ) {
      return null;
    }

    rows.push({
      investigationId: row.investigation_id,
      encounterId: row.encounter_id,
      investigationName: row.investigation_name,
      note: row.note,
      position: row.investigation_position,
      orderedAt: row.ordered_at,
      encounterStartedAt: row.encounter_started_at,
      orderingDoctorId: row.ordering_doctor_id,
      orderingDoctorName: row.ordering_doctor_name,
      practiceLocationId: row.practice_location_id,
      practiceLocationName: row.practice_location_name,
    });
  }

  return rows;
}
