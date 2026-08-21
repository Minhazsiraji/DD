import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The consultation before this one, for the same patient.
 *
 * A patient who comes back for a report review arrived at a consultation that
 * started blank, and the doctor had to leave the screen and search the timeline
 * to remember what they had said last time. The continuity is the product's
 * whole point; it should not require navigating away from the patient.
 *
 * AUTHORISATION IS RLS, NOT THIS FILE.
 *
 * `encounters_select` is `owner_doctor_id = current_doctor_id()`, so this query
 * can only ever return the caller's OWN encounters — across every location they
 * practise at, which is exactly the doctor-owned longitudinal boundary. A
 * colleague reading the same patient id gets nothing; reception and a location
 * admin have no `current_doctor_id()` at all and get nothing. Nothing here
 * widens that, and nothing here may be given a doctor id by the browser.
 *
 * READ-ONLY, ALWAYS. Nothing in this module writes, and the previous encounter
 * is never touched by opening today's.
 */

export interface PreviousVisitVitals {
  heightCm: string | null;
  weightKg: string | null;
  temperatureC: string | null;
  pulseBpm: number | null;
  systolic: number | null;
  diastolic: number | null;
  respRate: number | null;
  spo2: number | null;
}

export interface PreviousVisitPrescription {
  id: string;
  finalizedAt: string | null;
  medicineCount: number;
  /** True when a correction has replaced it. Never says WHY — see below. */
  superseded: boolean;
  /** The replacement, when the reader is allowed to open it. */
  replacedById: string | null;
}

export interface PreviousVisit {
  id: string;
  startedAt: string;
  locationName: string | null;
  chiefComplaints: string | null;
  presentIllness: string | null;
  pastHistory: string | null;
  examination: string | null;
  assessment: string | null;
  advice: string | null;
  vitals: PreviousVisitVitals;
  diagnoses: string[];
  /** Tests ORDERED that day. Requests — there is no results module. */
  investigations: string[];
  prescription: PreviousVisitPrescription | null;
}

const COLUMNS = `
  id, started_at, practice_location_id,
  chief_complaints, present_illness, past_history, examination, assessment, advice,
  vital_height_cm, vital_weight_kg, vital_temperature_c, vital_pulse_bpm,
  vital_systolic, vital_diastolic, vital_resp_rate, vital_spo2
`;

/**
 * The IMMEDIATELY PRECEDING completed visit — not the first one, ever.
 *
 * Visit 3 shows visit 2. Pinning the first consultation would freeze the
 * context on a visit the doctor has already moved past.
 *
 * Excluded: this encounter, drafts (an unfinished visit is not history), and
 * anything cancelled. `COMPLETED` is the only eligible status, which is also
 * why finishing a consultation matters.
 */
export async function getPreviousVisit(
  patientId: string,
  currentEncounterId: string,
): Promise<PreviousVisit | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("encounters")
    .select(COLUMNS)
    .eq("patient_id", patientId)
    .eq("status", "COMPLETED")
    .neq("id", currentEncounterId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Never blocks the consultation: today's notes matter more than context.
    console.error("[encounters] previous visit lookup failed", patientId, error.message);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as Record<string, unknown>;
  const previousId = row.id as string;

  const [lists, location, prescription] = await Promise.all([
    readLists(supabase, previousId),
    readLocationName(supabase, row.practice_location_id as string),
    readPrescription(supabase, previousId),
  ]);

  return {
    id: previousId,
    startedAt: row.started_at as string,
    locationName: location,
    chiefComplaints: text(row.chief_complaints),
    presentIllness: text(row.present_illness),
    pastHistory: text(row.past_history),
    examination: text(row.examination),
    assessment: text(row.assessment),
    advice: text(row.advice),
    vitals: {
      heightCm: text(row.vital_height_cm),
      weightKg: text(row.vital_weight_kg),
      temperatureC: text(row.vital_temperature_c),
      pulseBpm: num(row.vital_pulse_bpm),
      systolic: num(row.vital_systolic),
      diastolic: num(row.vital_diastolic),
      respRate: num(row.vital_resp_rate),
      spo2: num(row.vital_spo2),
    },
    diagnoses: lists.diagnoses,
    investigations: lists.investigations,
    prescription,
  };
}

/** The booked reason for today's visit. Null for a walk-in with no appointment. */
export async function getVisitType(appointmentId: string | null): Promise<string | null> {
  if (!appointmentId) return null;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("appointments")
    .select("visit_type")
    .eq("id", appointmentId)
    .maybeSingle();

  return (data as { visit_type: string } | null)?.visit_type ?? null;
}

function text(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function readLists(supabase: Client, encounterId: string) {
  const [dx, inv] = await Promise.all([
    supabase
      .from("encounter_diagnoses")
      .select("label, position")
      .eq("encounter_id", encounterId)
      .order("position"),
    supabase
      .from("encounter_investigations")
      .select("name, position")
      .eq("encounter_id", encounterId)
      .order("position"),
  ]);

  return {
    diagnoses: (dx.data ?? []).map((d) => (d as { label: string }).label),
    investigations: (inv.data ?? []).map((i) => (i as { name: string }).name),
  };
}

async function readLocationName(supabase: Client, locationId: string) {
  const { data } = await supabase
    .from("practice_locations")
    .select("name")
    .eq("id", locationId)
    .maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

/**
 * That visit's finalised prescription, FROM ITS OWN SNAPSHOT.
 *
 * The medicine count is read out of `review_bundle_snapshot` — the immutable
 * object the doctor approved — never rebuilt from today's template, today's
 * doctor profile or the live `prescription_items`. A corrected prescription
 * that had rows removed would otherwise report a count that never printed.
 *
 * Drafts are excluded: an unfinalised prescription is not something that was
 * ever given to a patient.
 *
 * `replacement_reason` is deliberately NOT read. Whether this one was
 * superseded is operational and safe to show; WHY it was corrected is clinical
 * and belongs only to the correction record.
 */
async function readPrescription(
  supabase: Client,
  encounterId: string,
): Promise<PreviousVisitPrescription | null> {
  const { data, error } = await supabase
    .from("prescriptions")
    .select("id, finalized_at, review_bundle_snapshot")
    .eq("encounter_id", encounterId)
    .eq("status", "FINALIZED")
    .order("finalized_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as Record<string, unknown>;
  const snapshot = row.review_bundle_snapshot as { items?: unknown[] } | null;

  const { data: replacement } = await supabase
    .from("prescriptions")
    .select("id")
    .eq("replaces_prescription_id", row.id as string)
    .limit(1)
    .maybeSingle();

  const replacedById = (replacement as { id: string } | null)?.id ?? null;

  return {
    id: row.id as string,
    finalizedAt: (row.finalized_at as string | null) ?? null,
    medicineCount: Array.isArray(snapshot?.items) ? snapshot.items.length : 0,
    superseded: replacedById !== null,
    replacedById,
  };
}
