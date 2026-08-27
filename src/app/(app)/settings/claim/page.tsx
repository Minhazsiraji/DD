import type { Metadata } from "next";
import Link from "next/link";
import {
  CLAIM_STATUS_COPY,
  approvedClaim,
  getMyClaims,
  openClaim,
} from "@/features/doctor/claim";
import { respondToClaim, submitClaim } from "@/features/doctor/claim-actions";

export const metadata: Metadata = { title: "Professional verification" };

const errors: Record<string, string> = {
  "check-details": "Check the details and try again.",
  "no-doctor-profile": "This account has no doctor profile yet.",
  "already-open": "You already have a verification request waiting for review.",
  "already-approved": "This profile is already verified.",
  "claim-not-found": "That request could not be found.",
  "already-decided": "That request has already been decided.",
  "nothing-to-resubmit": "There is nothing to resubmit.",
  "claim-failed": "Could not save. Nothing was changed.",
};

const field =
  "mt-1 w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none";
const label = "text-xs font-medium uppercase tracking-wide text-ink-muted";

/**
 * DOCTOR PROFESSIONAL VERIFICATION — for a profile this account ALREADY OWNS.
 *
 * This is not a claim over an unowned directory listing. `doctor_profiles.user_id`
 * is NOT NULL, so the profile already belongs to this account; what a reviewer
 * settles is whether the professional identity behind it is genuine. Nothing
 * here transfers ownership, and nothing here publishes anyone.
 *
 * The future "prepared directory profile → doctor claims it → ownership moves"
 * capability is a SEPARATE architecture — see docs/decisions/0014.
 *
 * The screen says both of these out loud, because a doctor reading
 * "verification" could reasonably assume it makes them findable, and it does
 * not.
 */
export default async function ClaimPage(props: PageProps<"/settings/claim">) {
  const search = await props.searchParams;
  const claims = await getMyClaims();
  const open = openClaim(claims);
  const approved = approvedClaim(claims);

  const error = typeof search.error === "string" ? errors[search.error] : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
          Professional identity
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          Request professional verification
        </h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Confirm you are the professional behind this account. This account
          already owns its doctor profile — verification does not transfer
          anything, it records that your registration was checked.
        </p>
        <p className="mt-2 text-sm text-ink-secondary">
          Being verified is separate from being listed publicly —{" "}
          <Link href="/settings/professional" className="font-medium text-brand">
            you choose that on your professional profile
          </Link>
          , and a decision here never changes it.
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {search.submitted === "1" && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Verification requested.
        </p>
      )}
      {search.resubmitted === "1" && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Sent back for review.
        </p>
      )}
      {search.withdrawn === "1" && (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-ink-secondary">
          Verification request withdrawn.
        </p>
      )}

      {approved && (
        <section className="clinical-surface rounded-glass-lg p-5">
          <h2 className="text-lg font-semibold text-ink">Verified professional identity</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            {approved.regulatorName} · {approved.countryCode} ·{" "}
            <span className="tabular-nums">{approved.registrationNumber}</span>
          </p>
          <p className="mt-3 text-xs text-ink-muted">
            Your account ownership and profile visibility were both unchanged.
            Visibility is still whatever you last set it to.
          </p>
        </section>
      )}

      {open && (
        <section className="clinical-surface rounded-glass-lg p-5">
          <h2 className="text-lg font-semibold text-ink">{CLAIM_STATUS_COPY[open.status]}</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            {open.regulatorName} · {open.countryCode} ·{" "}
            <span className="tabular-nums">{open.registrationNumber}</span>
          </p>

          {open.status === "NEEDS_INFORMATION" && open.decisionNote && (
            <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {open.decisionNote}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {open.status === "NEEDS_INFORMATION" && (
              <form action={respondToClaim} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="claimId" value={open.id} />
                <input type="hidden" name="action" value="RESUBMIT" />
                <label className="min-w-60 flex-1">
                  <span className={label}>Your reply</span>
                  <input type="text" name="note" maxLength={1000} className={field} required />
                </label>
                <button
                  type="submit"
                  className="inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white"
                >
                  Send back for review
                </button>
              </form>
            )}

            <form action={respondToClaim}>
              <input type="hidden" name="claimId" value={open.id} />
              <input type="hidden" name="action" value="CANCEL" />
              <button
                type="submit"
                className="inline-flex h-10 items-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink"
              >
                Withdraw
              </button>
            </form>
          </div>
        </section>
      )}

      {!open && !approved && (
        <form action={submitClaim} className="clinical-surface grid gap-4 rounded-glass-lg p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={label}>Your name as registered</span>
              <input type="text" name="claimedFullName" required minLength={2} maxLength={120} className={field} />
            </label>
            <label>
              <span className={label}>Country</span>
              <input
                type="text"
                name="countryCode"
                required
                maxLength={2}
                placeholder="BD"
                className={`${field} uppercase`}
              />
            </label>
            <label>
              <span className={label}>Regulator / council</span>
              <input
                type="text"
                name="regulatorName"
                required
                minLength={2}
                maxLength={120}
                placeholder="BMDC"
                className={field}
              />
            </label>
            <label>
              <span className={label}>Registration number</span>
              <input type="text" name="registrationNumber" required minLength={2} maxLength={64} className={field} />
            </label>
          </div>

          <label>
            <span className={label}>Anything the reviewer should know (optional)</span>
            <textarea name="evidenceNote" rows={3} maxLength={1000} className={field} />
          </label>

          <p className="text-xs text-ink-muted">
            A platform reviewer sees only what you enter here and the
            professional fields on your profile. They cannot see your patients,
            consultations or prescriptions — and approving this does not give
            them, or anyone else, control of your account.
          </p>

          <div>
            <button
              type="submit"
              className="inline-flex h-11 items-center rounded-xl bg-brand px-5 text-sm font-semibold text-white"
            >
              Request verification
            </button>
          </div>
        </form>
      )}

      {claims.length > 0 && (
        <section className="rounded-glass-lg border border-hairline bg-white p-5">
          <h2 className="text-sm font-semibold text-ink">History</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {claims.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 text-ink-secondary">
                <span>
                  {CLAIM_STATUS_COPY[c.status]} · {c.regulatorName}{" "}
                  <span className="tabular-nums">{c.registrationNumber}</span>
                </span>
                {c.decisionNote && <span className="text-ink-muted">{c.decisionNote}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
