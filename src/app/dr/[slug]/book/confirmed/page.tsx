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
      <section className="mx-auto max-w-2xl px-5 py-16 lg:px-8">
        <div className="rounded-[2rem] border border-teal-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-teal-50 text-2xl text-teal-700">✓</div>
          <p className="mt-5 text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">
            Booking confirmed
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            Serial #{booking.serial}
          </h1>
          <p className="mt-3 text-slate-600">
            Your appointment is in {booking.doctorName}&apos;s schedule.
          </p>

          <dl className="mx-auto mt-7 grid max-w-lg gap-3 rounded-2xl bg-slate-50 p-5 text-left text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Chamber</dt>
              <dd className="mt-1 font-semibold text-slate-900">{booking.chamberName}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Date & time</dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {booking.date} · {booking.localTime}
              </dd>
            </div>
          </dl>

          <p className="mt-5 rounded-xl bg-white px-4 py-3 font-mono text-sm text-slate-600 ring-1 ring-slate-200">
            Reference: {booking.bookingRef}
          </p>
          <p className="mt-5 text-sm text-slate-500">
            Keep your serial and reference. The live queue starts when you arrive;
            this serial does not change into a queue token.
          </p>
          <Link
            href={`/dr/${encodeURIComponent(slug)}`}
            className="mt-6 inline-flex rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold"
          >
            Back to doctor profile
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
