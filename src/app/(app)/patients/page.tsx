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

  if (!result.ok) {
    return (
      <SectionCard className="overflow-hidden border-l-4 border-l-danger">
        <div className="flex items-start gap-3 p-4">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="text-[13px] font-semibold text-ink">Patient search is temporarily unavailable</p>
            <p className="mt-1 text-[12px] leading-5 text-ink-secondary">
              This is not the same as “no patient found”. Do not register a new record for someone who may already exist — try again in a moment.
            </p>
          </div>
        </div>
      </SectionCard>
    );
  }

  const { patients } = result;
  return (
    <>
      <p className="text-[11px] text-ink-muted" role="status">
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
    <div className="space-y-3.5 sm:space-y-4">
      <PageHeader
        eyebrow="Your repository"
        title="Patients"
        subtitle="Every patient here belongs to you. Another doctor never sees them."
        actions={
          <Link
            href="/patients/new"
            className="dd-primary inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold text-white focus-visible:focus-ring"
          >
            <UserPlus className="size-3.5" aria-hidden="true" />
            New patient
          </Link>
        }
      />

      <PatientSearch initialQuery={query} />

      <Suspense key={query} fallback={<SectionSkeleton rows={5} />}>
        <Results query={query} />
      </Suspense>
    </div>
  );
}
