import * as React from "react";
import Link from "next/link";
import { ChevronRight, TriangleAlert, Phone, MapPin } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { initials } from "@/lib/format";
import { formatAge } from "../identity";
import { SEX_LABEL, BLOOD_GROUP_LABEL } from "../schema";
import type { PatientListItem } from "../queries";
import { Users, UserPlus } from "lucide-react";

/**
 * Patient results.
 *
 * Cards, not a table. A doctor looks this up one-handed between rooms, and a
 * squeezed desktop table is unusable there — the allergy flag in particular has
 * to survive at 375px, because that is the whole point of showing it.
 */
export function PatientList({
  patients,
  query,
  canRegister = true,
}: {
  patients: PatientListItem[];
  query: string;
  canRegister?: boolean;
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
              canRegister ? (
                <Link
                  href={`/patients/new?name=${encodeURIComponent(query)}`}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring"
                >
                  <UserPlus className="size-4" aria-hidden="true" />
                  Register “{query}”
                </Link>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={<Users className="size-5" />}
            title="No patients yet"
            description="Patients you register are yours alone — another doctor using Doctor's Diary never sees them."
            action={
              canRegister ? (
                <Link
                  href="/patients/new"
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring"
                >
                  <UserPlus className="size-4" aria-hidden="true" />
                  Register your first patient
                </Link>
              ) : undefined
            }
          />
        )}
      </SectionCard>
    );
  }

  return (
    <SectionCard className="overflow-hidden">
      <ul className="divide-y divide-hairline">
        {patients.map((p) => (
          <li key={p.id}>
            <Link
              href={`/patients/${p.id}`}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted active:bg-surface-muted focus-visible:focus-ring sm:px-5"
            >
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand"
                aria-hidden="true"
              >
                {initials(p.fullName)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
                  <span className="truncate">{p.fullName}</span>
                  {p.allergyCount > 0 ? (
                    <TriangleAlert
                      className="size-4 shrink-0 text-danger"
                      aria-label={`${p.allergyCount} recorded allergy${p.allergyCount > 1 ? "ies" : ""}`}
                    />
                  ) : null}
                </p>

                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-secondary tabular-nums">
                  <span className="font-mono text-ink-muted">{p.patientNumber}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {formatAge({ years: p.ageYears, isApproximate: p.ageApproximate })}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{SEX_LABEL[p.sex as keyof typeof SEX_LABEL] ?? p.sex}</span>
                  {p.bloodGroup !== "UNKNOWN" ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {BLOOD_GROUP_LABEL[p.bloodGroup as keyof typeof BLOOD_GROUP_LABEL]}
                      </span>
                    </>
                  ) : null}
                </p>

                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-muted">
                  {p.phone ? (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Phone className="size-3" aria-hidden="true" />
                      {p.phone}
                    </span>
                  ) : null}
                  {p.lastSeenLocation ? (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <MapPin className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{p.lastSeenLocation}</span>
                    </span>
                  ) : null}
                </p>
              </div>

              <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
