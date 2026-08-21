"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, FileText, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { PreviousVisit } from "../previous-visit";

/**
 * What happened last time — and nothing more than that.
 *
 * READ-ONLY BY CONSTRUCTION. There is not a single input, control or action in
 * here that writes anything: no "copy to today", no editable field, no way to
 * touch the previous encounter. The one safety principle this card exists to
 * respect is that PREVIOUS FINDINGS MUST NEVER BECOME TODAY'S FINDINGS just
 * because the patient came back. A temperature from three days ago silently
 * appearing in today's vitals is a fabricated observation, and it would be
 * indistinguishable from one the doctor took.
 *
 * So this shows; today's fields stay blank and stay the doctor's.
 *
 * Expanded by default for a report review or a follow-up, because those are
 * precisely the visits that are ABOUT the previous one. Collapsed otherwise, so
 * a new complaint is not read through the lens of an old visit.
 */
export function PreviousVisitCard({
  visit,
  expandedByDefault,
}: {
  visit: PreviousVisit;
  expandedByDefault: boolean;
}) {
  const [open, setOpen] = React.useState(expandedByDefault);

  const vitals = [
    ["Height", visit.vitals.heightCm, "cm"],
    ["Weight", visit.vitals.weightKg, "kg"],
    ["Temperature", visit.vitals.temperatureC, "°C"],
    ["Pulse", visit.vitals.pulseBpm, "bpm"],
    [
      "BP",
      visit.vitals.systolic && visit.vitals.diastolic
        ? `${visit.vitals.systolic}/${visit.vitals.diastolic}`
        : null,
      "mmHg",
    ],
    ["Resp. rate", visit.vitals.respRate, "/min"],
    ["SpO₂", visit.vitals.spo2, "%"],
  ].filter(([, value]) => value !== null && value !== "") as [string, string | number, string][];

  return (
    <section
      className="clinical-surface rounded-glass border-l-4 border-l-brand"
      aria-labelledby="previous-visit-heading"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left focus-visible:focus-ring"
      >
        <History className="size-4 shrink-0 text-brand" aria-hidden="true" />
        <span id="previous-visit-heading" className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink">
            Previous visit · {formatDate(visit.startedAt.slice(0, 10))}
            {visit.locationName ? ` · ${visit.locationName}` : ""}
          </span>
          {!open ? (
            <span className="block truncate text-[12px] text-ink-secondary">
              {visit.chiefComplaints ?? visit.assessment ?? "Open to see what was recorded"}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-muted transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="space-y-3 border-t border-hairline px-4 py-3 text-[13px]">
          <Field label="Chief complaint" value={visit.chiefComplaints} />
          <Field label="History of present illness" value={visit.presentIllness} />

          {vitals.length > 0 ? (
            <div>
              <Label>Vitals</Label>
              <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                {vitals.map(([name, value, unit]) => (
                  <div key={name} className="flex items-baseline gap-1.5">
                    <dt className="text-ink-secondary">{name}</dt>
                    <dd className="font-semibold tabular-nums text-ink">
                      {value}
                      <span className="ml-0.5 font-normal text-ink-muted">{unit}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <Field label="Examination" value={visit.examination} />
          <Field label="Assessment" value={visit.assessment} />

          {visit.diagnoses.length > 0 ? (
            <div>
              <Label>Diagnosis</Label>
              <ul className="mt-1 space-y-0.5 text-ink">
                {visit.diagnoses.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/*
            ORDERED, not resulted.

            Doctor's Diary has no investigation-results module. Saying "results
            are not recorded yet" is the honest sentence; implying these came
            back — or worse, showing an invented value — is the failure mode
            this wording exists to prevent.
          */}
          {visit.investigations.length > 0 ? (
            <div>
              <Label>Investigations ordered</Label>
              <ul className="mt-1 space-y-0.5 text-ink">
                {visit.investigations.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
              <p className="mt-1 text-[12px] text-ink-muted">
                Results are not recorded in Doctor&rsquo;s Diary yet — these are what was asked for.
              </p>
            </div>
          ) : null}

          <Field label="Previous advice" value={visit.advice} />

          {visit.prescription ? (
            <div>
              <Label>Previous prescription</Label>
              <p className="mt-1 text-ink">
                {visit.prescription.medicineCount}{" "}
                {visit.prescription.medicineCount === 1 ? "medicine" : "medicines"}
                {visit.prescription.finalizedAt
                  ? ` · finalised ${formatDate(visit.prescription.finalizedAt.slice(0, 10))}`
                  : ""}
              </p>
              {/*
                That it was replaced is operational and safe to show. WHY it was
                corrected is clinical and is never surfaced here.
              */}
              {visit.prescription.superseded ? (
                <p className="mt-0.5 text-[12px] font-medium text-warning">
                  A correction has replaced this prescription.
                </p>
              ) : null}
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Open href={`/prescription/${visit.prescription.id}`}>Open previous prescription</Open>
                {visit.prescription.replacedById ? (
                  <Open href={`/prescription/${visit.prescription.replacedById}`}>
                    Open the replacement
                  </Open>
                ) : null}
              </div>
            </div>
          ) : null}

          <Open href={`/consultation/${visit.id}`}>View full previous consultation</Open>
        </div>
      ) : null}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
      {children}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <Label>{label}</Label>
      {/* The doctor's own words, wrapped and never truncated. */}
      <p className="mt-1 break-words whitespace-pre-wrap text-ink">{value}</p>
    </div>
  );
}

function Open({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 text-[12px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
    >
      <FileText className="size-3.5" aria-hidden="true" />
      {children}
    </Link>
  );
}
