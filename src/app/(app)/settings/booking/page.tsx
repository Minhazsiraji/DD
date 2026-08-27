import Link from "next/link";
import { ChamberBookingCard } from "@/features/booking-settings/components/chamber-booking-card";
import { getBookingConfig } from "@/features/booking-settings/queries";

const errors: Record<string, string> = {
  "check-values": "Check the values above — one of them is outside the allowed range.",
  "check-date": "Check the date.",
  "chamber-not-found": "That chamber is not yours.",
  "no-visiting-hours": "Add visiting hours to this chamber before enabling booking.",
  "location-inactive": "This practice location is inactive, so booking cannot be enabled.",
  "not-a-doctor": "This account has no doctor profile.",
  "save-failed": "Could not save. Nothing was changed.",
};

export default async function BookingSettingsPage(props: PageProps<"/settings/booking">) {
  const search = await props.searchParams;
  const chambers = await getBookingConfig();

  const error = typeof search.error === "string" ? errors[search.error] : null;
  const saved = search.saved === "1";
  const closed = search.closed === "1";
  const reopened = search.reopened === "1";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">Public booking</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Online appointments</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Controls whether patients can book you from your public profile, and on what terms.
          Booking is off for every chamber until you turn it on here.
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {saved && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Booking settings saved.</p>}
      {closed && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Date closed. Existing appointments were not changed.</p>}
      {reopened && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Date reopened for booking.</p>}

      <div className="rounded-glass-lg border border-hairline bg-white p-5">
        <h2 className="text-sm font-semibold text-ink">Before you turn this on</h2>
        <ul className="mt-2 grid gap-2 text-sm text-ink-secondary">
          <li>
            Your profile must be set to public. A chamber with booking enabled is still invisible
            while your profile is private —{" "}
            <Link href="/settings/professional" className="font-medium text-brand">
              professional profile
            </Link>
            .
          </li>
          <li>
            Public bookings arrive in your normal appointment list, marked as booked online. They
            are ordinary appointments and you cancel or reschedule them the usual way.
          </li>
          <li>
            A patient booking online creates a record in <em>your</em> repository only. The same
            person booking another doctor is a separate record there, never shared with you.
          </li>
        </ul>
      </div>

      {chambers.length === 0 ? (
        <div className="clinical-surface rounded-glass-lg p-6">
          <h2 className="text-lg font-semibold text-ink">No chambers yet</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            Booking is configured per chamber. Add a chamber and its visiting hours on your{" "}
            <Link href="/settings/professional" className="font-medium text-brand">
              professional profile
            </Link>{" "}
            first.
          </p>
        </div>
      ) : (
        chambers.map((chamber) => <ChamberBookingCard key={chamber.chamberId} chamber={chamber} />)
      )}
    </div>
  );
}
