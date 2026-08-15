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
  appointment: false, // Phase 4
  consultation: false, // Phase 6
  prescription: false, // Phase 8
  investigation: false, // Phase 6
  document: false, // Phase 10
  followup: false, // Phase 10
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
): Promise<TimelineEvent[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("patients")
    .select(
      "id, created_at, full_name, patient_location_links(practice_location_id, first_seen_at, practice_locations(id, name))",
    )
    .eq("id", patientId)
    .maybeSingle();

  if (error || !data) return [];

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
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Future: union appointments, encounters, prescriptions, investigations,
  // documents and follow-ups here. Each must carry practice_location_id.

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

  return byLocation.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
