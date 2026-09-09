"use server";

import {
  getPatientInvestigationHistory,
  getRecentInvestigations,
  type PatientInvestigationHistoryRow,
  type RecentInvestigation,
} from "./investigation-v1-queries";

export type RecentInvestigationReadResult =
  | { ok: true; rows: RecentInvestigation[] }
  | { ok: false; message: string };

export type PatientInvestigationHistoryReadResult =
  | { ok: true; rows: PatientInvestigationHistoryRow[] }
  | { ok: false; message: string };

export async function loadRecentInvestigationsAction(): Promise<RecentInvestigationReadResult> {
  try {
    const rows = await getRecentInvestigations(20);
    return rows
      ? { ok: true, rows }
      : { ok: false, message: "Recent investigations are unavailable right now." };
  } catch {
    console.error("[encounters] Investigation V1 Recent read failed");
    return { ok: false, message: "Recent investigations are unavailable right now." };
  }
}

export async function loadPatientInvestigationHistoryAction(
  patientId: string,
): Promise<PatientInvestigationHistoryReadResult> {
  try {
    const rows = await getPatientInvestigationHistory(patientId, 100);
    return rows
      ? { ok: true, rows }
      : { ok: false, message: "Previous Investigation history is unavailable right now." };
  } catch {
    console.error("[encounters] Investigation V1 patient history read failed");
    return { ok: false, message: "Previous Investigation history is unavailable right now." };
  }
}
