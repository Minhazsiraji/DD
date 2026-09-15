import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { requireUser } from "@/lib/auth/session";
import {
  getDoctorIdentity,
  getPracticeLocations,
  getSignatureUrl,
  listTemplates,
} from "@/features/doctor/queries";
import { getClinicLogoSettings } from "@/features/doctor/clinic-logo-query";
import { ClinicLogoPanel } from "@/features/doctor/clinic-logo-panel";
import { TemplateManager } from "@/features/doctor/components/template-manager";

export const metadata: Metadata = { title: "Prescription layout" };

export default async function PrescriptionSettingsPage() {
  await requireUser();

  const identity = await getDoctorIdentity();
  const [signatureUrl, locations, outcome, clinicLogos] = await Promise.all([
    getSignatureUrl(identity.signaturePath),
    getPracticeLocations(),
    listTemplates(),
    getClinicLogoSettings(),
  ]);

  const doctor = {
    fullName: identity.fullName,
    qualification: identity.qualification,
    specialization: identity.specialization,
    designation: identity.designation,
    bmdcRegistrationNo: identity.bmdcRegistrationNo,
    signatureUrl,
  };
  const clinicLogoByLocation = new Map(clinicLogos.map((logo) => [logo.locationId, logo.logoUrl]));

  return (
    <div className="space-y-5 sm:space-y-6">
      <Link
        href="/settings/profile"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Your profile
      </Link>

      <PageHeader
        eyebrow="Prescription"
        title="Your prescription paper"
        subtitle="Set the header, footer and paper size once. Use a different layout at each chamber if you need to."
      />

      <Link
        href="/settings/prescription/sections"
        className="flex min-h-11 items-center justify-between gap-3 rounded-glass glass-flat px-4 py-3 text-[13px] transition-colors hover:bg-surface-muted focus-visible:focus-ring"
      >
        <span className="min-w-0">
          <span className="block font-semibold text-ink">What your prescription contains</span>
          <span className="block text-ink-muted">
            Which clinical sections you write and print, their order and their headings
          </span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-ink-secondary" aria-hidden="true" />
      </Link>

      {!identity.doctorId ? (
        <p className="flex items-start gap-2 rounded-glass bg-warning-soft px-4 py-3 text-[13px] font-medium text-ink">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span>
            Fill in your{" "}
            <Link href="/settings/profile" className="underline">
              doctor details
            </Link>{" "}
            first — a template prints your name and qualifications, so there is
            nothing to lay out until those exist.
          </span>
        </p>
      ) : null}

      {identity.doctorId ? (
        <ClinicLogoPanel
          locations={clinicLogos.map((logo) => ({
            locationId: logo.locationId,
            locationName: logo.locationName,
            logoUrl: logo.logoUrl,
          }))}
        />
      ) : null}

      {!outcome.ok ? (
        <p className="flex items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          Your templates could not be loaded, so nothing is shown here. Reload in
          a moment rather than creating a new one.
        </p>
      ) : identity.doctorId ? (
        <TemplateManager
          doctor={doctor}
          locations={locations
            .filter((l) => l.isDoctorHere)
            .map((l) => ({
              id: l.id,
              name: l.name,
              address: l.address,
              district: l.district,
              phone: l.phone,
              logoUrl: clinicLogoByLocation.get(l.id) ?? null,
            }))}
          templates={outcome.templates}
        />
      ) : null}

      <p className="text-xs text-ink-muted">
        Prescription layout changes affect future prescriptions only. Finalized prescriptions keep
        the exact paper, signature and clinic logo they were approved with.
      </p>
    </div>
  );
}
