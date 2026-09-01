import { CircleCheck, CircleDashed, Info, ShieldCheck } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { formatDate } from "@/lib/format";
import { renderMoney } from "../catalog";
import { STATE_LABEL, STATE_MEANING, needsAttention, type CommercialSummary } from "../state";
import {
  ENTITLEMENTS,
  ENTITLEMENT_LABEL,
  describeAllowance,
  allows,
  type PlanEntitlements,
} from "../entitlements";

/**
 * The plan, its state, and what it includes.
 *
 * NOTHING ON THIS CARD IS INVENTED. A period with no start renders "—", not
 * today; a plan with no configured price renders "Not set", not zero. The
 * subscription table genuinely has nulls in it — a PILOT account has never had
 * a billing period — and filling them in would put a date on screen that no
 * row anywhere supports.
 *
 * THE RAW STATUS REMAINS AVAILABLE FOR SUPPORT without making an internal
 * database vocabulary part of the ordinary doctor-facing summary. The
 * six-state commercial vocabulary is a projection of seven database statuses;
 * the source value is kept in a small disclosure so support can still inspect
 * what the account actually says.
 */

/** An ISO instant to a date, without pretending to know the doctor's clock. */
function day(iso: string | null): string {
  if (!iso) return "—";
  const date = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDate(date) : "—";
}

interface Props {
  summary: CommercialSummary;
  entitlements: PlanEntitlements;
}

export function PlanCard({ summary, entitlements }: Props) {
  const price = renderMoney(summary.monthlyPrice);
  const attention = summary.state ? needsAttention(summary.state) : true;

  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Your plan"
        icon={<ShieldCheck className="size-4" />}
        action={
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset " +
              (attention
                ? "bg-warning-soft text-[#8a3f07] ring-[#f2d5b0]"
                : "bg-success-soft text-[#07684a] ring-[#b9e7d5]")
            }
          >
            {attention ? (
              <Info className="size-3.5" aria-hidden="true" />
            ) : (
              <CircleCheck className="size-3.5" aria-hidden="true" />
            )}
            {summary.state ? STATE_LABEL[summary.state] : "Status needs review"}
          </span>
        }
      />

      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink">{summary.planName}</h3>
            <p className="mt-0.5 text-xs text-ink-muted">Plan code {summary.planCode}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-muted">Monthly price</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
              {price ?? "Not set"}
            </p>
          </div>
        </div>

        <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink-secondary">
          {summary.state
            ? STATE_MEANING[summary.state]
            : "This account is in a state this version does not recognise. Your patient records are unaffected and stay open to you."}
        </p>

        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {summary.trialEndsAt ? (
            <div>
              <dt className="text-xs text-ink-muted">Trial ends</dt>
              <dd className="tabular-nums text-ink">{day(summary.trialEndsAt)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-ink-muted">Current period</dt>
            <dd className="tabular-nums text-ink">
              {summary.periodStart || summary.periodEnd
                ? `${day(summary.periodStart)} → ${day(summary.periodEnd)}`
                : "Not started"}
            </dd>
          </div>
          {summary.graceUntil ? (
            <div>
              <dt className="text-xs text-ink-muted">Grace until</dt>
              <dd className="tabular-nums text-ink">{day(summary.graceUntil)}</dd>
            </div>
          ) : null}
          {summary.founderDiscountPercent !== null ? (
            <div>
              <dt className="text-xs text-ink-muted">Founding-doctor discount</dt>
              <dd className="tabular-nums text-ink">{summary.founderDiscountPercent}%</dd>
            </div>
          ) : null}
          {summary.cancelAtPeriodEnd ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-ink-muted">Scheduled</dt>
              <dd className="text-ink">
                Ends at the close of the current period. Your records stay.
              </dd>
            </div>
          ) : null}
        </dl>

        <div>
          <h4 className="text-sm font-semibold text-ink">What this plan includes</h4>
          <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {ENTITLEMENTS.map((key) => {
              const on = allows(entitlements, key);
              return (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <span
                    className={on ? "text-[#07684a]" : "text-ink-muted"}
                    aria-hidden="true"
                  >
                    {on ? <CircleCheck className="size-4" /> : <CircleDashed className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-secondary">
                    {ENTITLEMENT_LABEL[key]}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-ink">
                    {describeAllowance(key, entitlements[key])}
                  </span>
                </li>
              );
            })}
          </ul>
          {/*
            The sentence this whole feature exists to be able to write, and the
            reason the entitlement list above has no clinical row in it.
          */}
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-brand-soft/50 px-4 py-3 text-xs text-ink-secondary">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <span>
              Your patients, consultations and prescriptions are not on this
              list, and never will be. They are yours regardless of plan,
              payment or status — nothing above can withhold them.
            </span>
          </p>
        </div>

        <details className="rounded-xl border border-hairline bg-surface-muted/60 px-4 py-3 text-xs text-ink-secondary">
          <summary className="cursor-pointer font-semibold text-ink">Support details</summary>
          <p className="mt-2 break-words">
            Plan code <code>{summary.planCode}</code> · source subscription status{" "}
            <code>{summary.rawStatus}</code>
          </p>
        </details>
      </div>
    </SectionCard>
  );
}
