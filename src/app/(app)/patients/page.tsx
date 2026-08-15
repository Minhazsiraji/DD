import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserPlus, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { PatientSearch } from "@/features/patients/components/patient-search";
import { PatientList } from "@/features/patients/components/patient-list";
import { SectionSkeleton } from "@/components/common/skeletons";
import { searchPatients } from "@/features/patients/queries";

export const metadata: Metadata = { title: "Patients" };

async function Results({ query }: { query: string }) {
  const result = await searchPatients(query);

  /**
   * An outage must never render as "no patient found". That reads as "this
   * person is not registered", and the doctor would go on to create a duplicate
   * or assume there is no history.
   */
  if (!result.ok) {
    return (
      <SectionCard className="overflow-hidden border-l-4 border-l-danger">
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-ink">
              Patient search is temporarily unavailable
            </p>
            <p className="mt-1 text-[13px] text-ink-secondary">
              This is not the same as “no patient found”. Do not register a new
              record for someone who may already exist — try again in a moment.
            </p>
          </div>
        </div>
      </SectionCard>
    );
  }

  const { patients } = result;
  return (
    <>
      <p className="text-xs text-ink-muted" role="status">
        {query
          ? `${patients.length} ${patients.length === 1 ? "match" : "matches"} for “${query}”`
          : `${patients.length} ${patients.length === 1 ? "patient" : "patients"}`}
      </p>
      <PatientList patients={patients} query={query} />
    </>
  );
}

export default async function PatientsPage(props: PageProps<"/patients">) {
  const params = await props.searchParams;
  const query = typeof params.q === "string" ? params.q : "";

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="Your repository"
        title="Patients"
        subtitle="Every patient here belongs to you. Another doctor never sees them."
        actions={
          <Link
            href="/patients/new"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100"
          >
            <UserPlus className="size-4" aria-hidden="true" />
            New patient
          </Link>
        }
      />

      <PatientSearch initialQuery={query} />

      {/* Keyed on the query so a new search shows the skeleton rather than
          stale results while the server round-trips. */}
      <Suspense key={query} fallback={<SectionSkeleton rows={5} />}>
        <Results query={query} />
      </Suspense>
    </div>
  );
}
