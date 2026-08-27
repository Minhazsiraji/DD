import { addClosedDate, removeClosedDate, saveBookingSettings } from "../actions";
import { describeLead, weekdayName, type ChamberBookingConfig } from "../queries";

const field =
  "w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink tabular-nums focus:border-brand focus:outline-none";
const label = "text-xs font-medium uppercase tracking-wide text-ink-secondary";

/**
 * One chamber, one form, one write.
 *
 * The public availability list is generated from these values, so nothing here
 * is cosmetic: turning booking on for a chamber makes an anonymous write path
 * live. The screen says so in words rather than relying on the doctor inferring
 * it from a toggle.
 */
export function ChamberBookingCard({ chamber }: { chamber: ChamberBookingConfig }) {
  const hasHours = chamber.sessions.length > 0;
  const blocked = !hasHours || !chamber.isActive;

  return (
    <section className="clinical-surface rounded-glass-lg p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{chamber.locationName}</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {chamber.district ?? "—"} · times shown in {chamber.timezone}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            chamber.bookingEnabled
              ? "bg-emerald-50 text-emerald-800"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          {chamber.bookingEnabled ? "✓ Accepting public bookings" : "✕ Not accepting bookings"}
        </span>
      </div>

      <p className="mt-3 text-sm text-ink-secondary">
        {hasHours ? (
          <>
            Visiting hours:{" "}
            {chamber.sessions
              .map((s) => `${weekdayName(s.weekday).slice(0, 3)} ${s.startsAt}–${s.endsAt}`)
              .join(" · ")}
          </>
        ) : (
          <span className="text-amber-800">
            This chamber has no visiting hours yet. Booking cannot be enabled until it does —
            a patient would otherwise meet an empty list with no explanation.
          </span>
        )}
      </p>

      {!chamber.isActive && (
        <p className="mt-2 text-sm text-amber-800">
          This practice location is inactive, so it is hidden from your public profile.
        </p>
      )}

      <form action={saveBookingSettings} className="mt-5 grid gap-4">
        <input type="hidden" name="chamberId" value={chamber.chamberId} />

        <label className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={chamber.bookingEnabled}
            disabled={blocked}
            className="mt-1 size-5"
          />
          <span>
            <span className="block text-sm font-semibold text-ink">
              Let patients book this chamber from my public profile
            </span>
            <span className="mt-1 block text-sm text-ink-secondary">
              Anyone with your profile link can then create an appointment without signing in.
              They never see your patient list, and you can turn this off at any time.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={label}>Booking mode</span>
            <select name="mode" defaultValue={chamber.bookingMode} className={`${field} mt-1`}>
              <option value="TOKEN">Token — patients join a session</option>
              <option value="TIME_SLOT">Time slot — patients hold an exact time</option>
            </select>
            <p className="mt-1 text-xs text-ink-secondary">
              In token mode the patient books the session, not a minute. Their number is issued
              when they arrive, exactly as it is for a walk-in.
            </p>
          </div>

          <div>
            <span className={label}>Slot length (minutes)</span>
            <input
              type="number"
              name="slotMinutes"
              min={5}
              max={180}
              defaultValue={chamber.slotMinutes}
              className={`${field} mt-1`}
            />
            <p className="mt-1 text-xs text-ink-secondary">
              Used to divide your visiting hours in time-slot mode.
            </p>
          </div>

          <div>
            <span className={label}>Maximum patients per day</span>
            <input
              type="number"
              name="maxPatients"
              min={1}
              max={500}
              defaultValue={chamber.maxPatients}
              className={`${field} mt-1`}
            />
          </div>

          <div>
            <span className={label}>How far ahead patients may book (days)</span>
            <input
              type="number"
              name="windowDays"
              min={1}
              max={180}
              defaultValue={chamber.bookingWindowDays}
              className={`${field} mt-1`}
            />
          </div>

          <div>
            <span className={label}>Minimum notice (minutes)</span>
            <input
              type="number"
              name="leadMinutes"
              min={0}
              max={10080}
              defaultValue={chamber.minLeadMinutes}
              className={`${field} mt-1`}
            />
            <p className="mt-1 text-xs text-ink-secondary">
              Currently {describeLead(chamber.minLeadMinutes)} before the appointment.
            </p>
          </div>

          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div>
              <span className={label}>Consultation fee (optional)</span>
              <input
                type="number"
                name="fee"
                min={0}
                max={1000000}
                step="0.01"
                defaultValue={chamber.consultationFee ?? ""}
                className={`${field} mt-1`}
              />
            </div>
            <div>
              <span className={label}>Currency</span>
              <input
                type="text"
                name="currency"
                maxLength={3}
                defaultValue={chamber.currency}
                className={`${field} mt-1 uppercase`}
              />
            </div>
          </div>
        </div>

        <div>
          <button
            type="submit"
            className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white"
          >
            Save booking settings
          </button>
        </div>
      </form>

      <div className="mt-6 border-t border-hairline pt-5">
        <h3 className="text-sm font-semibold text-ink">Closed dates</h3>
        <p className="mt-1 text-sm text-ink-secondary">
          Stops new bookings on a date. Appointments already booked stay — closing a date never
          cancels a patient who is already holding one.
        </p>

        {chamber.closedDates.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {chamber.closedDates.map((c) => (
              <li
                key={c.closedOn}
                className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-2"
              >
                <span className="text-sm text-ink tabular-nums">
                  {c.closedOn}
                  {c.reason && <span className="ml-2 text-ink-secondary">— {c.reason}</span>}
                </span>
                <form action={removeClosedDate}>
                  <input type="hidden" name="chamberId" value={chamber.chamberId} />
                  <input type="hidden" name="date" value={c.closedOn} />
                  <button type="submit" className="text-sm font-medium text-brand">
                    Reopen
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-secondary">No upcoming closed dates.</p>
        )}

        <form action={addClosedDate} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="chamberId" value={chamber.chamberId} />
          <div>
            <span className={label}>Date</span>
            <input type="date" name="date" required className={`${field} mt-1`} />
          </div>
          <div className="min-w-45 flex-1">
            <span className={label}>Reason (optional)</span>
            <input
              type="text"
              name="reason"
              maxLength={120}
              placeholder="Eid holiday"
              className={`${field} mt-1`}
            />
          </div>
          <button
            type="submit"
            className="rounded-xl border border-hairline px-4 py-2 text-sm font-semibold text-ink"
          >
            Close this date
          </button>
        </form>
      </div>
    </section>
  );
}
