import type { Metadata } from "next";
import { CalendarDays, CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { requireLocationContext } from "@/lib/auth/session";
import { getCurrentDoctorId } from "@/features/patients/queries";
import {
  getAppointmentsForDay,
  getDoctorsAtLocation,
} from "@/features/appointments/queries";
import { searchPatientsAction } from "@/features/appointments/actions";
import { AppointmentCard } from "@/features/appointments/components/appointment-card";
import { BookingPanel } from "@/features/appointments/components/booking-panel";
import { DayNav } from "@/features/appointments/components/day-nav";
import { STATUS_ORDER, todayInDhaka } from "@/features/appointments/schema";

export const metadata: Metadata = { title: "Appointments" };

export default async function AppointmentsPage({
  searchParams,
}: PageProps<"/appointments">) {
  const params = await searchParams;
  const requested = typeof params.date === "string" ? params.date : undefined;
  const sessionDate = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? "")
    ? requested!
    : todayInDhaka();

  const ctx = await requireLocationContext();
  const [outcome, doctors, ownDoctorId] = await Promise.all([
    getAppointmentsForDay(sessionDate, ctx.locationId),
    getDoctorsAtLocation(ctx.locationId),
    getCurrentDoctorId(),
  ]);

  const runsDesk =
    ctx.roles.includes("RECEPTIONIST") || ctx.roles.includes("LOCATION_ADMIN");
  const isDoctorHere = ctx.roles.includes("DOCTOR");
  const canManage = runsDesk || isDoctorHere;

  /**
   * A doctor books for themselves; the desk chooses. A doctor who ALSO runs the
   * desk (the common solo-chamber case, where they are both DOCTOR and
   * LOCATION_ADMIN) still books for themselves — offering them a picker
   * containing only their own name would be noise.
   */
  const mustChooseDoctor = !ownDoctorId || (runsDesk && !isDoctorHere);

  const appointments = outcome.ok
    ? [...outcome.appointments].sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.scheduledFor.localeCompare(b.scheduledFor),
      )
    : [];

  const active = appointments.filter((a) => a.status !== "CANCELLED");

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Appointments"
        title={ctx.locationName}
        subtitle="Everyone booked here today, in the order you will see them."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DayNav sessionDate={sessionDate} />
        {canManage ? (
          <BookingPanel
            doctors={doctors}
            ownDoctorId={ownDoctorId}
            mustChooseDoctor={mustChooseDoctor}
            searchPatients={searchPatientsAction}
            defaultDate={sessionDate}
          />
        ) : null}
      </div>

      {/*
        A failed read is NOT an empty day. "No appointments" is exactly the
        answer that would send a waiting patient home.
      */}
      {!outcome.ok ? (
        <p className="flex items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          The appointment list could not be loaded, so nothing is shown here.
          This is not the same as an empty day — reload before telling anyone
          they have no booking.
        </p>
      ) : appointments.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-5" />}
          title="Nothing booked for this day"
          description={
            canManage
              ? "Book the first appointment, or use the arrows to look at another day."
              : "Nothing is booked here for this day."
          }
        />
      ) : (
        <>
          <p className="text-xs text-ink-secondary">
            {active.length} booked
            {appointments.length !== active.length
              ? ` · ${appointments.length - active.length} cancelled`
              : ""}
          </p>
          <ul className="space-y-3">
            {appointments.map((a) => (
              <AppointmentCard key={a.id} appointment={a} canManage={canManage} />
            ))}
          </ul>
        </>
      )}

      <p className="text-xs text-ink-muted">
        Appointments belong to the doctor. Reception at this location sees
        everyone booked here — never another location, and never a doctor&apos;s
        private chamber.
      </p>
    </div>
  );
}
