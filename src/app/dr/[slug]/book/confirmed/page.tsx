import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { getPublicBookingConfirmation } from "@/features/public-booking/queries";

export default async function BookingConfirmedPage(props: PageProps<"/dr/[slug]/book/confirmed">) {
  const { slug } = await props.params;
  const search = await props.searchParams;
  const ref = typeof search.ref === "string" ? search.ref : "";
  if (!ref) notFound();

  const booking = await getPublicBookingConfirmation(slug, ref);
  if (!booking) notFound();

  return (
    <MarketingShell>
      <section className="mx-auto min-w-0 max-w-2xl px-4 py-10 sm:px-5 sm:py-16 lg:px-8">
        <div className="dd-material-panel dd-panel-pearl min-w-0 rounded-[2rem] p-5 text-center sm:p-8">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-2xl text-brand">✓</div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-brand sm:text-sm sm:tracking-[0.14em]">
            Booking confirmed
          </p>
          <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight sm:text-4xl">
            Serial #{booking.serial}
          </h1>
          <p className="mt-3 break-words text-sm text-ink-secondary sm:text-base">
            Your appointment is in {booking.doctorName}&apos;s schedule.
          </p>

          <dl className="dd-material-record dd-record-pearl mx-auto mt-7 grid min-w-0 max-w-lg gap-3 rounded-2xl p-4 text-left text-sm sm:grid-cols-2 sm:p-5">
            <div className="min-w-0">
              <dt className="text-ink-muted">Chamber</dt>
              <dd className="mt-1 break-words font-semibold text-ink">{booking.chamberName}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-ink-muted">Date & time</dt>
              <dd className="mt-1 break-words font-semibold tabular-nums text-ink">
                {booking.date} · {booking.localTime}
              </dd>
            </div>
          </dl>

          <p className="mt-5 min-w-0 break-all rounded-xl bg-white px-3 py-3 font-mono text-sm text-ink-secondary ring-1 ring-slate-200 sm:px-4">
            Reference: {booking.bookingRef}
          </p>
          <p className="mt-5 break-words text-sm text-ink-muted">
            Keep your serial and reference. The live queue starts when you arrive;
            this serial does not change into a queue token.
          </p>
          <Link
            href={`/dr/${encodeURIComponent(slug)}`}
            className="dd-secondary mt-6 inline-flex min-h-11 w-full items-center justify-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring sm:w-auto"
          >
            Back to doctor profile
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
