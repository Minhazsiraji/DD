import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { requireUser } from "@/lib/auth/session";
import {
  getDoctorIdentity,
  getPracticeLocations,
  getSignatureUrl,
  listTemplates,
} from "@/features/doctor/queries";
import { TemplateManager } from "@/features/doctor/components/template-manager";

export const metadata: Metadata = { title: "Prescription layout" };

export default async function PrescriptionSettingsPage() {
  await requireUser();

  const identity = await getDoctorIdentity();
  const [signatureUrl, locations, outcome] = await Promise.all([
    getSignatureUrl(identity.signaturePath),
    getPracticeLocations(),
    listTemplates(),
  ]);

  const doctor = {
    fullName: identity.fullName,
    qualification: identity.qualification,
    specialization: identity.specialization,
    designation: identity.designation,
    bmdcRegistrationNo: identity.bmdcRegistrationNo,
    signatureUrl,
  };

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

      {/*
        A failed read is NOT "no templates". Offering "create your first
        template" after a broken query invites a doctor to build a duplicate of
        one they already have.
      */}
      {!outcome.ok ? (
        <p className="flex items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          Your templates could not be loaded, so nothing is shown here. Reload in
          a moment rather than creating a new one.
        </p>
      ) : identity.doctorId ? (
        <TemplateManager
          doctor={doctor}
          // Only places where this user practises AS A DOCTOR can be chosen —
          // matching may_scope_template_to() in the database.
          locations={locations
            .filter((l) => l.isDoctorHere)
            .map((l) => ({
              id: l.id,
              name: l.name,
              address: l.address,
              district: l.district,
              phone: l.phone,
            }))}
          templates={outcome.templates}
        />
      ) : null}

      <p className="text-xs text-ink-muted">
        This sets up the paper only. Writing prescriptions — medicines, doses and
        safety checks — comes in a later step.
      </p>
    </div>
  );
}
