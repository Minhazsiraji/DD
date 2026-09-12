import * as React from "react";
import { CircleSlash, CloudOff, EyeOff, Sparkles } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { formatMeasurement } from "../measurement";
import { labelFor, SERVICE_KIND_LABEL, UNIT_LABEL, type ServiceUsage } from "../contract";
import type { ServiceUsageResult } from "../sources";

/**
 * AI and Voice usage, at the grain O1-F publishes it: provider, model, service
 * kind and unit.
 *
 * THE DIMENSIONS ARE PRESERVED, NOT COLLAPSED. Rolling four models into one
 * "AI" row would hide the only thing this table is for — which provider and
 * which model the pilot is actually spending on.
 *
 * WHAT IS NOT HERE, by contract: no operation id, no proposal id, no grant id,
 * no patient or encounter id, no prompt, no completion, no transcript, no
 * audio, no clinical task text, no latency and no failure payload. O1-E's
 * projection carries exactly ten columns and none of those are among them.
 *
 * SUPPRESSED BUCKETS ARE ANNOUNCED. When F withholds a bucket under k=5 the
 * table says so. Dropping the row silently would read as "that provider was
 * never used", which is a different and false claim.
 */
export function UsageTable({ result, cohort }: { result: ServiceUsageResult; cohort: string | null }) {
  if (result.state !== "measured") {
    return <UsageAbsent title="Usage unavailable" body="The approved owner service-usage surface did not answer. This is not zero usage." icon="unavailable" />;
  }

  const { usage } = result;

  if (usage.rows.length === 0) return <UsageEmpty usage={usage} />;

  return (
    <SectionCard className="overflow-hidden" data-usage-table>
      <SectionHeader
        title={cohort ? `AI & Voice usage · ${cohort}` : "AI & Voice usage"}
        icon={<Sparkles className="size-4" />}
        count={usage.rows.length}
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead className="bg-white/85">
            <tr className="border-b border-hairline">
              {["Provider", "Model", "Service", "Unit", "Quantity", "Events"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2.5 font-semibold whitespace-nowrap text-ink-secondary first:pl-5 last:pr-5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {usage.rows.map((r, i) => {
              const quantity = formatMeasurement(r.quantity, "COUNT");
              const events = formatMeasurement(r.events, "COUNT");
              return (
                <tr key={`${r.providerId}-${r.modelId}-${r.unit}-${i}`}>
                  <th scope="row" className="px-3 py-2.5 pl-5 font-semibold whitespace-nowrap text-ink">
                    {r.providerId ?? "—"}
                  </th>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary">{r.modelId ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary">
                    {labelFor(SERVICE_KIND_LABEL, r.serviceKind)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary">{labelFor(UNIT_LABEL, r.unit)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink tabular-nums">
                    <span className="sr-only">{quantity.spoken}</span>
                    <span aria-hidden="true">{quantity.display}</span>
                  </td>
                  <td className="px-3 py-2.5 pr-5 whitespace-nowrap text-ink tabular-nums">
                    <span className="sr-only">{events.spoken}</span>
                    <span aria-hidden="true">{events.display}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {usage.hasSuppressedBuckets ? <SuppressionNote /> : null}
    </SectionCard>
  );
}

export function SuppressionNote() {
  return (
    <p
      className="flex min-w-0 items-start gap-2 border-t border-hairline px-4 py-3 text-xs text-ink-secondary sm:px-5"
      data-suppression-note
    >
      <EyeOff className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <span>
        <strong className="font-semibold text-ink">Insufficient cohort:</strong> at least one
        provider or model bucket is withheld because fewer than five doctors contributed to it.
        Those buckets are not zero, and the totals shown exclude them.
      </span>
    </p>
  );
}

function UsageEmpty({ usage }: { usage: ServiceUsage }) {
  if (usage.status === "OK") {
    return (
      <UsageAbsent
        title="No usage in this window"
        body="The approved source answered for the whole window and reported no AI or Voice usage. This is a measured zero."
        icon="measured"
      />
    );
  }
  if (usage.status === "NOT_MEASURED") {
    return (
      <UsageAbsent
        title="Usage not measured"
        body="Measurement coverage for this window is absent or incomplete, so no usage total is published. This is not zero usage."
        icon="not-measured"
      />
    );
  }
  if (usage.status === "INSUFFICIENT_COHORT") {
    return (
      <UsageAbsent
        title="Insufficient cohort"
        body="Fewer than five consented doctors contributed to this cohort, so usage is withheld to avoid identifying one. This is not zero usage."
        icon="insufficient"
      />
    );
  }
  return (
    <UsageAbsent
      title="Usage unavailable"
      body="The approved owner service-usage surface did not answer. This is not zero usage."
      icon="unavailable"
    />
  );
}

function UsageAbsent({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: "unavailable" | "not-measured" | "insufficient" | "measured";
}) {
  const Icon = icon === "insufficient" ? EyeOff : icon === "not-measured" ? CircleSlash : CloudOff;
  return (
    <SectionCard className="overflow-hidden" data-usage-table data-usage-state={icon}>
      <SectionHeader title="AI & Voice usage" icon={<Sparkles className="size-4" />} />
      <div className="flex min-w-0 items-start gap-3 px-4 py-5 sm:px-5">
        {icon === "measured" ? null : <Icon className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden="true" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-1 text-[13px] text-ink-secondary">{body}</p>
        </div>
      </div>
    </SectionCard>
  );
}
