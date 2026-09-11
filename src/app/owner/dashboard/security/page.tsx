import type { Metadata } from "next";
import { Lock, ShieldCheck, ShieldOff, UserX } from "lucide-react";
import { requirePlatformOwner } from "@/features/owner/authority";
import { SECURITY_METRICS } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { parsePeriod } from "@/features/owner/dashboard/periods";
import { readSecurity } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Security · Owner dashboard" };

/**
 * The boundary this surface lives inside — stated as fact, not measured.
 *
 * Every row below is TRUE BY CONSTRUCTION of the code that rendered this page:
 * the page could not have rendered for a non-owner, or below AAL2, because
 * `requirePlatformOwner()` refused first. None of it is a count, so none of it
 * can be a fabricated number. The security METRICS — failure rates, grants —
 * are separate, below, and are Not measured until a source exists.
 */
const BOUNDARY = [
  {
    icon: <ShieldCheck className="size-4" />,
    title: "Platform owner authority",
    body: "Decided by the database for the signed-in session. Anyone else receives “not found” — the surface does not admit it exists.",
  },
  {
    icon: <Lock className="size-4" />,
    title: "Multi-factor session (AAL2) required",
    body: "An owner session without a second factor is sent to MFA before any owner page renders. You are seeing this because this session passed.",
  },
  {
    icon: <ShieldOff className="size-4" />,
    title: "No clinical access — including for the owner",
    body: "Ownership grants no read of any patient, consultation, prescription or document. This dashboard reads aggregate totals only.",
  },
  {
    icon: <UserX className="size-4" />,
    title: "No patient-level drill-down",
    body: "Doctor rows lead to usage and cost only. There is no path from any number here to a person behind it.",
  },
];

export default async function OwnerDashboardSecurityPage(props: PageProps<"/owner/dashboard/security">) {
  await requirePlatformOwner();

  const period = parsePeriod(await props.searchParams);
  const measurements = await readSecurity(period);

  return (
    <MetricSection
      title="Security"
      description="The boundary this dashboard operates inside, and the security signals it will report once they are measured."
      period={period}
      specs={SECURITY_METRICS}
      measurements={measurements}
    >
      <SectionCard className="overflow-hidden" data-security-boundary>
        <SectionHeader title="Enforced boundary" icon={<ShieldCheck className="size-4" />} />
        <ul className="grid min-w-0 gap-3 p-4 sm:p-5 md:grid-cols-2">
          {BOUNDARY.map((b) => (
            <li key={b.title} className="dd-material-record dd-record-pearl flex min-w-0 items-start gap-3 rounded-glass p-3.5">
              <span className="mt-0.5 shrink-0 text-brand" aria-hidden="true">
                {b.icon}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">{b.title}</p>
                <p className="mt-1 text-xs text-ink-secondary">{b.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </MetricSection>
  );
}
