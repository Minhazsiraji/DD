import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, TriangleAlert, Phone, MapPin, ShieldAlert, Users, UserPlus } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { initials } from "@/lib/format";
import { formatAge } from "../identity";
import { SEX_LABEL, BLOOD_GROUP_LABEL } from "../schema";
import type { PatientListItem } from "../queries";

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
                className="dd-primary inline-flex h-10 items-center gap-2 rounded-full px-4 text-[12.5px] font-semibold text-white focus-visible:focus-ring"
              >
                <UserPlus className="size-3.5" aria-hidden="true" />
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
                className="dd-primary inline-flex h-10 items-center gap-2 rounded-full px-4 text-[12.5px] font-semibold text-white focus-visible:focus-ring"
              >
                <UserPlus className="size-3.5" aria-hidden="true" />
                Register your first patient
              </Link>
            }
          />
        )}
      </SectionCard>
    );
  }

  return (
    <ul className="grid gap-3.5 md:grid-cols-2 2xl:grid-cols-3">
      {patients.map((p) => (
        <li key={p.id} className="min-w-0">
          <article className="dd-patient-card h-full overflow-hidden p-4">
            <div className="flex items-start gap-3">
              <span
                className="dd-patient-avatar flex size-11 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                aria-hidden="true"
              >
                {initials(p.fullName)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-semibold tracking-[-0.015em] text-ink">
                      {p.fullName}
                    </h2>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-ink-secondary tabular-nums">
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
                    <p className="mt-1 font-mono text-[10.5px] text-ink-muted">{p.patientNumber}</p>
                  </div>

                  {p.allergyCount > 0 ? (
                    <span
                      className="dd-patient-alert inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold"
                      aria-label={`${p.allergyCount} recorded allergy${p.allergyCount > 1 ? "ies" : ""}`}
                    >
                      <TriangleAlert className="size-3" aria-hidden="true" />
                      Allergy
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
              <div className="dd-patient-tile min-w-0 rounded-[14px] px-3 py-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Contact</p>
                <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-ink-secondary">
                  <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate tabular-nums">{p.phone || "Not recorded"}</span>
                </p>
              </div>

              <div className="dd-patient-tile min-w-0 rounded-[14px] px-3 py-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Recent context</p>
                <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-ink-secondary">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{p.lastSeenLocation || "No visit recorded"}</span>
                </p>
              </div>
            </div>

            {p.allergyCount > 0 ? (
              <div className="dd-patient-safety mt-2.5 flex items-center gap-2 rounded-[14px] px-3 py-2.5 text-[11px] font-medium">
                <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
                Safety alert recorded — open before prescribing.
              </div>
            ) : null}

            <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-white/65 pt-3">
              <span className="hidden text-[10.5px] text-ink-muted sm:inline">Doctor-owned clinical record</span>
              <Link
                href={`/patients/${p.id}`}
                className="dd-secondary ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold text-[#5545c6] focus-visible:focus-ring"
              >
                View patient
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </Link>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
