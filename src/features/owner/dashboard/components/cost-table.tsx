import * as React from "react";
import { CircleSlash, CloudOff, EyeOff, Wallet } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { formatCostMinor, totalCostMinor } from "../cost";
import { labelFor, SERVICE_KIND_LABEL, type ServiceUsageRow } from "../contract";
import type { ServiceUsageResult } from "../sources";
import { SuppressionNote } from "./usage-table";

/**
 * What the pilot cost, per provider and model, and what it adds up to.
 *
 * FOUR COST RULES, all of them the difference between a useful number and a
 * misleading one:
 *
 *   NULL IS NOT ZERO. O1-F nulls a bucket's cost when any contributing event
 *   has an unknown cost. That bucket reads "Not measured".
 *
 *   A PARTIAL SUM IS NOT A TOTAL. One unknown bucket and the total for that
 *   currency is "Not measured" too. Adding up what we happen to know and
 *   labelling it "Total" understates spend while looking authoritative.
 *
 *   A POSITIVE SUB-CENT COST IS NOT ZERO. It prints "<$0.01".
 *
 *   THE CURRENCY IS F's. It is never replaced with an assumed default, and
 *   amounts in different currencies are never added together.
 */
export function CostTable({ result, cohort }: { result: ServiceUsageResult; cohort: string | null }) {
  if (result.state !== "measured") {
    return (
      <CostAbsent
        title="Cost unavailable"
        body="The approved owner service-usage surface did not answer, so no cost is published. This is not zero cost."
        icon="unavailable"
      />
    );
  }

  const { usage } = result;

  if (usage.rows.length === 0) {
    if (usage.status === "OK") {
      return (
        <CostAbsent
          title="No cost in this window"
          body="The approved source answered for the whole window and reported no billable usage. This is a measured zero."
          icon="measured"
        />
      );
    }
    if (usage.status === "NOT_MEASURED") {
      return (
        <CostAbsent
          title="Cost not measured"
          body="Measurement coverage for this window is absent or incomplete, so no cost is published. This is not zero cost."
          icon="not-measured"
        />
      );
    }
    if (usage.status === "INSUFFICIENT_COHORT") {
      return (
        <CostAbsent
          title="Insufficient cohort"
          body="Fewer than five consented doctors contributed to this cohort, so cost is withheld to avoid identifying one. This is not zero cost."
          icon="insufficient"
        />
      );
    }
    return (
      <CostAbsent
        title="Cost unavailable"
        body="The approved owner service-usage surface did not answer. This is not zero cost."
        icon="unavailable"
      />
    );
  }

  const byCurrency = new Map<string, ServiceUsageRow[]>();
  for (const row of usage.rows) {
    const key = row.currency ?? "";
    const bucket = byCurrency.get(key);
    if (bucket) bucket.push(row);
    else byCurrency.set(key, [row]);
  }

  return (
    <SectionCard className="overflow-hidden" data-cost-table>
      <SectionHeader title={cohort ? `Cost · ${cohort}` : "Cost"} icon={<Wallet className="size-4" />} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead className="bg-white/85">
            <tr className="border-b border-hairline">
              {["Provider", "Model", "Service", "Currency", "Cost"].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2.5 font-semibold whitespace-nowrap text-ink-secondary first:pl-5 last:pr-5"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {usage.rows.map((r, i) => {
              const cost = formatCostMinor(r.costMinor, r.currency);
              return (
                <tr key={`${r.providerId}-${r.modelId}-${r.unit}-${i}`}>
                  <th scope="row" className="px-3 py-2.5 pl-5 font-semibold whitespace-nowrap text-ink">
                    {r.providerId ?? "—"}
                  </th>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary">{r.modelId ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary">
                    {labelFor(SERVICE_KIND_LABEL, r.serviceKind)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary">{r.currency ?? "—"}</td>
                  <td className="px-3 py-2.5 pr-5 whitespace-nowrap text-ink tabular-nums">
                    <span className="sr-only">{cost.spoken}</span>
                    <span aria-hidden="true">{cost.display}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-hairline">
            {[...byCurrency.entries()].map(([currency, rows]) => {
              const total = totalCostMinor(
                rows.map((r) => r.costMinor),
                currency === "" ? null : currency,
              );
              const formatted =
                total.state === "measured"
                  ? formatCostMinor(total.minor, total.currency)
                  : formatCostMinor(null, currency === "" ? null : currency);
              return (
                <tr key={currency || "unknown"} data-cost-total={currency || "unknown"}>
                  <th scope="row" colSpan={4} className="px-3 py-2.5 pl-5 text-left font-semibold text-ink">
                    Total{currency ? ` (${currency})` : ""}
                  </th>
                  <td className="px-3 py-2.5 pr-5 font-semibold whitespace-nowrap text-ink tabular-nums">
                    <span className="sr-only">{formatted.spoken}</span>
                    <span aria-hidden="true">{formatted.display}</span>
                  </td>
                </tr>
              );
            })}
          </tfoot>
        </table>
      </div>

      {usage.hasSuppressedBuckets ? <SuppressionNote /> : null}
    </SectionCard>
  );
}

function CostAbsent({
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
    <SectionCard className="overflow-hidden" data-cost-table data-cost-state={icon}>
      <SectionHeader title="Cost" icon={<Wallet className="size-4" />} />
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
