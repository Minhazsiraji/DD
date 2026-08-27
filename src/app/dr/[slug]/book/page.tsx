import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { createPublicBooking } from "@/features/public-booking/actions";
import { getPublicDoctor, getPublicSlots } from "@/features/public-booking/queries";

const errorCopy: Record<string, string> = {
  "check-details": "Please check the patient details and try again.",
  "already-booked": "This phone number already has an active booking for that chamber and date.",
  "slot-unavailable": "That time is no longer available. Please choose another.",
  "booking-failed": "We could not create the booking. Please try again.",
};

export default async function PublicBookingPage(props: PageProps<"/dr/[slug]/book">) {
  const { slug } = await props.params;
  const search = await props.searchParams;
  const doctor = await getPublicDoctor(slug);
  if (!doctor) notFound();

  const bookable = doctor.chambers.filter((c) => c.bookingEnabled);
  if (bookable.length === 0) notFound();

  const requestedLocation = typeof search.loc === "string" ? search.loc : "";
  const chamber = bookable.find((c) => c.locationId === requestedLocation) ?? bookable[0];
  const date = typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
    ? search.date
    : "";
  const slots = date ? await getPublicSlots(slug, chamber.locationId, date) : [];
  const error = typeof search.error === "string" ? errorCopy[search.error] : null;

  return (
    <MarketingShell>
      <section className="mx-auto max-w-3xl px-5 py-12 lg:px-8 lg:py-20">
        <Link href={`/dr/${encodeURIComponent(slug)}`} className="text-sm font-medium text-teal-700">
          ← Back to doctor profile
        </Link>
        <div className="mt-5 rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight">Book {doctor.fullName}</h1>
          <p className="mt-2 text-slate-600">
            Choose a chamber and date first. Only currently available sessions are shown.
          </p>

          {error && <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

          <form method="get" className="mt-7 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-slate-700">Chamber</label>
              <select name="loc" defaultValue={chamber.locationId} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3">
                {bookable.map((c) => <option key={c.locationId} value={c.locationId}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-700">Date</label>
              <input name="date" type="date" defaultValue={date} required className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" />
            </div>
            <button className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold sm:col-span-2">
              Check availability
            </button>
          </form>

          {date && (
            <form action={createPublicBooking.bind(null, slug)} className="mt-8 grid gap-5">
              <input type="hidden" name="locationId" value={chamber.locationId} />
              <input type="hidden" name="date" value={date} />

              <fieldset>
                <legend className="text-sm font-semibold text-slate-700">Available session/time</legend>
                {slots.length === 0 ? (
                  <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    No online availability for this date.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {slots.map((slot) => (
                      <label key={slot.localTime} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                        <input type="radio" name="localTime" value={slot.localTime} required />
                        <span>{slot.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

              {slots.length > 0 && (
                <>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Patient name</label>
                    <input name="patientName" required maxLength={120} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Mobile number</label>
                      <input name="phone" required inputMode="tel" maxLength={24} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Sex</label>
                      <select name="sex" defaultValue="UNKNOWN" className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3">
                        <option value="UNKNOWN">Prefer not to say</option>
                        <option value="MALE">Male</option>
                        <option value="FEMALE">Female</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Reason for visit (optional)</label>
                    <textarea name="reason" maxLength={300} rows={3} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" />
                    <p className="mt-1 text-xs text-slate-500">Please keep this brief. Do not use this form for emergencies.</p>
                  </div>
                  <button className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white">
                    Confirm booking
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      </section>
    </MarketingShell>
  );
}
