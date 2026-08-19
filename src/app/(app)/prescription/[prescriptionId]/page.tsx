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
 * One prescription, for whoever is authorised to see it.
 *
 * THE FINALISED READ COMES FIRST, and that ordering is the Stage 7C-3C change.
 *
 * It used to load the composer's `prescription_detail` first, purely to learn
 * the status, and only then fetch the approved snapshot. For the doctor that
 * was merely a wasted read. For RECEPTION it was the wrong read entirely:
 * `prescription_detail` returns LIVE `prescription_items`, so the front desk
 * was served the editable clinical rows on their way to a document they are
 * only allowed to hand over. Asking for the finalised snapshot first means
 * staff never touch that path at all — they cannot reach the composer's data,
 * because nothing on their route requests it.
 *
 * The id alone proves nothing here. `finalized_prescription_detail` decides
 * whether this caller may read it AT THIS LOCATION, and it answers identically
 * for missing, not-yours, elsewhere and still-DRAFT. Nothing on this page is a
 * security boundary; it is presentation over one that already exists.
 */
export default async function PrescriptionPage({
  params,
}: PageProps<"/prescription/[prescriptionId]">) {
  const { prescriptionId } = await params;
  const ctx = await requireLocationContext();

  const finalized = await getFinalizedPrescription(prescriptionId, ctx.locationId);

  /**
   * A snapshot written by a newer build. Refusing is the point: rendering it
   * with today's rules would drop whatever that version added — silently, on a
   * permanent clinical record — and printing it would put the gap on paper.
   *
   * Staff get exactly this refusal, not a weaker parser. There is no reading of
   * "most of" a prescription that is safe to hand to a patient.
   *
   * Deliberately NOT the "try again in a moment" message: waiting will never
   * fix a version problem, and saying otherwise sends someone away to retry.
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

  if (finalized.ok) {
    return (
      <FinalizedPrescription
        prescriptionId={prescriptionId}
        encounterId={finalized.finalized.encounterId}
        viewerIsOwner={finalized.finalized.viewerIsOwner}
        finalizedAt={finalized.finalized.finalizedAt}
        digest={finalized.finalized.digest}
        bundle={finalized.finalized.bundle}
      />
    );
  }

  if (finalized.reason === "unavailable") {
    return (
      <Unavailable
        title="This approved prescription could not be loaded"
        body="It exists and is part of the patient's record — we simply could not reach it just now. Try again in a moment."
      />
    );
  }

  /**
   * Not finalised — so this is the composer, and the composer is the doctor's.
   *
   * `prescription_detail` refuses a DRAFT to anyone but the owner, so reception
   * following a stale link lands on `notFound()` below rather than on an
   * editing surface. The refusal is the database's; this is just what it looks
   * like.
   */
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
      <Unavailable
        title="This prescription could not be loaded"
        body="It exists — we simply could not reach it just now. Do not start another one for this patient; try again in a moment so their medicines stay on one paper."
      />
    );
  }

  if (!outcome.ok) notFound();

  return (
    <div className="space-y-4">
      <Link
        href={`/consultation/${outcome.prescription.encounterId}`}
        className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the consultation
      </Link>

      <PrescriptionComposer prescription={outcome.prescription} locationName={ctx.locationName} />
    </div>
  );
}

function Unavailable({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
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
