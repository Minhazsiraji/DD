import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { PatientForm } from "@/features/patients/components/patient-form";
import { getPatient } from "@/features/patients/queries";

export const metadata: Metadata = { title: "Edit patient" };

export default async function EditPatientPage(props: PageProps<"/patients/[id]/edit">) {
  const { id } = await props.params;
  const patient = await getPatient(id);
  if (!patient) notFound();

  return (
    <div className="mx-auto max-w-[720px] space-y-4 sm:space-y-5">
      <Link
        href={`/patients/${id}`}
        className="inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {patient.fullName}
      </Link>

      <PageHeader eyebrow="Edit" title={patient.fullName} />

      <PatientForm
        mode="edit"
        defaults={{
          patientId: patient.id,
          fullName: patient.fullName,
          phone: patient.phone ?? undefined,
          sex: patient.sex,
          bloodGroup: patient.bloodGroup,
          dob: patient.dobPrecision === "DAY" ? patient.dob : null,
          approxAgeYears: patient.dobPrecision === "AGE_ONLY" ? patient.ageYears : null,
          email: patient.email,
          address: patient.address,
          district: patient.district,
          weightKg: patient.weightKg,
          heightCm: patient.heightCm,
          notes: patient.notes,
        }}
      />
    </div>
  );
}
