import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPatient, type PatientDetail } from "@/features/patients/queries";
import { emptyDraft, DRAFT_KEYS, type DraftValues, type DraftKey } from "./schema";

/**
 * Consultation reads.
 *
 * RLS decides what comes back — only the owning doctor can select an encounter
 * row at all. Nothing here re-implements that; it maps the row into the shape
 * the editor needs.
 */

export interface DiagnosisRow {
  id: string;
  label: string;
  certainty: string;
  note: string | null;
  position: number;
}

export interface InvestigationRow {
  id: string;
  name: string;
  note: string | null;
  position: number;
}

export interface Consultation {
  id: string;
  status: "DRAFT" | "COMPLETED" | "CANCELLED";
  version: number;
  startedAt: string;
  completedAt: string | null;
  appointmentId: string | null;
  practiceLocationId: string;
  values: DraftValues;
  diagnoses: DiagnosisRow[];
  investigations: InvestigationRow[];
  patient: PatientDetail;
}

/**
 * Ordering is the database's, not the client's.
 *
 * `position` is maintained by the RPCs and closed up on removal, so sorting
 * here by anything else — created_at, id — would let the screen disagree with
 * the record about the order a doctor put their findings in.
 */
async function readLists(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  encounterId: string,
): Promise<{ diagnoses: DiagnosisRow[]; investigations: InvestigationRow[] } | null> {
  const [dx, inv] = await Promise.all([
    supabase
      .from("encounter_diagnoses")
      .select("id, label, certainty, note, position")
      .eq("encounter_id", encounterId)
      .order("position"),
    supabase
      .from("encounter_investigations")
      .select("id, name, note, position")
      .eq("encounter_id", encounterId)
      .order("position"),
  ]);

  if (dx.error || inv.error) {
    console.error(
      "[encounters] readLists failed",
      encounterId,
      dx.error?.message ?? inv.error?.message,
    );
    return null;
  }

  return {
    diagnoses: (dx.data ?? []) as DiagnosisRow[],
    investigations: (inv.data ?? []) as InvestigationRow[],
  };
}

/**
 * Three outcomes, kept apart on purpose.
 *
 * "Not found" and "the read failed" must never collapse into one. A doctor told
 * "this consultation does not exist" when the database is simply unreachable
 * would start a second one and write into it — the patient ends up with two
 * half-records of the same visit. This mistake has already been made once in
 * this codebase, on patients.
 */
export type ConsultationOutcome =
  | { ok: true; consultation: Consultation }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "unavailable" }
  /**
   * The encounter is legitimately theirs, but it belongs to a different
   * location than the one they are working in. Carries the encounter's real
   * location so the caller can name it — the doctor already has access to it,
   * so there is nothing to withhold.
   */
  | { ok: false; reason: "wrong-location"; locationId: string };

const COLUMN_BY_KEY: Record<DraftKey, string> = {
  chiefComplaints: "chief_complaints",
  symptoms: "symptoms",
  presentIllness: "present_illness",
  pastHistory: "past_history",
  examination: "examination",
  assessment: "assessment",
  advice: "advice",
  nextVisitNote: "next_visit_note",
  /**
   * Read back as the literal `YYYY-MM-DD` Postgres stores for a `date`. It is
   * never parsed into a `Date` on the way to the editor — that is exactly how a
   * follow-up moves a day.
   */
  nextVisitOn: "next_visit_on",
  vitalHeightCm: "vital_height_cm",
  vitalWeightKg: "vital_weight_kg",
  vitalTemperatureC: "vital_temperature_c",
  vitalPulseBpm: "vital_pulse_bpm",
  vitalSystolic: "vital_systolic",
  vitalDiastolic: "vital_diastolic",
  vitalRespRate: "vital_resp_rate",
  vitalSpo2: "vital_spo2",
};

const ENCOUNTER_COLUMNS = [
  "id",
  "status",
  "version",
  "started_at",
  "completed_at",
  "appointment_id",
  "patient_id",
  "practice_location_id",
  ...DRAFT_KEYS.map((k) => COLUMN_BY_KEY[k]),
].join(", ");

/** Null and 0 are different things; only null becomes an empty box. */
function toEditorString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function rowToValues(row: Record<string, unknown>): DraftValues {
  const values = emptyDraft();
  for (const key of DRAFT_KEYS) {
    values[key] = toEditorString(row[COLUMN_BY_KEY[key]]);
  }
  return values;
}

/**
 * Load a consultation FOR A SPECIFIC LOCATION.
 *
 * The active location is a required argument rather than something the caller
 * may remember to check, because forgetting it does not fail loudly: a doctor
 * who works at two places can open a bookmarked Location A encounter while
 * Location B is active, and the screen will happily label A's consultation with
 * B's name. The write RPC refuses eventually — but by then the identity strip
 * has already told a doctor the wrong thing about where they are, which is the
 * one thing that strip exists to get right.
 */
export async function getConsultation(
  encounterId: string,
  activeLocationId: string,
): Promise<ConsultationOutcome> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("encounters")
    .select(ENCOUNTER_COLUMNS)
    .eq("id", encounterId)
    .maybeSingle();

  if (error) {
    console.error("[encounters] getConsultation failed", encounterId, error.message);
    return { ok: false, reason: "unavailable" };
  }
  if (!data) return { ok: false, reason: "not-found" };

  const row = data as unknown as Record<string, unknown>;

  // Fail closed BEFORE loading the patient: a mismatch must not render notes,
  // an identity strip, or anything else editable.
  const encounterLocation = row.practice_location_id as string;
  if (encounterLocation !== activeLocationId) {
    return { ok: false, reason: "wrong-location", locationId: encounterLocation };
  }

  /**
   * The identity strip is not decoration — it is the thing that stops notes
   * being written into the wrong patient's record. If it cannot be loaded, the
   * consultation must not render at all.
   */
  const [patient, lists] = await Promise.all([
    getPatient(row.patient_id as string),
    readLists(supabase, encounterId),
  ]);
  if (!patient || !lists) return { ok: false, reason: "unavailable" };

  return {
    ok: true,
    consultation: {
      diagnoses: lists.diagnoses,
      investigations: lists.investigations,
      id: row.id as string,
      status: row.status as Consultation["status"],
      version: row.version as number,
      startedAt: row.started_at as string,
      completedAt: (row.completed_at as string | null) ?? null,
      appointmentId: (row.appointment_id as string | null) ?? null,
      practiceLocationId: row.practice_location_id as string,
      values: rowToValues(row),
      patient,
    },
  };
}

export interface ServerState {
  version: number;
  /** Whether the visit is still open — see the note where it is read. */
  status: "DRAFT" | "COMPLETED" | "CANCELLED";
  values: DraftValues;
  diagnoses: DiagnosisRow[];
  investigations: InvestigationRow[];
}

/**
 * The encounter as it stands right now, for resolving a conflict.
 *
 * Read AFTER a rejected mutation, so the doctor is shown what they would have
 * been writing over rather than being asked to decide blind. Includes the lists
 * because a conflict is about the ENCOUNTER: whatever moved it, everything on
 * the screen is now potentially behind.
 */
export async function getServerState(
  encounterId: string,
  activeLocationId: string,
): Promise<ServerState | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("encounters")
    .select(ENCOUNTER_COLUMNS)
    .eq("id", encounterId)
    // Same binding as the read path: a refresh must not reach across locations
    // any more than a render may.
    .eq("practice_location_id", activeLocationId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;

  const lists = await readLists(supabase, encounterId);
  if (!lists) return null;

  return {
    version: row.version as number,
    /**
     * Whether the visit is still open. Needed to tell "the close was refused"
     * from "it is already closed" — a doctor told the visit would not finish,
     * when it has, clicks again.
     */
    status: row.status as "DRAFT" | "COMPLETED" | "CANCELLED",
    values: rowToValues(row),
    diagnoses: lists.diagnoses,
    investigations: lists.investigations,
  };
}
