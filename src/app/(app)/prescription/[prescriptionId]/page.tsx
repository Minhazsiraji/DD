import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CloudOff, Lock } from "lucide-react";
import { requireLocationContext } from "@/lib/auth/session";
import { safeConsultationReturn } from "@/features/encounters/return-context";
import {
  getFinalizedPrescription,
  getPrescription,
  getPrescriptionLineage,
} from "@/features/prescriptions/queries";
import { PrescriptionComposer } from "@/features/prescriptions/components/prescription-composer";
import { FinalizedPrescription } from "@/features/prescriptions/components/finalized-prescription";

export const metadata: Metadata = { title: "Prescription" };

export default async function PrescriptionPage({
  params,
  searchParams,
}: PageProps<"/prescription/[prescriptionId]">) {
  const { prescriptionId } = await params;
  const query = await searchParams;
  const returnTo = safeConsultationReturn(query.returnTo);
  const ctx = await requireLocationContext();

  const finalized = await getFinalizedPrescription(prescriptionId, ctx.locationId);

  if (!finalized.ok && finalized.reason === "unsupported-schema") {
    return (
      <Unavailable
        icon={<Lock className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
        title="This prescription cannot be shown safely"
        body="It was created by a newer version of Doctor's Diary. Update the app before viewing or printing it — showing it here could leave something out."
        returnTo={returnTo}
      />
    );
  }

  if (finalized.ok) {
    const lineage = await getPrescriptionLineage(
      prescriptionId,
      finalized.finalized.locationId,
    );

    return (
      <FinalizedPrescription
        prescriptionId={prescriptionId}
        encounterId={finalized.finalized.encounterId}
        viewerIsOwner={finalized.finalized.viewerIsOwner}
        finalizedAt={finalized.finalized.finalizedAt}
        digest={finalized.finalized.digest}
        bundle={finalized.finalized.bundle}
        lineage={lineage.ok ? lineage.lineage : null}
        lineageUnavailable={!lineage.ok}
        returnTo={returnTo}
      />
    );
  }

  if (finalized.reason === "unavailable") {
    return (
      <Unavailable
        title="This approved prescription could not be loaded"
        body="It exists and is part of the patient's record — we simply could not reach it just now. Try again in a moment."
        returnTo={returnTo}
      />
    );
  }

  const outcome = await getPrescription(prescriptionId, ctx.locationId);

  if (!outcome.ok && outcome.reason === "unavailable") {
    return (
      <Unavailable
        title="This prescription could not be loaded"
        body="It exists — we simply could not reach it just now. Do not start another one for this patient; try again in a moment so their medicines stay on one paper."
        returnTo={returnTo}
      />
    );
  }

  if (!outcome.ok) notFound();

  const backHref = returnTo ?? `/consultation/${outcome.prescription.encounterId}`;
  const backLabel = returnTo ? "Return to current consultation" : "Back to the consultation";

  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {backLabel}
      </Link>

      <PrescriptionComposer prescription={outcome.prescription} locationName={ctx.locationName} />
    </div>
  );
}

function Unavailable({
  title,
  body,
  icon,
  returnTo,
}: {
  title: string;
  body: string;
  icon?: React.ReactNode;
  returnTo?: string | null;
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      {icon ?? <CloudOff className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
      <h1 className="mt-3 text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-[13px] text-ink-secondary">{body}</p>
      <Link
        href={returnTo ?? "/queue"}
        className="mt-5 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {returnTo ? "Return to current consultation" : "Back to the queue"}
      </Link>
    </div>
  );
}
