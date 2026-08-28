import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, FileText, History, Printer } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { requireLocationContext } from "@/lib/auth/session";
import { formatDate, formatInstantTime } from "@/lib/format";
import { getFinalizedPrescriptionsAt } from "@/features/prescriptions/queries";

export const metadata: Metadata = { title: "Prescriptions to hand over" };

export default async function HandoverPage() {
  const ctx = await requireLocationContext();
  const outcome = await getFinalizedPrescriptionsAt(ctx.locationId);

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Hand over"
        title={ctx.locationName}
        subtitle="Signed prescriptions, ready to print and give to the patient."
      />

      {!outcome.ok ? (
        <p className="flex min-w-0 items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            This list could not be loaded, so nothing is shown. That is not the
            same as there being nothing to hand over — reload before telling
            anyone their prescription is not ready.
          </span>
        </p>
      ) : outcome.items.length === 0 ? (
        <SectionCard>
          <div className="flex min-w-0 items-start gap-3 p-4 sm:p-5">
            <FileText className="mt-px size-5 shrink-0 text-ink-muted" aria-hidden="true" />
            <p className="min-w-0 break-words text-[13px] text-ink-secondary">
              Nothing to hand over here yet. A prescription appears once the doctor has signed it.
            </p>
          </div>
        </SectionCard>
      ) : (
        <ul className="min-w-0 space-y-2">
          {outcome.items.map((item) => (
            <li key={item.prescriptionId} className="min-w-0">
              <Link
                href={`/prescription/${item.prescriptionId}`}
                className={`flex min-h-16 min-w-0 items-start gap-3 rounded-glass px-4 py-3 transition-colors focus-visible:focus-ring sm:items-center sm:justify-between sm:gap-4 ${
                  item.isSuperseded
                    ? "border border-dashed border-hairline bg-surface-muted/40 hover:bg-surface-muted"
                    : "clinical-surface hover:bg-surface-muted"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className={`min-w-0 break-words text-[15px] font-semibold sm:truncate ${
                        item.isSuperseded ? "text-ink-secondary" : "text-ink"
                      }`}
                    >
                      {item.patientName}
                    </span>
                    {item.isSuperseded ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-ink">
                        <History className="size-3" aria-hidden="true" />
                        Superseded — do not hand over
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block break-words text-[12px] leading-relaxed text-ink-secondary sm:mt-0 sm:leading-normal">
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
                  <History className="mt-0.5 size-5 shrink-0 text-ink-muted sm:mt-0" aria-hidden="true" />
                ) : (
                  <Printer className="mt-0.5 size-5 shrink-0 text-ink-muted sm:mt-0" aria-hidden="true" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
