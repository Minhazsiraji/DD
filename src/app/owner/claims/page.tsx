import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformOwner } from "@/features/owner/authority";
import { getClaimsForReview } from "@/features/owner/claims";
import { decideClaim } from "@/features/owner/claim-actions";

export const metadata: Metadata = { title: "Doctor claims" };

const errors: Record<string, string> = {
  "check-decision": "Check the decision and try again.",
  "claim-not-found": "That claim no longer exists.",
  "already-decided": "That claim was already decided. Decisions are not overwritten.",
  "ownership-conflict":
    "The claimant no longer owns the account behind this profile. Resolve the ownership question before approving.",
  "note-too-long": "The note is too long.",
  "not-owner": "You are not a platform owner.",
  "decision-failed": "The decision could not be recorded. Nothing was changed.",
};

const decided: Record<string, string> = {
  approve: "Claim approved. The doctor's profile visibility is unchanged.",
  reject: "Claim rejected.",
  needs_information: "Sent back to the doctor for more information.",
};

/**
 * The review queue.
 *
 * Deliberately small: a list, the evidence, three buttons. No doctor search, no
 * patient browse, no metrics — none of that is needed to decide whether a
 * person is who they say they are, and building it here would quietly turn the
 * owner console into a clinical surface.
 */
export default async function OwnerClaimsPage(props: PageProps<"/owner/claims">) {
  await requirePlatformOwner();

  const search = await props.searchParams;
  const claims = await getClaimsForReview();
  const error = typeof search.error === "string" ? errors[search.error] : null;
  const ok = typeof search.decided === "string" ? decided[search.decided] : null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">Platform</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">Doctor profile claims</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Confirm that the person holding this account is the professional they
        say they are. Approving a claim does not publish anyone — the doctor
        chooses that separately.
      </p>
      <Link href="/owner" className="mt-3 inline-block text-sm font-medium text-brand">
        ← Owner console
      </Link>

      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {ok && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{ok}</p>}

      {claims.length === 0 ? (
        <p className="clinical-surface mt-6 rounded-glass-lg p-6 text-sm text-ink-secondary">
          No claims are waiting for a decision.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4">
          {claims.map((claim) => (
            <li key={claim.id} className="clinical-surface rounded-glass-lg p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-ink">{claim.claimedFullName}</h2>
                  <p className="mt-0.5 text-sm text-ink-secondary">
                    Account name: {claim.accountName ?? "—"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  {claim.status === "NEEDS_INFORMATION" ? "Awaiting doctor" : "Pending"}
                </span>
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Regulator</dt>
                  <dd className="text-ink">
                    {claim.regulatorName} · {claim.countryCode}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Registration claimed</dt>
                  <dd className="text-ink tabular-nums">{claim.registrationNumber}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Registration on the profile</dt>
                  <dd className="text-ink tabular-nums">
                    {claim.profileRegistrationOnRecord ?? "— not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Qualification</dt>
                  <dd className="text-ink">{claim.profileQualification ?? "—"}</dd>
                </div>
              </dl>

              {claim.evidenceNote && (
                <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-ink-secondary">
                  {claim.evidenceNote}
                </p>
              )}

              <form action={decideClaim} className="mt-5 grid gap-3">
                <input type="hidden" name="claimId" value={claim.id} />
                <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Reason / note
                  <input
                    type="text"
                    name="note"
                    maxLength={1000}
                    placeholder="Recorded with the decision"
                    className="mt-1 w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    name="decision"
                    value="APPROVE"
                    className="inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white"
                  >
                    Approve
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="NEEDS_INFORMATION"
                    className="inline-flex h-10 items-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink"
                  >
                    Need more information
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="REJECT"
                    className="inline-flex h-10 items-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-danger"
                  >
                    Reject
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
