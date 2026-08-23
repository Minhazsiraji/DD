import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnProfile } from "@/features/doctor/profile";
import {
  ProfileEditor,
  type EditableChamber,
} from "@/features/doctor/components/profile-editor";

export const metadata: Metadata = { title: "Professional profile" };

/**
 * Editing the professional profile.
 *
 * Every chamber the doctor is an ACTIVE MEMBER of is offered here, whether or
 * not it is on the profile yet — membership is what makes a chamber theirs to
 * describe, and `getOwnProfile` only returns the ones they have already said
 * something about. Saving a schedule is what puts one on the profile.
 */
export default async function ProfessionalProfilePage() {
  const ctx = await requireLocationContext();
  const profile = await getOwnProfile();

  if (!profile) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-lg font-semibold text-ink">This is a doctor&rsquo;s profile</h1>
        <p className="mt-2 text-[13px] text-ink-secondary">
          Only a doctor account has a professional profile. Reception and
          administrator accounts do not have one.
        </p>
        <Link
          href="/settings"
          className="mt-5 inline-flex h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to settings
        </Link>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("practice_locations")
    .select("id, name, address, district")
    .in(
      "id",
      ctx.memberships.map((m) => m.locationId),
    );

  const chambers: EditableChamber[] = ctx.memberships.map((m) => {
    const row = (rows ?? []).find((r) => (r as { id: string }).id === m.locationId) as
      | { name: string; address: string | null; district: string | null }
      | undefined;
    const saved = profile.chambers.find((c) => c.locationId === m.locationId);
    const first = saved?.sessions[0];

    return {
      locationId: m.locationId,
      name: m.locationName,
      addressLine: [row?.address, row?.district].filter(Boolean).join(", ") || null,
      publicNote: saved?.publicNote ?? "",
      days: saved?.sessions.map((s) => s.weekday) ?? [],
      // Sensible chamber hours to adjust, not to accept blindly — nothing is
      // saved until the doctor presses Save on that chamber.
      startsAt: first?.startsAt ?? "18:00",
      endsAt: first?.endsAt ?? "21:00",
    };
  });

  return (
    <div className="space-y-5 sm:space-y-6">
      <Link
        href="/settings"
        className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to settings
      </Link>

      <PageHeader
        eyebrow="Professional profile"
        title="How a patient would see you"
        subtitle="Your photo, credentials and the hours you sit at each chamber. Private to you — nothing here is published."
      />

      <ProfileEditor profile={profile} chambers={chambers} />
    </div>
  );
}
