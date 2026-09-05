import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { PatientForm } from "@/features/patients/components/patient-form";
import { requireLocationContext } from "@/lib/auth/session";
import { getCurrentDoctorId } from "@/features/patients/queries";
import { SectionCard } from "@/components/common/section-card";
import { getLocationLocalDate } from "@/features/patients/m1-context";
import { EmptyState } from "@/components/common/empty-state";
import { Stethoscope } from "lucide-react";

export const metadata: Metadata = { title: "New patient" };

export default async function NewPatientPage(props: PageProps<"/patients/new">) {
  const ctx = await requireLocationContext();
  const doctorId = await getCurrentDoctorId();
  const locationDate = await getLocationLocalDate(ctx.locationId);

  const params = await props.searchParams;
  const prefillName = typeof params.name === "string" ? params.name : undefined;
  const prefillPhone = typeof params.phone === "string" ? params.phone : undefined;

  // Only a doctor owns patients. Staff registering on a doctor's behalf is a
  // Phase 5 (reception) flow and needs its own explicit design.
  if (!doctorId) {
    return (
      <SectionCard>
        <EmptyState
          variant="page"
          icon={<Stethoscope className="size-5" />}
          title="Only a doctor can register patients"
          description="Patients belong to a doctor's own repository. Complete your doctor profile to start registering."
        />
      </SectionCard>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-4 sm:space-y-5">
      <Link
        href="/patients"
        className="inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Patients
      </Link>

      <PageHeader
        eyebrow="New patient"
        title="Register a patient"
        subtitle={`Added to your repository at ${ctx.locationName}. Name and age are required. Add phone if available.`}
      />

      <PatientForm
        defaults={{ fullName: prefillName, phone: prefillPhone }}
        todayLocal={locationDate?.localDate}
      />
    </div>
  );
}
