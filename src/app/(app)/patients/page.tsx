import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { PatientSearch } from "@/features/patients/components/patient-search";
import { PatientList } from "@/features/patients/components/patient-list";
import { SectionSkeleton } from "@/components/common/skeletons";
import { searchPatients } from "@/features/patients/queries";

export const metadata: Metadata = { title: "Patients" };

async function Results({ query }: { query: string }) {
  const patients = await searchPatients(query);
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
