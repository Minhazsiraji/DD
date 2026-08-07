import * as React from "react";
import Link from "next/link";
import { Users, ChevronRight } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { formatDateShort, formatAgeSex, initials } from "@/lib/format";
import type { RecentPatient } from "@/mocks/types";

export function RecentPatients({ patients }: { patients: RecentPatient[] }) {
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Recent patients"
        icon={<Users className="size-4" />}
        action={
          <Link
            href="/patients"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-brand hover:bg-brand-soft focus-visible:focus-ring"
          >
            All
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        }
      />

      <ul className="divide-y divide-hairline">
        {patients.map((p) => (
          <li key={p.id}>
            <Link
              href={`/patients/${p.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:px-5"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand"
                aria-hidden="true"
              >
                {initials(p.fullName)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{p.fullName}</p>
                <p className="truncate text-xs text-ink-secondary tabular-nums">
                  {formatAgeSex(p.ageYears, p.sex)} ·{" "}
                  <span className="font-mono text-ink-muted">{p.patientNumber}</span>
                </p>
              </div>

              <div className="hidden shrink-0 text-right sm:block">
                <p className="text-xs text-ink-secondary">{p.reason}</p>
                {/* Where the visit happened — one record, wherever seen. */}
                <p className="text-xs text-ink-muted tabular-nums">
                  {formatDateShort(p.seenOn)} · {p.locationName}
                </p>
              </div>

              <ChevronRight
                className="size-4 shrink-0 text-ink-muted"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
