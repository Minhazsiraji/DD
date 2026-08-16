import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Building2, FileSignature, Stethoscope, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { requireUser } from "@/lib/auth/session";
import { getDoctorIdentity, getPracticeLocations, getSignatureUrl } from "@/features/doctor/queries";
import { ProfileForm } from "@/features/doctor/components/profile-form";
import { SignaturePanel } from "@/features/doctor/components/signature-panel";
import { LocationDetailsForm } from "@/features/doctor/components/location-details-form";

export const metadata: Metadata = { title: "Your profile" };

export default async function DoctorProfilePage() {
  await requireUser();

  const identity = await getDoctorIdentity();
  const [signatureUrl, locations] = await Promise.all([
    getSignatureUrl(identity.signaturePath),
    getPracticeLocations(),
  ]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Settings
      </Link>

      <PageHeader
        eyebrow="Profile"
        title="Your professional details"
        subtitle="This is what appears on your prescriptions. Set it once — you will not be asked again."
      />

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Doctor details" icon={<Stethoscope className="size-4" />} />
        <ProfileForm identity={identity} />
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Signature" icon={<FileSignature className="size-4" />} />
        <SignaturePanel
          signatureUrl={signatureUrl}
          // A saved-but-unfetchable signature still needs its Remove button.
          hasSignature={Boolean(identity.signaturePath)}
        />
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader
          title="Chamber &amp; contact details"
          count={locations.length}
          icon={<Building2 className="size-4" />}
        />
        <ul className="divide-y divide-hairline">
          {locations.map((location) => (
            <LocationDetailsForm key={location.id} location={location} />
          ))}
        </ul>
        <div className="border-t border-hairline p-4 sm:p-5">
          <Link
            href="/settings"
            className="text-sm font-semibold text-brand hover:underline focus-visible:focus-ring"
          >
            Add another place you practise
          </Link>
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Prescription layout" icon={<FileSignature className="size-4" />} />
        <div className="p-4 sm:p-5">
          <Link
            href="/settings/prescription"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            Set up your prescription paper
            <ChevronRight className="size-4 text-ink-muted" aria-hidden="true" />
          </Link>
          <p className="mt-2 text-xs text-ink-muted">
            Choose the paper size, what prints in the header and footer, and use
            a different layout at each chamber.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
