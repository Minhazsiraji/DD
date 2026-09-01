import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The patient's single chronological timeline.
 *
 * DERIVED, not stored. Later phases add appointments, encounters, prescriptions,
 * investigations, documents and follow-ups as their own tables; this module
 * unions them. A denormalised timeline table would need syncing from six
 * writers and would drift.
 *
 * The timeline is DOCTOR-OWNED and spans every practice location: a patient
 * seen at a hospital in March and the doctor's chamber in July is one thread.
 * That continuity is the product's core value (ADR 0001).
 */

export const TIMELINE_EVENT_TYPES = [
  "registration",
  "appointment",
  "consultation",
  "prescription",
  "investigation",
  "document",
  "followup",
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  /** ISO timestamp. Sorted newest-first. */
  occurredAt: string;
  title: string;
  summary: string | null;
  /** Needed to filter by location — a name alone cannot identify one. */
  locationId: string | null;
  locationName: string | null;
  doctorName: string | null;
  /**
   * Where this event opens, when there is somewhere safe to go. A `null` here
   * renders a plain entry rather than a link — an event that exists but has no
   * detail screen yet is honest; a link that 404s is not.
   */
  href: string | null;
  /**
   * A short state word shown beside the title. Set for prescriptions, where
   * "superseded" versus "current" is the difference between the sheet the
   * patient should be holding and the one they should not.
   */
  badge: string | null;
}

/**
 * The timeline, plus what could not be read.
 *
 * A doctor cannot tell "no prescriptions" from "prescriptions failed to load",
 * and on a clinical history those mean opposite things — the first is a fact
 * about the patient, the second is a fact about the network. The old shape was
 * a bare array, so a failed query logged a line and silently produced a shorter
 * history that looked complete.
 */
export interface PatientHistory {
  events: TimelineEvent[];
  /** Human-readable names of the sources that failed. Empty when all loaded. */
  missing: string[];
}

export const TIMELINE_LABEL: Record<TimelineEventType, string> = {
  registration: "Registered",
  appointment: "Appointment",
  consultation: "Consultation",
  prescription: "Prescription",
  investigation: "Investigation",
  document: "Document",
  followup: "Follow-up",
};

/**
 * Which event types have a module behind them yet.
 *
 * Filters for unbuilt types still render, but say plainly that the module does
 * not exist rather than showing an empty list that reads as "no history".
 */
export const TIMELINE_AVAILABLE: Record<TimelineEventType, boolean> = {
  registration: true,
  appointment: true, // Stage 4
  consultation: true, // Stage 6 — read through the encounters SELECT policy
  prescription: true, // Stage 7 — read through patient_prescription_history()

  /**
   * Still false, and each for its own reason. A flag here is a promise that
   * the data is queried, the authorisation is proven, and the empty state
   * means "nothing happened" rather than "nothing was asked for".
   *
   * `investigation`  — `encounter_investigations` holds ORDERS, but results are
   *                    not built and there is no detail route to open. An
   *                    order alone is a half-answer to "what happened last
   *                    time", and a half-answer on a clinical screen is worse
   *                    than an honest "not built yet".
   * `followup`       — no table exists.
   */
  investigation: false,
  /**
   * Module D / Phase D1. `patient_documents` is queried, the authorisation is
   * `owner_doctor_id = current_doctor_id()` and nothing else, and an empty list
   * here means "nothing filed" rather than "nothing was asked for".
   */
  document: true,
  followup: false,
};

/**
 * Document types in a TIMELINE's words.
 *
 * A separate map from `DOCUMENT_TYPE_LABEL` on purpose: the timeline summary
 * sits under a title and reads as a sentence fragment, where the workspace's
 * "Lab report" is a column value. Importing the documents module here would
 * also point the patients feature at Module D for a string.
 */
const DOCUMENT_TIMELINE_LABEL: Record<string, string> = {
  LAB_REPORT: "Lab report",
  IMAGING_REPORT: "Imaging report",
  PREVIOUS_PRESCRIPTION: "Previous prescription",
  DISCHARGE_SUMMARY: "Discharge summary",
  REFERRAL: "Referral",
  MEDICAL_CERTIFICATE: "Medical certificate",
  OTHER: "Document",
};

/** What the timeline calls each appointment outcome, in a patient's terms. */
const APPOINTMENT_TITLE: Record<string, string> = {
  SCHEDULED: "Appointment booked",
  CONFIRMED: "Appointment confirmed",
  ARRIVED: "Arrived for appointment",
  IN_CONSULTATION: "With the doctor",
  /**
   * "Appointment completed", NOT "Seen by the doctor".
   *
   * This is the APPOINTMENT's outcome, and a separate Consultation entry sits
   * beside it for the same visit. Two rows both saying the doctor saw the
   * patient read as two visits. The distinction is real — an appointment can
   * complete without notes, and notes exist for walk-ins with no appointment —
   * so the labels are made truthful rather than the records merged.
   */
  COMPLETED: "Appointment completed",
  CANCELLED: "Appointment cancelled",
  NO_SHOW: "Did not attend",
};

export interface TimelineFilter {
  type?: TimelineEventType | "all";
  locationId?: string | "all";
}

/**
 * Build the timeline for one patient.
 *
 * RLS confines this to patients the caller may access; there is no owner filter
 * to forget here because Postgres applies it.
 */
export async function getPatientTimeline(
  patientId: string,
  filter: TimelineFilter = {},
): Promise<PatientHistory> {
  const supabase = await createSupabaseServerClient();
  const missing: string[] = [];

  const { data, error } = await supabase
    .from("patients")
    .select(
      "id, created_at, full_name, patient_location_links(practice_location_id, first_seen_at, practice_locations(id, name))",
    )
    .eq("id", patientId)
    .maybeSingle();

  if (error || !data) {
    // Nothing at all could be read — say so rather than render an empty history.
    return { events: [], missing: ["this patient's record"] };
  }

  const events: TimelineEvent[] = [];

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const links = ((data as any).patient_location_links ?? []) as any[];
  const firstLocation = links[0]?.practice_locations ?? null;

  events.push({
    id: `registration-${data.id}`,
    type: "registration",
    occurredAt: (data as any).created_at,
    title: "Patient registered",
    summary: null,
    locationId: firstLocation?.id ?? null,
    locationName: firstLocation?.name ?? null,
    doctorName: null,
    href: null,
    badge: null,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /**
   * Appointments (Stage 4).
   *
   * Cancelled ones are included on purpose: "booked and cancelled twice" is
   * part of the story, and a timeline that quietly drops them would misrepresent
   * how often this patient has actually been seen.
   */
  const { data: appts, error: apptError } = await supabase
    .from("appointments")
    .select(
      "id, scheduled_for, status, visit_type, reason, cancellation_reason, " +
        "practice_location_id, practice_locations(name), doctor_profiles(profiles(full_name))",
    )
    .eq("patient_id", patientId)
    .order("scheduled_for", { ascending: false });

  if (apptError) {
    /**
     * Logged AND reported. Logging alone was the defect: a timeline missing
     * half its events looks exactly like a patient with no history, and the
     * doctor reading it has no way to tell the difference.
     */
    console.error("[timeline] appointments query failed", apptError.message);
    missing.push("appointments");
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const row of (appts ?? []) as any[]) {
    const location = Array.isArray(row.practice_locations)
      ? row.practice_locations[0]
      : row.practice_locations;
    const doctorProfile = Array.isArray(row.doctor_profiles)
      ? row.doctor_profiles[0]
      : row.doctor_profiles;
    const doctorUser = Array.isArray(doctorProfile?.profiles)
      ? doctorProfile.profiles[0]
      : doctorProfile?.profiles;

    events.push({
      id: `appointment-${row.id}`,
      type: "appointment",
      occurredAt: row.scheduled_for,
      title: APPOINTMENT_TITLE[row.status as string] ?? "Appointment",
      summary: row.reason ?? null,
      locationId: row.practice_location_id ?? null,
      locationName: location?.name ?? null,
      doctorName: doctorUser?.full_name ?? null,
      href: null,
      badge: null,
    });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /**
   * Consultations (Stage 6).
   *
   * Read straight from `encounters`, because its SELECT policy is already
   * exactly the rule this history needs: `owner_doctor_id = current_doctor_id()`.
   * A colleague at the same hospital sees nothing and reception sees nothing —
   * no function required, and nothing here can widen it.
   */
  const { data: encs, error: encError } = await supabase
    .from("encounters")
    .select(
      "id, status, started_at, completed_at, chief_complaints, practice_location_id, " +
        "practice_locations(name), doctor_profiles(profiles(full_name))",
    )
    .eq("patient_id", patientId)
    .order("started_at", { ascending: false });

  if (encError) {
    console.error("[timeline] encounters query failed", encError.message);
    missing.push("consultations");
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const row of (encs ?? []) as any[]) {
    const location = Array.isArray(row.practice_locations)
      ? row.practice_locations[0]
      : row.practice_locations;
    const docProfile = Array.isArray(row.doctor_profiles)
      ? row.doctor_profiles[0]
      : row.doctor_profiles;
    const docUser = Array.isArray(docProfile?.profiles)
      ? docProfile.profiles[0]
      : docProfile?.profiles;

    const open = row.status === "DRAFT";
    events.push({
      id: `consultation-${row.id}`,
      type: "consultation",
      // When it HAPPENED, not when it was closed or edited.
      occurredAt: row.started_at,
      title: open ? "Consultation in progress" : "Consultation",
      /**
       * The chief complaint only — the one line a doctor writes to say why the
       * patient came. Examination, assessment and advice stay out: a timeline
       * is read at a glance, sometimes with the patient beside the screen, and
       * it is not the place to spill free-text clinical notes.
       */
      summary: row.chief_complaints ?? null,
      locationId: row.practice_location_id ?? null,
      locationName: location?.name ?? null,
      doctorName: docUser?.full_name ?? null,
      href: `/consultation/${row.id}`,
      badge: open ? "In progress" : null,
    });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /**
   * Prescriptions (Stage 7) — FINALISED ONLY.
   *
   * A draft was never issued to anybody, and listing one invites a doctor to
   * believe the patient is holding paper that was never printed.
   *
   * Through an RPC because `prescriptions` has no direct SELECT — that is the
   * accepted boundary, and history does not get to work around it. The function
   * refuses a non-doctor outright rather than returning nothing, so reception
   * is never told "this patient has no prescriptions".
   */
  const { data: rxs, error: rxError } = await supabase.rpc("patient_prescription_history", {
    p_patient_id: patientId,
    p_practice_location_id: null,
  });

  if (rxError) {
    /**
     * Not a doctor is a REFUSAL, not a failure. Reception opening a patient
     * page should not be told the history is broken — they simply have no
     * longitudinal clinical history to see.
     */
    if (/not a doctor/i.test(rxError.message)) {
      // Nothing to add, nothing missing.
    } else {
      console.error("[timeline] prescription history failed", rxError.message);
      missing.push("prescriptions");
    }
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const row of (rxs ?? []) as any[]) {
    const superseded = Boolean(row.superseded_by);
    const corrects = Boolean(row.replaces_id);

    events.push({
      id: `prescription-${row.prescription_id}`,
      type: "prescription",
      // When it was ISSUED. `created_at` would move an old event the day a
      // long-open draft was finally approved.
      occurredAt: row.finalized_at,
      title: corrects ? "Corrected prescription" : "Prescription",
      summary:
        row.item_count === 1 ? "1 medicine" : `${row.item_count ?? 0} medicines`,
      locationId: row.location_id ?? null,
      locationName: row.location_name ?? null,
      doctorName: null,
      // The canonical immutable record — never a rebuild from live rows.
      href: `/prescription/${row.prescription_id}`,
      /**
       * V1 and V2 must not read as two unrelated current prescriptions. The
       * REASON is deliberately absent: it is clinical reasoning and lives only
       * in the prescription's own lineage view, behind an ownership check.
       */
      badge: superseded ? "Superseded" : corrects ? "Current" : null,
    });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /**
   * Documents (Module D, Phase D1).
   *
   * Read straight from `patient_documents`, whose SELECT policy is already
   * exactly the rule this history needs: `owner_doctor_id =
   * current_doctor_id()`. Reception opening this page gets zero rows and no
   * count — an empty section rather than "2 documents you may not see".
   *
   * ARCHIVED DOCUMENTS ARE EXCLUDED. A removed report sitting in a clinical
   * history reads as a current one, and the timeline has no room to explain the
   * difference; the Documents workspace does, and shows them there.
   */
  const { data: docs, error: docError } = await supabase
    .from("patient_documents")
    .select(
      "id, document_type, title, document_date, created_at, practice_location_id," +
        " practice_locations(name)",
    )
    .eq("patient_id", patientId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (docError) {
    console.error("[timeline] documents query failed", docError.message);
    missing.push("documents");
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const row of (docs ?? []) as any[]) {
    const location = Array.isArray(row.practice_locations)
      ? row.practice_locations[0]
      : row.practice_locations;

    events.push({
      id: `document-${row.id}`,
      type: "document",
      /**
       * The date the document is ABOUT, falling back to when it was filed. A
       * report from March uploaded in July belongs in March, or the history
       * claims a test happened on the day someone got round to scanning it.
       */
      occurredAt: row.document_date
        ? `${row.document_date}T00:00:00.000Z`
        : row.created_at,
      title: row.title,
      summary: DOCUMENT_TIMELINE_LABEL[row.document_type as string] ?? "Document",
      locationId: row.practice_location_id ?? null,
      locationName: location?.name ?? null,
      doctorName: null,
      // Straight to the file, through the same authorised route the list uses.
      href: `/api/documents/${row.id}`,
      badge: null,
    });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const byType =
    !filter.type || filter.type === "all"
      ? events
      : events.filter((e) => e.type === filter.type);

  /**
   * Compare the location ID, not merely "has a location".
   *
   * The earlier version kept every event that had any location name, so
   * selecting one chamber silently showed all of them. Harmless while only
   * registration exists; actively misleading the moment appointments land.
   */
  const byLocation =
    !filter.locationId || filter.locationId === "all"
      ? byType
      : byType.filter((e) => e.locationId === filter.locationId);

  return {
    events: byLocation.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    missing,
  };
}
