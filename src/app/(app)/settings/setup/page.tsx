import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { requireUser } from "@/lib/auth/session";
import { getSetupSnapshot } from "@/features/adoption/queries";
import { deriveSetupProgress } from "@/features/adoption/progress";
import { SetupChecklist } from "@/features/adoption/components/setup-checklist";
import { PublicProfileBridge } from "@/features/adoption/components/public-profile-bridge";

export const metadata: Metadata = { title: "Your setup" };

/**
 * The adoption hub: what is set up, and how patients find you.
 *
 * ONE SNAPSHOT, TWO CARDS. Both are rendered from a single read, so the
 * checklist cannot say booking is on while the card below it says the chamber
 * is not bookable — a disagreement two independent reads would eventually
 * produce, and which would make a doctor distrust both.
 */
export default async function SetupPage() {
  await requireUser();
  const snapshot = await getSetupSnapshot();

  /*
   * Reception and administrator accounts land here with no doctor profile.
   * They are not half-set-up doctors; there is simply nothing of theirs on
   * this page, and saying so is kinder than an empty checklist.
   */
  if (!snapshot) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-lg font-semibold text-ink">This page is for doctors</h1>
        <p className="mt-2 text-[13px] text-ink-secondary">
          Reception and administrator accounts have no professional profile to
          set up.
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

  const progress = deriveSetupProgress(snapshot);

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Setup"
        title="Your Doctor's Diary setup"
        subtitle="Everything below is read from your account as it is right now — nothing here is remembered or assumed."
      />

      <SetupChecklist progress={progress} />

      <PublicProfileBridge
        visibility={snapshot.visibility}
        slug={snapshot.slug}
        chambers={
          snapshot.chambers === null
            ? null
            : snapshot.chambers.map((c) => ({
                id: c.id,
                name: c.name,
                bookingEnabled: c.bookingEnabled,
              }))
        }
      />

      <p className="text-xs text-ink-muted">
        Your plan and payments are separate, under{" "}
        <Link href="/settings/billing" className="font-medium text-brand underline underline-offset-2">
          Plan &amp; billing
        </Link>
        . Neither this page nor that one affects a patient record.
      </p>
    </div>
  );
}
