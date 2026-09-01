import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CloudOff, FileText, MapPinOff } from "lucide-react";
import { requireLocationContext } from "@/lib/auth/session";
import { getConsultation } from "@/features/encounters/queries";
import {
  getEncounterFinalizedPrescription,
  getPreviousVisit,
  getVisitType,
} from "@/features/encounters/previous-visit";
import {
  safeConsultationReturn,
  withConsultationReturn,
} from "@/features/encounters/return-context";
import { opensPreviousVisit } from "@/features/encounters/visit-type";
import { ConsultationWorkspace } from "@/features/encounters/components/consultation-workspace";
import { getRxModulesAction } from "@/features/doctor/rx-module-actions";

export const metadata: Metadata = { title: "Consultation" };

/**
 * One consultation. Historical records may be opened from today's visit with a
 * tightly allow-listed `returnTo` path so the doctor can inspect old notes/Rx
 * and get back to the unfinished current consultation without browser history.
 */
export default async function ConsultationPage({
  params,
  searchParams,
}: PageProps<"/consultation/[encounterId]">) {
  const { encounterId } = await params;
  const query = await searchParams;
  const returnTo = safeConsultationReturn(query.returnTo);
  const ctx = await requireLocationContext();
  const outcome = await getConsultation(encounterId, ctx.locationId);

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
          href={returnTo ?? "/queue"}
          className="mt-5 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {returnTo ? "Return to current consultation" : "Back to the queue"}
        </Link>
      </div>
    );
  }

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
          href={returnTo ?? "/queue"}
          className="mt-5 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {returnTo ? "Return to current consultation" : "Back to the queue"}
        </Link>
      </div>
    );
  }

  if (!outcome.ok) notFound();

  const [previousVisit, visitType, modules, encounterPrescription] = await Promise.all([
    getPreviousVisit(outcome.consultation.patient.id, encounterId),
    getVisitType(outcome.consultation.appointmentId),
    getRxModulesAction(),
    outcome.consultation.status === "DRAFT"
      ? Promise.resolve(null)
      : getEncounterFinalizedPrescription(outcome.consultation.patient.id, encounterId),
  ]);

  return (
    <div className="space-y-3">
      {returnTo ? (
        <Link
          href={returnTo}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Return to current consultation
        </Link>
      ) : null}

      {encounterPrescription ? (
        <div className="clinical-surface flex min-w-0 flex-col gap-2 rounded-glass px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">Prescription from this consultation</p>
            <p className="text-[12px] text-ink-secondary">
              {encounterPrescription.medicineCount}{" "}
              {encounterPrescription.medicineCount === 1 ? "medicine" : "medicines"} · finalized
            </p>
          </div>
          <Link
            href={withConsultationReturn(
              `/prescription/${encounterPrescription.id}`,
              returnTo,
            )}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring sm:w-auto"
          >
            <FileText className="size-4" aria-hidden="true" />
            Open prescription
          </Link>
        </div>
      ) : null}

      <ConsultationWorkspace
        consultation={outcome.consultation}
        locationName={ctx.locationName}
        previousVisit={previousVisit}
        expandPreviousVisit={opensPreviousVisit(visitType)}
        moduleConfig={modules.ok ? modules.modules : null}
      />
    </div>
  );
}
