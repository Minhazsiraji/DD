import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ClipboardList,
  FileText,
  FlaskConical,
  Stethoscope,
  TriangleAlert,
} from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import type { D1DashboardPilotOutcome } from "@/features/dashboard/d1-queries";

const PENDING_VISIBLE_LIMIT = 3;
const RECENT_CONSULTATION_VISIBLE_LIMIT = 4;
const FINALIZED_RX_VISIBLE_LIMIT = 3;

function when(value: string): string {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}

function MoreRows({
  label,
  hiddenCount,
  children,
}: {
  label: string;
  hiddenCount: number;
  children: ReactNode;
}) {
  if (hiddenCount <= 0) return null;

  return (
    <details className="mt-2 rounded-xl border border-hairline bg-surface-muted/40 px-3 py-1.5">
      <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-brand focus-visible:focus-ring">
        View all {label} · {hiddenCount} more
      </summary>
      <div className="space-y-2 pb-2">{children}</div>
    </details>
  );
}

export function D1PilotActivity({ outcome }: { outcome: D1DashboardPilotOutcome }) {
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader title="Recent work" icon={<Activity className="size-4" />} />
      {!outcome.ok ? (
        <div className="p-4 sm:p-5">
          <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] font-medium text-ink">
            <TriangleAlert className="mt-px size-4 shrink-0 text-[#8a3f07]" aria-hidden="true" />
            Recent clinical activity could not be loaded. Reload before relying on this dashboard.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-hairline">
          <PendingWork data={outcome.data} />
          <RecentConsultations data={outcome.data} />
          <FinalizedPrescriptions data={outcome.data} />
        </div>
      )}
      <ContextualClinicalShortcuts />
    </SectionCard>
  );
}

function PendingWork({ data }: { data: Extract<D1DashboardPilotOutcome, { ok: true }>["data"] }) {
  const pendingCount = data.openConsultationCount + data.draftPrescriptionCount;
  const pendingRows = [
    ...data.recentConsultations
      .filter((row) => row.status === "DRAFT")
      .map((row) => (
        <Link
          key={`encounter-${row.encounterId}`}
          href={`/consultation/${row.encounterId}`}
          className="dd-quick-row flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2 focus-visible:focus-ring"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{row.patient.fullName}</span>
            <span className="block text-xs text-ink-muted">
              Open consultation · {row.patient.patientNumber}
            </span>
          </span>
          <Stethoscope className="size-4 shrink-0 text-brand" aria-hidden="true" />
        </Link>
      )),
    ...data.draftPrescriptions.map((row) => (
      <Link
        key={`prescription-${row.prescriptionId}`}
        href={`/prescription/${row.prescriptionId}`}
        className="dd-quick-row flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2 focus-visible:focus-ring"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{row.patient.fullName}</span>
          <span className="block text-xs text-ink-muted">
            Prescription draft · {row.itemCount} item{row.itemCount === 1 ? "" : "s"}
          </span>
        </span>
        <FileText className="size-4 shrink-0 text-brand" aria-hidden="true" />
      </Link>
    )),
  ];
  const visibleRows = pendingRows.slice(0, PENDING_VISIBLE_LIMIT);
  const hiddenRows = pendingRows.slice(PENDING_VISIBLE_LIMIT);

  return (
    <section className="border-t border-hairline p-4 sm:p-5" aria-labelledby="d1-pending-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="d1-pending-heading" className="text-sm font-semibold text-ink">
          Pending work
        </h2>
        <span className="text-xs font-semibold text-ink-muted">{pendingCount} actionable</span>
      </div>
      {pendingCount === 0 ? (
        <p className="mt-2 text-[13px] text-ink-secondary">
          No open consultation or active prescription draft at this location.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {visibleRows}
          <MoreRows label="pending work" hiddenCount={hiddenRows.length}>
            {hiddenRows}
          </MoreRows>
        </div>
      )}
    </section>
  );
}

function RecentConsultations({
  data,
}: {
  data: Extract<D1DashboardPilotOutcome, { ok: true }>["data"];
}) {
  const rows = data.recentConsultations.map((row) => (
    <div key={row.encounterId} className="rounded-xl border border-hairline px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/consultation/${row.encounterId}`}
            className="font-semibold text-ink hover:underline focus-visible:focus-ring"
          >
            {row.patient.fullName}
          </Link>
          <p className="text-xs text-ink-muted">
            {row.patient.patientNumber} · {when(row.startedAt)}
          </p>
        </div>
        <span className="rounded-full bg-surface-muted px-2 py-1 text-[11px] font-semibold text-ink-secondary">
          {row.status === "DRAFT" ? "In progress" : "Completed"}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Link
          href={`/consultation/${row.encounterId}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-brand hover:underline focus-visible:focus-ring"
        >
          <ClipboardList className="size-3.5" aria-hidden="true" />
          {row.status === "DRAFT" ? "Resume" : "Review"}
        </Link>
        {row.status === "DRAFT" ? (
          <>
            <Link
              href={`/consultation/${row.encounterId}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-brand hover:underline focus-visible:focus-ring"
            >
              <FileText className="size-3.5" aria-hidden="true" />
              Prescription
            </Link>
            <Link
              href={`/consultation/${row.encounterId}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-brand hover:underline focus-visible:focus-ring"
            >
              <FlaskConical className="size-3.5" aria-hidden="true" />
              Investigation
            </Link>
          </>
        ) : null}
      </div>
    </div>
  ));
  const visibleRows = rows.slice(0, RECENT_CONSULTATION_VISIBLE_LIMIT);
  const hiddenRows = rows.slice(RECENT_CONSULTATION_VISIBLE_LIMIT);

  return (
    <section className="p-4 sm:p-5" aria-labelledby="d1-recent-heading">
      <h2 id="d1-recent-heading" className="text-sm font-semibold text-ink">
        Recent consultations
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-secondary">No recent consultation activity at this location.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {visibleRows}
          <MoreRows label="recent consultations" hiddenCount={hiddenRows.length}>
            {hiddenRows}
          </MoreRows>
        </div>
      )}
    </section>
  );
}

function FinalizedPrescriptions({
  data,
}: {
  data: Extract<D1DashboardPilotOutcome, { ok: true }>["data"];
}) {
  const rows = data.finalizedPrescriptions.map((row) => (
    <Link
      key={row.prescriptionId}
      href={`/prescription/${row.prescriptionId}`}
      className="dd-quick-row flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2 focus-visible:focus-ring"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{row.patient.fullName}</span>
        <span className="block text-xs text-ink-muted">
          Finalized {when(row.finalizedAt)} · {row.itemCount} item{row.itemCount === 1 ? "" : "s"}
        </span>
      </span>
      <FileText className="size-4 shrink-0 text-brand" aria-hidden="true" />
    </Link>
  ));
  const visibleRows = rows.slice(0, FINALIZED_RX_VISIBLE_LIMIT);
  const hiddenRows = rows.slice(FINALIZED_RX_VISIBLE_LIMIT);

  return (
    <section className="p-4 sm:p-5" aria-labelledby="d1-rx-heading">
      <h2 id="d1-rx-heading" className="text-sm font-semibold text-ink">
        Finalized prescription activity
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-secondary">No recent finalized prescription at this location.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {visibleRows}
          <MoreRows label="finalized prescriptions" hiddenCount={hiddenRows.length}>
            {hiddenRows}
          </MoreRows>
        </div>
      )}
    </section>
  );
}

function ContextualClinicalShortcuts() {
  return (
    <section className="border-t border-hairline p-4 sm:p-5" aria-labelledby="d1-context-heading">
      <h2 id="d1-context-heading" className="text-sm font-semibold text-ink">
        Clinical shortcuts
      </h2>
      <p className="mt-1 text-xs text-ink-muted">
        Choose the patient first. Prescription and Investigation continue only inside that patient&apos;s consultation context.
      </p>
      <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          href="/patients"
          className="dd-quick-row flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ink focus-visible:focus-ring"
        >
          <FileText className="size-4 shrink-0 text-brand" aria-hidden="true" />
          Prescription · choose patient
        </Link>
        <Link
          href="/patients"
          className="dd-quick-row flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ink focus-visible:focus-ring"
        >
          <FlaskConical className="size-4 shrink-0 text-brand" aria-hidden="true" />
          Investigation · choose patient
        </Link>
      </div>
    </section>
  );
}
