import Link from "next/link";
import {
  CalendarDays,
  ClipboardCheck,
  FileCheck2,
  FlaskConical,
  ListChecks,
  Stethoscope,
  TriangleAlert,
  Users,
  WalletCards,
} from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { STATUS_LABEL } from "@/features/appointments/schema";
import { cn } from "@/lib/utils";
import {
  ANALYTICS_PERIODS,
  type AnalyticsPeriod,
  type DoctorAnalyticsOutcome,
} from "../doctor-analytics";

const PERIOD_LABEL: Record<AnalyticsPeriod, string> = { 1: "Today", 7: "7 days", 30: "30 days", all: "All time" };

export function AnalyticsDashboard({ outcome, selected }: { outcome: DoctorAnalyticsOutcome; selected: AnalyticsPeriod }) {
  if (!outcome.ok) {
    return (
      <SectionCard className="p-6 sm:p-8">
        <div className="flex items-start gap-3 text-[#a81c1c]">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">
              {outcome.reason === "doctor-required" ? "Doctor access required" : "Analytics unavailable"}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {outcome.reason === "doctor-required"
                ? "This aggregate view is available only to an active Doctor at the selected chamber."
                : "The aggregate reads did not complete, so no zero values are shown. Reload before relying on this view."}
            </p>
          </div>
        </div>
      </SectionCard>
    );
  }

  const data = outcome.analytics;
  const empty = data.encounters === 0 && data.appointments === 0 && data.finalizedPrescriptions === 0;

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1 rounded-xl bg-white/55 p-1" aria-label="Analytics date range">
          {ANALYTICS_PERIODS.map((period) => (
            <Link
              key={period}
              href={`/analytics?period=${period}`}
              aria-current={selected === period ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:focus-ring",
                selected === period ? "bg-white text-brand shadow-soft" : "text-ink-secondary hover:text-ink",
              )}
            >
              {PERIOD_LABEL[period]}
            </Link>
          ))}
        </div>
        <p className="text-xs text-ink-muted">
          {data.startDate ? `${data.startDate} to ${data.endDateInclusive}` : `Through ${data.endDateInclusive}`} · {data.timeZone}
        </p>
      </div>

      <section aria-labelledby="practice-summary-heading">
        <h2 id="practice-summary-heading" className="mb-2 text-xs font-semibold tracking-wide text-ink-secondary uppercase">Doctor summary</h2>
        <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Patient encounters" value={data.patientCount} icon={<Users className="size-5" />} hint="Consultations started in this period" accent="success" />
          {(["Income", "Cost", "Net income"] as const).map((label) => (
            <SectionCard key={label} className="min-w-0 p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-muted"><WalletCards className="size-5" aria-hidden="true" /></span>
                <div className="min-w-0"><p className="text-xs font-semibold text-ink-secondary">{label}</p><p className="mt-1 text-sm font-semibold text-ink">Not configured</p><p className="mt-1 text-xs leading-4 text-ink-muted">{data.financials.reason}</p></div>
              </div>
            </SectionCard>
          ))}
        </div>
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Consultations" value={data.encounters} icon={<Stethoscope className="size-5" />} hint={`${data.completedEncounters} completed`} />
        <StatCard label="Appointments" value={data.appointments} icon={<CalendarDays className="size-5" />} hint="Booked in this chamber" accent="info" />
        <StatCard label="Finalized Rx" value={data.finalizedPrescriptions} icon={<FileCheck2 className="size-5" />} hint="Doctor-owned finalized prescriptions" accent="success" />
        <StatCard label="Follow-ups" value={data.followUps} icon={<ClipboardCheck className="size-5" />} hint="Follow-up appointments" accent="violet" />
        <StatCard label="Queue entries" value={data.queueEntries} icon={<ListChecks className="size-5" />} hint="Appointments issued a token" accent="warning" />
        <StatCard label="Investigations" value={data.investigationOrders} icon={<FlaskConical className="size-5" />} hint="Orders on consultations" accent="info" />
      </div>

      {empty ? (
        <SectionCard>
          <EmptyState
            icon={<Stethoscope className="size-5" />}
            title={`No activity for ${PERIOD_LABEL[selected].toLocaleLowerCase("en-US")}`}
            description="This is a true empty result from the selected doctor, chamber and date range."
          />
        </SectionCard>
      ) : (
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <Distribution
            title="Appointment status"
            rows={data.appointmentStatuses.map((row) => ({ label: STATUS_LABEL[row.status], count: row.count }))}
          />
          <Distribution title="Top diagnoses" rows={data.topDiagnoses} emptyLabel="No diagnosis entries in this period" />
        </div>
      )}

      <p className="text-xs leading-5 text-ink-muted">
        Aggregates are limited to your Doctor identity, the active chamber and the selected chamber-local dates. Patient names, phone numbers and identifiers are never loaded into this view.
      </p>
    </div>
  );
}
function Distribution({
  title,
  rows,
  emptyLabel = "No appointment statuses in this period",
}: {
  title: string;
  rows: readonly { label: string; count: number }[];
  emptyLabel?: string;
}) {
  const visible = rows.filter((row) => row.count > 0);
  const max = Math.max(1, ...visible.map((row) => row.count));
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader title={title} count={visible.reduce((sum, row) => sum + row.count, 0)} />
      <div className="space-y-3 p-4 sm:p-5">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{emptyLabel}</p>
        ) : (
          visible.map((row) => (
            <div key={row.label} className="min-w-0">
              <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-medium text-ink-secondary">{row.label}</span>
                <span className="shrink-0 font-semibold text-ink tabular-nums">{row.count}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(6, (row.count / max) * 100)}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );
}
