import * as React from "react";
import Link from "next/link";
import { Stethoscope, ArrowRight, Clock, UserCheck } from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { PatientSafetyHeader } from "@/components/clinical/patient-safety-header";
import { PaymentBadge } from "@/components/common/status-badge";
import { formatTime, VISIT_TYPE_LABEL, formatAgeSex } from "@/lib/format";
import type { QueueEntry } from "@/mocks/types";

/**
 * NowServing — the dashboard's primary action zone.
 *
 * A doctor should be able to open the app and reach the next patient in one
 * tap. Everything else on this page is secondary to that.
 */
export function NowServing({
  currentToken,
  current,
  next,
}: {
  currentToken: number | null;
  current: QueueEntry | null;
  next: QueueEntry | null;
}) {
  return (
    <GlassCard tone="strong" className="overflow-hidden p-0">
      <div className="grid gap-0 lg:grid-cols-[1.35fr_1fr]">
        {/* ---- Current patient ---- */}
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-brand uppercase">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              Now with you
            </p>
            {currentToken !== null ? (
              <span className="rounded-full bg-[image:var(--grad-brand)] px-3.5 py-1.5 text-sm font-bold text-white shadow-[0_6px_16px_rgb(var(--glow-brand)/0.34)] tabular-nums">
                Token {currentToken}
              </span>
            ) : null}
          </div>

          {current ? (
            <>
              <PatientSafetyHeader
                patient={current.patient}
                variant="full"
                className="mt-3"
              />

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <Stethoscope className="size-3.5 text-ink-muted" aria-hidden="true" />
                  {VISIT_TYPE_LABEL[current.visitType]}
                </span>
                {current.checkedInAt ? (
                  <span className="inline-flex items-center gap-1.5">
                    <UserCheck className="size-3.5 text-ink-muted" aria-hidden="true" />
                    Checked in {formatTime(current.checkedInAt)}
                  </span>
                ) : null}
                <PaymentBadge status={current.paymentStatus} />
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Link
                  href={`/consultation/${current.id}`}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100"
                >
                  Open consultation
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link
                  href={`/patients/${current.patient.id}`}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-[background-color,transform] duration-200 hover:bg-surface-muted active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100"
                >
                  Patient record
                </Link>
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-ink-secondary">
              No patient in consultation.
            </p>
          )}
        </div>

        {/* ---- Next patient ---- */}
        <div className="border-t border-glass-border bg-white/45 p-4 sm:p-5 lg:border-t-0 lg:border-l">
          <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Up next
          </p>

          {next ? (
            <>
              {/* Same tap/hover affordance as the stat tiles — a card that
                  looks pressable must behave pressably on touch too. */}
              <Link
                href={`/patients/${next.patient.id}`}
                className="mt-3 -mx-2 flex items-start gap-3 rounded-xl px-2 py-2 transition-[background-color,transform] duration-200 hover:bg-white/70 active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100"
              >
                <span className="inset-panel flex size-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-brand tabular-nums">
                  {next.tokenNumber}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-ink">
                    {next.patient.fullName}
                  </p>
                  <p className="text-[13px] text-ink-secondary tabular-nums">
                    {formatAgeSex(
                      next.patient.ageYears,
                      next.patient.sex,
                      next.patient.dobPrecision,
                    )}{" "}
                    · {VISIT_TYPE_LABEL[next.visitType]}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-ink-secondary">
                    <Clock className="size-3.5 text-ink-muted" aria-hidden="true" />
                    Expected{" "}
                    <strong className="font-semibold text-ink tabular-nums">
                      {formatTime(next.expectedAt)}
                    </strong>
                  </p>
                </div>
              </Link>

              {next.patient.allergies.length > 0 ? (
                <p className="mt-3 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs font-semibold text-[#a81c1c]">
                  Allergy: {next.patient.allergies.join(", ")}
                </p>
              ) : null}

              <div className="mt-3 flex items-center gap-2">
                <PaymentBadge status={next.paymentStatus} />
              </div>

              <button
                type="button"
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand bg-white px-4 text-sm font-semibold text-brand transition-[background-color,transform] duration-200 hover:bg-brand-soft active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100"
              >
                Call next patient
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-secondary">Queue is clear.</p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
