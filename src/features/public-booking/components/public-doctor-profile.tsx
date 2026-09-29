import Link from "next/link";
import { BadgeCheck, BadgeQuestionMark } from "lucide-react";
import type { PublicDoctor } from "../queries";
import { PublicDoctorAvatar } from "./public-doctor-avatar";
import { PublicShareActions } from "./public-share-actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PublicDoctorProfile({
  doctor,
  photoUrl,
  showBooking = true,
}: {
  doctor: PublicDoctor;
  photoUrl: string | null;
  showBooking?: boolean;
}) {
  return (
    <section className="min-w-0">
      <div className="dd-material-panel dd-panel-pearl min-w-0 rounded-[2rem] p-5 sm:p-8 lg:p-10">
        <div className="flex min-w-0 flex-col items-center gap-5 text-center sm:flex-row sm:gap-7 sm:text-left">
          <PublicDoctorAvatar fullName={doctor.fullName} photoUrl={photoUrl} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand sm:text-sm">Professional profile · Doctor&apos;s Diary</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{doctor.fullName}</h1>
              {doctor.verified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200" title="Professional identity verified by Doctor’s Diary"><BadgeCheck className="size-4" aria-hidden="true" /> Verified</span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted/80 px-2.5 py-1 text-xs font-semibold text-ink-muted opacity-70 grayscale" title="Professional identity has not been verified by Doctor’s Diary"><BadgeQuestionMark className="size-4 blur-[0.4px]" aria-hidden="true" /> Not verified</span>
              )}
            </div>
            <div className="mt-3 flex min-w-0 flex-wrap justify-center gap-x-3 gap-y-1 text-sm text-ink-secondary sm:justify-start sm:text-base">
              {doctor.designation && <span>{doctor.designation}</span>}
              {doctor.specialization && <span>· {doctor.specialization}</span>}
              {doctor.qualification && <span>· {doctor.qualification}</span>}
            </div>
            {doctor.bmdc && <p className="mt-3 break-words text-sm text-ink-muted">BMDC: {doctor.bmdc}{!doctor.verified && <span className="sm:ml-1"> (doctor-displayed)</span>}</p>}
            <PublicShareActions doctorName={doctor.fullName} />
          </div>
        </div>
      </div>
      <div className="mt-6 grid min-w-0 gap-5 sm:mt-8">
        {doctor.chambers.length === 0 && <div className="rounded-3xl border border-hairline bg-white p-6 text-center text-sm text-ink-secondary">Visiting information is not available yet.</div>}
        {doctor.chambers.map((chamber) => (
          <article key={chamber.chamberId} className="dd-material-record dd-record-pearl min-w-0 rounded-3xl p-5 sm:p-6">
            <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-stretch">
              <div className="min-w-0">
                <h2 className="break-words text-xl font-semibold">{chamber.name}</h2>
                {(chamber.address || chamber.district) && <p className="mt-1 break-words text-sm text-ink-secondary">{[chamber.address, chamber.district].filter(Boolean).join(", ")}</p>}
                {chamber.publicNote && <p className="mt-2 break-words text-sm text-ink-muted">{chamber.publicNote}</p>}
                {chamber.sessions.length > 0 ? (
                  <div className="mt-5 grid min-w-0 gap-2 sm:grid-cols-2">
                    {chamber.sessions.map((session, index) => (
                      <div key={`${session.weekday}-${session.startsAt}-${index}`} className="dd-material-record dd-record-pearl min-w-0 rounded-xl px-4 py-3 text-sm text-ink-secondary">
                        <span className="font-semibold">{DAYS[session.weekday] ?? "Day"}</span>{" "}<span className="tabular-nums">{session.startsAt}–{session.endsAt}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-4 text-sm text-ink-muted">Visiting hours are not available yet.</p>}
                {chamber.consultationFee != null && <p className="mt-4 text-sm font-medium text-ink-secondary">Consultation fee: {chamber.currency} {String(chamber.consultationFee)}</p>}
              </div>
              {showBooking && <div className="flex items-end md:min-w-44 md:justify-end">
                {chamber.bookingEnabled ? <Link data-public-chamber-booking-cta data-booking-location={chamber.locationId} href={`/dr/${encodeURIComponent(doctor.slug)}/book?loc=${encodeURIComponent(chamber.locationId)}`} className="dd-primary inline-flex min-h-11 w-full items-center justify-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring md:w-auto">Book appointment</Link> : <span className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-surface-muted px-4 py-3 text-center text-xs font-medium text-ink-muted md:w-auto">Online booking unavailable</span>}
              </div>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}