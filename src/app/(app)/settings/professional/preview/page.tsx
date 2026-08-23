import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, EyeOff } from "lucide-react";
import { requireLocationContext } from "@/lib/auth/session";
import { getOwnProfile } from "@/features/doctor/profile";
import { DoctorProfileCard } from "@/features/doctor/components/profile-card";

/**
 * "View profile as patient" — the owning doctor's private preview.
 *
 * PRIVATE, and the route says so twice over: `requireLocationContext()` refuses
 * an unauthenticated reader before anything is fetched, and `getOwnProfile()`
 * takes no id, so a signed-in doctor can only ever render THEIR OWN profile.
 * There is no parameter here to point at somebody else.
 *
 * `robots: noindex, nofollow` because this is a preview of something that is
 * not published. When a public `/dr/<slug>` route is built it will render the
 * same `DoctorProfileCard` — the presentation is already shared, so that route
 * only has to decide who may read, which is the one decision worth writing
 * fresh.
 */
export const metadata: Metadata = {
  title: "Profile preview",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ProfilePreviewPage() {
  await requireLocationContext();
  const profile = await getOwnProfile();

  // Reception and administrators have no professional profile to preview.
  if (!profile) notFound();

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

        {/*
          Said plainly on the page itself, not only in a settings blurb. A
          doctor looking at something that resembles a public page should be
          able to tell at a glance that it is not one.
        */}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 text-[12px] font-medium text-ink-secondary">
          <EyeOff className="size-3.5" aria-hidden="true" />
          Preview — only you can see this
        </span>
      </div>

      <DoctorProfileCard profile={profile} />

      <p className="mx-auto max-w-[560px] text-center text-[12px] text-ink-muted">
        This is how your profile would look to a patient. It is not published,
        not shared and not searchable.
      </p>
    </div>
  );
}
