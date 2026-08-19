import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CloudOff, Lock } from "lucide-react";
import { requireLocationContext } from "@/lib/auth/session";
import { getFinalizedPrescription, getPrescription } from "@/features/prescriptions/queries";
import { PrescriptionComposer } from "@/features/prescriptions/components/prescription-composer";
import { FinalizedPrescription } from "@/features/prescriptions/components/finalized-prescription";

export const metadata: Metadata = { title: "Prescription" };

/**
 * The prescription composer.
 *
 * Reached by id, and the id alone proves nothing — `prescription_detail`
 * decides whether this doctor may read it AT THIS LOCATION, and every write
 * re-checks the same thing. Nothing here is a security boundary; it is
 * presentation over one that already exists.
 */
export default async function PrescriptionPage({
  params,
}: PageProps<"/prescription/[prescriptionId]">) {
  const { prescriptionId } = await params;
  const ctx = await requireLocationContext();
  const outcome = await getPrescription(prescriptionId, ctx.locationId);

  /**
   * "We could not read it" is NOT "it does not exist".
   *
   * Telling a doctor the prescription is gone when the database is merely
   * unreachable invites them to write a second one, and the patient leaves
   * holding two.
   */
  if (!outcome.ok && outcome.reason === "unavailable") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <CloudOff className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-ink">
          This prescription could not be loaded
        </h1>
        <p className="mt-2 text-[13px] text-ink-secondary">
          It exists — we simply could not reach it just now. Do not start another one for this
          patient; try again in a moment so their medicines stay on one paper.
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

  /**
   * An approved prescription is a different document, not a locked composer.
   *
   * It is served by `finalized_prescription_detail`, which reads ONLY the
   * immutable snapshot — so the permanent record has no route to today's
   * doctor, patient, location or template rows, and cannot drift when they
   * change. The composer is never rendered for it, so there is no editing
   * control to disable and no approval control to hide.
   */
  if (outcome.prescription.status === "FINALIZED") {
    const finalized = await getFinalizedPrescription(prescriptionId, ctx.locationId);

    /**
     * A snapshot written by a newer build. Refusing is the point: rendering it
     * with today's rules would drop whatever that version added — silently, on
     * a permanent clinical record — and printing it would put the gap on paper.
     *
     * Deliberately NOT the "try again in a moment" message below: waiting will
     * never fix a version problem, and telling a doctor to retry is telling
     * them the wrong thing.
     */
    if (!finalized.ok && finalized.reason === "unsupported-schema") {
      return (
        <Unavailable
          icon={<Lock className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
          title="This prescription cannot be shown safely"
          body="It was created by a newer version of Doctor's Diary. Update the app before viewing or printing it — showing it here could leave something out."
        />
      );
    }

    if (!finalized.ok) {
      return (
        <Unavailable
          title="This approved prescription could not be loaded"
          body="It exists and is part of the patient's record — we simply could not reach it just now. Try again in a moment."
        />
      );
    }

    return (
      <FinalizedPrescription
        prescriptionId={prescriptionId}
        encounterId={outcome.prescription.encounterId}
        finalizedAt={finalized.finalized.finalizedAt}
        digest={finalized.finalized.digest}
        bundle={finalized.finalized.bundle}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/consultation/${outcome.prescription.encounterId}`}
        className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the consultation
      </Link>

      <PrescriptionComposer
        prescription={outcome.prescription}
        locationName={ctx.locationName}
      />
    </div>
  );
}

function Unavailable({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      {icon ?? <CloudOff className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
      <h1 className="mt-3 text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-[13px] text-ink-secondary">{body}</p>
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
