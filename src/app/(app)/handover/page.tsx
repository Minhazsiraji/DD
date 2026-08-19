import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, FileText, History, Printer } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { requireLocationContext } from "@/lib/auth/session";
import { formatDate, formatInstantTime } from "@/lib/format";
import { getFinalizedPrescriptionsAt } from "@/features/prescriptions/queries";

export const metadata: Metadata = { title: "Prescriptions to hand over" };

/**
 * Signed prescriptions, ready to give to the patient at THIS location.
 *
 * The front desk's way in. It exists because there was not one: the database
 * has had `finalized_prescriptions_at` since Stage 7A and nothing called it, so
 * the only route to a finalised prescription ran through the doctor's own
 * consultation screen — which reception cannot open. Handing paper to a patient
 * should not require being sent a link.
 *
 * Deliberately NOT a patient record and not a clinical list. A row carries who
 * it is for, when it was signed and how many medicines are on it — enough to
 * find the right sheet at a desk with someone waiting, and nothing more. The
 * medicines themselves are on the prescription, behind one more click, where
 * the person holding it can see them.
 *
 * The location is the caller's active one, never a query parameter. The RPC
 * re-checks membership and answers identically for a clinic that is not theirs
 * and one that does not exist.
 */
export default async function HandoverPage() {
  const ctx = await requireLocationContext();
  const outcome = await getFinalizedPrescriptionsAt(ctx.locationId);

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Hand over"
        title={ctx.locationName}
        subtitle="Signed prescriptions, ready to print and give to the patient."
      />

      {/*
        An empty list and a failed read are different statements, and only one
        of them should let someone tell a patient there is nothing for them.
      */}
      {!outcome.ok ? (
        <p className="flex items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          This list could not be loaded, so nothing is shown. That is not the
          same as there being nothing to hand over — reload before telling
          anyone their prescription is not ready.
        </p>
      ) : outcome.items.length === 0 ? (
        <SectionCard>
          <div className="flex items-start gap-3 p-5">
            <FileText className="mt-px size-5 shrink-0 text-ink-muted" aria-hidden="true" />
            <p className="text-[13px] text-ink-secondary">
              Nothing to hand over here yet. A prescription appears once the doctor has signed it.
            </p>
          </div>
        </SectionCard>
      ) : (
        <ul className="space-y-2">
          {outcome.items.map((item) => (
            <li key={item.prescriptionId}>
              <Link
                href={`/prescription/${item.prescriptionId}`}
                className={`flex min-h-16 items-center justify-between gap-4 rounded-glass px-4 py-3 transition-colors focus-visible:focus-ring ${
                  item.isSuperseded
                    ? /*
                        Still listed, still openable — history stays complete and
                        a doctor must be able to find what was issued that day.
                        But it is visibly not the one to print: no white clinical
                        surface, no printer icon, dimmed text.
                      */
                      "border border-dashed border-hairline bg-surface-muted/40 hover:bg-surface-muted"
                    : "clinical-surface hover:bg-surface-muted"
                }`}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={`truncate text-[15px] font-semibold ${
                        item.isSuperseded ? "text-ink-secondary" : "text-ink"
                      }`}
                    >
                      {item.patientName}
                    </span>
                    {/*
                      Never colour alone. The scenario this exists for: V1 is
                      printed, the doctor corrects it, V2 is signed — and both
                      are FINALIZED prescriptions for the same patient minutes
                      apart. Without this the front desk has no way to tell
                      which one the patient should leave with, and handing over
                      V1 hands over the dose that was corrected.
                    */}
                    {item.isSuperseded ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-ink">
                        <History className="size-3" aria-hidden="true" />
                        Superseded — do not hand over
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-[12px] text-ink-secondary">
                    {item.patientNumber ? (
                      <span className="font-mono tabular-nums">{item.patientNumber}</span>
                    ) : null}
                    {item.patientNumber ? " · " : ""}
                    {item.itemCount} {item.itemCount === 1 ? "medicine" : "medicines"}
                    {item.finalizedAt
                      ? ` · signed ${formatDate(item.finalizedAt.slice(0, 10))} ${formatInstantTime(item.finalizedAt)}`
                      : ""}
                    {item.isSuperseded ? " · a corrected prescription replaces this one" : ""}
                  </span>
                </span>
                {item.isSuperseded ? (
                  <History className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
                ) : (
                  <Printer className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
