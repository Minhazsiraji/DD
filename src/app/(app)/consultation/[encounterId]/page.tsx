import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CloudOff, MapPinOff } from "lucide-react";
import { requireLocationContext } from "@/lib/auth/session";
import { getConsultation } from "@/features/encounters/queries";
import { ConsultationWorkspace } from "@/features/encounters/components/consultation-workspace";

export const metadata: Metadata = { title: "Consultation" };

/**
 * The consultation screen.
 *
 * Reached by id, and the id alone proves nothing — RLS decides whether this
 * doctor may read the row at all, and the save RPC re-checks the location on
 * every write. Nothing here is a security boundary; it is presentation over a
 * boundary that already exists.
 */
export default async function ConsultationPage({
  params,
}: PageProps<"/consultation/[encounterId]">) {
  const { encounterId } = await params;
  const ctx = await requireLocationContext();
  const outcome = await getConsultation(encounterId, ctx.locationId);

  /**
   * Belongs to them, but not to here.
   *
   * Fail closed: no identity strip, no editable notes, no save attempt. The
   * doctor is told which location to switch to, because they already have
   * access to it — withholding the name would leave them stuck rather than
   * safe. The RPC's own location check remains the final boundary.
   */
  if (!outcome.ok && outcome.reason === "wrong-location") {
    const home = ctx.memberships.find((m) => m.locationId === outcome.locationId);
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <MapPinOff className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-ink">
          This consultation belongs to another location
        </h1>
        <p className="mt-2 text-[13px] text-ink-secondary">
          You are working at <strong className="font-semibold text-ink">{ctx.locationName}</strong>,
          and these notes were started
          {home ? (
            <>
              {" "}
              at <strong className="font-semibold text-ink">{home.locationName}</strong>
            </>
          ) : (
            " somewhere else"
          )}
          . Switch location from the top bar to open them — a consultation stays with the place it
          happened.
        </p>
        <Link
          href="/queue"
          className="mt-5 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the queue
        </Link>
      </div>
    );
  }

  /**
   * "We could not read it" is NOT "it does not exist".
   *
   * Telling a doctor the consultation is gone when the database is merely
   * unreachable invites them to start a second one and write into it — the
   * visit ends up split across two half-records. So the two outcomes get two
   * different screens, and only one of them is a 404.
   */
  if (!outcome.ok && outcome.reason === "unavailable") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <CloudOff className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-ink">
          This consultation could not be loaded
        </h1>
        <p className="mt-2 text-[13px] text-ink-secondary">
          The record exists — we simply could not reach it just now. Do not start a new
          consultation for this patient; try again in a moment so their notes stay in one place.
        </p>
        <Link
          href="/queue"
          className="mt-5 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the queue
        </Link>
      </div>
    );
  }

  if (!outcome.ok) notFound();

  return (
    <ConsultationWorkspace
      consultation={outcome.consultation}
      locationName={ctx.locationName}
    />
  );
}
