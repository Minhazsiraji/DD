import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { requireLocationContext } from "@/lib/auth/session";
import { getOwnProfile } from "@/features/doctor/profile";
import { DoctorProfileCard } from "@/features/doctor/components/profile-card";
import { PublicProfileControls } from "@/features/doctor/components/public-profile-controls";

export const metadata: Metadata = {
  title: "Profile preview",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ProfilePreviewPage() {
  await requireLocationContext();
  const profile = await getOwnProfile();
  if (!profile) notFound();

  const published = profile.visibility === "PUBLIC";

  return (
    <div className="space-y-5 pb-4">
      <div className="mx-auto flex max-w-[560px] flex-wrap items-center justify-between gap-3">
        <Link
          href="/settings/professional"
          className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to editing
        </Link>

        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 text-[12px] font-medium text-ink-secondary">
          {published ? <Eye className="size-3.5" aria-hidden="true" /> : <EyeOff className="size-3.5" aria-hidden="true" />}
          {published ? "Preview — profile is published" : "Preview — only you can see this"}
        </span>
      </div>

      <div className="mx-auto max-w-[560px]">
        <PublicProfileControls slug={profile.slug} visibility={profile.visibility} compact />
      </div>

      <DoctorProfileCard profile={profile} />

      <p className="mx-auto max-w-[560px] text-center text-[12px] text-ink-muted">
        {published
          ? "This preview uses your patient-facing profile details. Use View public profile above to verify the anonymous page."
          : "This is how your profile would look to a patient after you publish it. Anonymous visitors cannot access it yet."}
      </p>
    </div>
  );
}
