import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { OnboardingForm } from "@/features/onboarding/components/onboarding-form";
import { requireUser, getMemberships } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Set up your practice" };

export default async function OnboardingPage() {
  await requireUser();

  // Already set up — don't let a bookmark create a second clinic by accident.
  const memberships = await getMemberships();
  if (memberships.length > 0) redirect("/dashboard");

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="One-time setup"
        title="Set up your practice"
        subtitle="This takes a minute. Everything here can be changed later."
        className="mb-5"
      />
      <OnboardingForm />
    </div>
  );
}
