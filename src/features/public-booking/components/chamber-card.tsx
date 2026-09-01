import Link from "next/link";
import { CalendarClock, MapPin } from "lucide-react";
import type { PublicChamber } from "../queries";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * ONE CHAMBER, AND ITS OWN BOOKING.
 *
 * The card owns its call to action, and the link carries THIS chamber's
 * location id. That is the whole reason the CTA is not a single button at the
 * bottom of the page: a doctor with a Dhanmondi chamber and a Mirpur one has
 * two different places, two different sessions and two different fees, and a
 * patient pressing the button beside one of them means that one.
 *
 * A chamber with booking switched off gets NO active control — not a disabled
 * one. A greyed-out "Book Now" reads as a temporary outage and invites the
 * patient to keep tapping; a plain line of text says what is actually true.
 */
export function ChamberCard({ slug, chamber }: { slug: string; chamber: PublicChamber }) {
  const address = [chamber.address, chamber.district].filter(Boolean).join(", ");

  return (
    <article className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 sm:p-6">
      <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <h2 className="min-w-0 break-words text-xl font-semibold text-slate-900">
            {chamber.name}
          </h2>

          {address && (
            <p className="mt-1.5 flex min-w-0 items-start gap-1.5 text-sm text-slate-600">
              <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="min-w-0 break-words">{address}</span>
            </p>
          )}

          {chamber.publicNote && (
            <p className="mt-2 min-w-0 break-words text-sm text-slate-500">{chamber.publicNote}</p>
          )}

          {chamber.sessions.length > 0 && (
            <div className="mt-5 min-w-0">
              <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                Sessions
              </p>
              <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
                {chamber.sessions.map((s, i) => (
                  <div
                    key={`${s.weekday}-${s.startsAt}-${i}`}
                    className="min-w-0 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700"
                  >
                    <span className="font-semibold">{DAYS[s.weekday] ?? "Day"}</span>{" "}
                    <span className="tabular-nums">
                      {s.startsAt}–{s.endsAt}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {chamber.consultationFee != null && (
            <p className="mt-4 min-w-0 break-words text-sm text-slate-700">
              <span className="font-semibold">Consultation fee</span>{" "}
              <span className="tabular-nums">
                {chamber.currency} {String(chamber.consultationFee)}
              </span>
            </p>
          )}
        </div>

        <div className="min-w-0 md:w-44">
          {chamber.bookingEnabled ? (
            <Link
              data-public-chamber-booking-cta
              data-booking-location={chamber.locationId}
              /*
                THIS chamber's id, always. Both parts are encoded: a slug or a
                location that ever contained a reserved character would
                otherwise build a link pointing somewhere else entirely.
              */
              href={`/dr/${encodeURIComponent(slug)}/book?loc=${encodeURIComponent(chamber.locationId)}`}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            >
              Book Now
            </Link>
          ) : (
            <p
              data-public-chamber-booking-unavailable
              className="min-w-0 break-words rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600"
            >
              Online booking is not available at this chamber. Contact the chamber directly.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
