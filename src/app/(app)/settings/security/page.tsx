import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ShieldCheck, LogOut } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { MfaPanel, SignOutPanel } from "@/features/security/components/security-panels";
import { listFactorsAction } from "@/features/security/actions";
import { SHARED_DEVICE_COOKIE } from "@/features/security/policy";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  await requireUser();
  const factors = await listFactorsAction();

  const cookieStore = await cookies();
  const sharedDevice = cookieStore.get(SHARED_DEVICE_COOKIE)?.value === "1";

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Account security"
        subtitle="Your patient records live on the server, not on any device. These settings control who can reach them."
      />

      <SectionCard className="overflow-hidden">
        <SectionHeader
          title="Two-step verification"
          icon={<ShieldCheck className="size-4" />}
        />
        <MfaPanel factors={factors} />
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Where you're signed in" icon={<LogOut className="size-4" />} />
        <SignOutPanel sharedDevice={sharedDevice} />
      </SectionCard>

      <p className="text-xs text-ink-muted">
        Losing your phone loses your <em>access</em>, not your data — the records
        are in the database. That is also why a second authenticator matters:
        without one, a lost phone means recovering the account the slow way.
      </p>
    </div>
  );
}
