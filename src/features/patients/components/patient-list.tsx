import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, TriangleAlert, Phone, MapPin, ShieldAlert } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { initials } from "@/lib/format";
import { formatAge } from "../identity";
import { SEX_LABEL, BLOOD_GROUP_LABEL } from "../schema";
import type { PatientListItem } from "../queries";
import { Users, UserPlus } from "lucide-react";

/**
 * Patient results for the Friendly Doctor Pilot.
 *
 * Each patient is an independent compact card rather than a flat table/list.
 * The card exposes only the identity, safety cue and recent operational context
 * needed to choose the right patient; deeper clinical detail stays inside the
 * patient profile.
 */
export function PatientList({
  patients,
  query,
}: {
  patients: PatientListItem[];
  query: string;
}) {
  if (patients.length === 0) {
    return (
      <SectionCard>
        {query ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={`No patient matches “${query}”`}
            description="Try a phone number or patient number. Spelling variations of a name are handled, but a different person may simply not be registered yet."
            action={
              <Link
                href={`/patients/new?name=${encodeURIComponent(query)}`}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring"
              >
                <UserPlus className="size-4" aria-hidden="true" />
                Register “{query}”
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Users className="size-5" />}
            title="No patients yet"
            description="Patients you register are yours alone — another doctor using Doctor's Diary never sees them."
            action={
              <Link
                href="/patients/new"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring"
              >
                <UserPlus className="size-4" aria-hidden="true" />
                Register your first patient
              </Link>
            }
          />
        )}
      </SectionCard>
    );
  }

  return (
    <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {patients.map((p) => (
        <li key={p.id} className="min-w-0">
          <article className="liquid-patient-card group relative h-full overflow-hidden rounded-[24px] p-4 sm:p-5">
            <div className="flex items-start gap-3.5">
              <span
                className="liquid-patient-avatar flex size-12 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                aria-hidden="true"
              >
                {initials(p.fullName)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[16px] font-semibold tracking-[-0.015em] text-ink">
                      {p.fullName}
                    </h2>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-secondary tabular-nums">
                      <span>{formatAge({ years: p.ageYears, isApproximate: p.ageApproximate })}</span>
                      <span aria-hidden="true">·</span>
                      <span>{SEX_LABEL[p.sex as keyof typeof SEX_LABEL] ?? p.sex}</span>
                      {p.bloodGroup !== "UNKNOWN" ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{BLOOD_GROUP_LABEL[p.bloodGroup as keyof typeof BLOOD_GROUP_LABEL]}</span>
                        </>
                      ) : null}
                    </p>
                  </div>

                  {p.allergyCount > 0 ? (
                    <span
                      className="liquid-patient-alert inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-danger"
                      aria-label={`${p.allergyCount} recorded allergy${p.allergyCount > 1 ? "ies" : ""}`}
                    >
                      <TriangleAlert className="size-3.5" aria-hidden="true" />
                      Allergy
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 font-mono text-[11.5px] text-ink-muted">{p.patientNumber}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="liquid-patient-tile min-w-0 rounded-[15px] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Contact</p>
                <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-secondary">
                  <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate tabular-nums">{p.phone || "Not recorded"}</span>
                </p>
              </div>

              <div className="liquid-patient-tile min-w-0 rounded-[15px] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Recent context</p>
                <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-secondary">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{p.lastSeenLocation || "No visit recorded"}</span>
                </p>
              </div>
            </div>

            {p.allergyCount > 0 ? (
              <div className="liquid-patient-safety mt-3 flex items-center gap-2 rounded-[15px] px-3 py-2.5 text-[12px] font-medium text-[#9f2d39]">
                <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
                Safety alert recorded — open the patient before prescribing.
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between border-t border-white/65 pt-3">
              <span className="text-[11.5px] text-ink-muted">Doctor-owned clinical record</span>
              <Link
                href={`/patients/${p.id}`}
                className="liquid-secondary inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold text-[#5545c6] transition-transform hover:-translate-y-px focus-visible:focus-ring"
              >
                View patient
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
