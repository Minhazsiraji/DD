import "server-only";
import { getQueue } from "./queries";
import { groupQueue } from "./schema";
import { getAppointmentsForDay } from "@/features/appointments/queries";
import { todayInDhaka } from "@/features/appointments/schema";

/**
 * The two numbers on the sidebar.
 *
 * They used to be the literals 7 and 24, written during Phase 1 as visual
 * placeholders and never replaced — so the sidebar said "Live Queue 7" above an
 * empty waiting room, and every doctor saw the same 7 and 24. A number beside
 * "Live Queue" is read as a fact about the room, and a made-up one is worse
 * than none.
 *
 * BOTH GO THROUGH THE EXISTING AUTHORISED READS, so the counts can only ever
 * describe what the caller may already see: `get_queue` is a location-scoped
 * RPC, and the appointments read runs under the caller's own session with RLS
 * applied. There is no separate counting path that could disagree with the
 * screens, and nothing to leak a colleague's or another location's rows.
 *
 * Scoped to the ACTIVE location and to TODAY, matching the two screens they
 * point at — the queue is always today, and the appointments screen opens on
 * today.
 */
export interface NavCounts {
  /** Patients arrived and not yet called in. Matches the queue's "Waiting". */
  waiting?: number;
  /** Appointments booked at this location today, whatever their state. */
  appointmentsToday?: number;
}

/**
 * A failed read yields NO badge rather than a zero.
 *
 * "0 waiting" and "we could not check" are different statements, and the queue
 * screen already refuses to turn an outage into "nobody is waiting". A badge
 * must not undo that from the sidebar.
 */
export async function getNavCounts(activeLocationId: string): Promise<NavCounts> {
  const today = todayInDhaka();

  const [queue, appointments] = await Promise.all([
    getQueue(activeLocationId, today),
    getAppointmentsForDay(today, activeLocationId),
  ]);

  return {
    // `undefined`, not 0, when the read failed — see the note above.
    waiting: queue.ok ? groupQueue(queue.rows).waiting.length : undefined,
    appointmentsToday: appointments.ok ? appointments.appointments.length : undefined,
  };
}
