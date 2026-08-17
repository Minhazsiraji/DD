import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { requireLocationContext } from "@/lib/auth/session";
import { getQueue } from "@/features/queue/queries";
import { QueueBoard } from "@/features/queue/components/queue-board";
import { todayInDhaka } from "@/features/appointments/schema";
import { getCurrentDoctorId } from "@/features/patients/queries";

export const metadata: Metadata = { title: "Live queue" };

/**
 * The waiting room, now.
 *
 * Always today: a queue is a live thing, and a date picker here would invite
 * someone to act on yesterday's room. Past days are read through Appointments.
 */
export default async function QueuePage() {
  const ctx = await requireLocationContext();
  const sessionDate = todayInDhaka();

  /**
   * Reception sees this board too, and only the OWNING DOCTOR may open notes.
   * Null for anyone who is not a doctor, so the button never appears where it
   * could only fail. The database refuses regardless — this is about not
   * offering an action that cannot work.
   */
  const [outcome, currentDoctorId] = await Promise.all([
    getQueue(ctx.locationId, sessionDate),
    getCurrentDoctorId(),
  ]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Live queue"
        title={ctx.locationName}
        subtitle="Everyone who has arrived, in the order they will be seen."
      />

      {/*
        A failed FIRST read cannot fall through to the board's own outage
        state — there is nothing to keep on screen. Say so here instead, and
        still offer the way onward.
      */}
      {!outcome.ok ? (
        <>
          <p className="flex items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            The queue could not be loaded, so nothing is shown here. This is not
            an empty waiting room — reload before telling anyone they have been
            seen.
          </p>
          <Link
            href="/appointments"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            <CalendarDays className="size-4" aria-hidden="true" />
            Open today&apos;s appointments instead
          </Link>
        </>
      ) : null}

      <QueueBoard
        initialRows={outcome.ok ? outcome.rows : []}
        initiallyOk={outcome.ok}
        sessionDate={sessionDate}
        locationId={ctx.locationId}
        locationName={ctx.locationName}
        currentDoctorId={currentDoctorId}
      />

      <p className="text-xs text-ink-muted">
        Patients join this queue when reception marks them arrived. A patient
        with the doctor stays visible here but cannot be called, skipped or moved
        — the consultation has already started.
      </p>
    </div>
  );
}
