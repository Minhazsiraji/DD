import type { Metadata } from "next";
import { EyeOff, Lock, ShieldCheck, ShieldOff, UserX } from "lucide-react";
import { requirePlatformOwner } from "@/features/owner/authority";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { SECURITY_AWAITED } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { describeWindow, parsePeriod, periodWindow, todayIsoUtc } from "@/features/owner/dashboard/periods";

export const metadata: Metadata = { title: "Security · Owner dashboard" };

/**
 * The boundary this surface lives inside — stated as fact, not measured.
 *
 * Every row below is TRUE BY CONSTRUCTION of the code that rendered this page:
 * it could not have rendered for a non-owner, or below AAL2, because the owner
 * guard refused first, and the analytics plane it reads has no clinical path at
 * all. None of it is a count, so none of it can be a fabricated number.
 *
 * The security METRICS are a different thing entirely, and they are below: no
 * approved aggregate publishes them yet, so they read "Not measured". A
 * compliance percentage invented on an owner console is exactly the number
 * nobody should ever trust, so there is none.
 *
 * NO RAW AUDIT PAYLOADS. `audit_events` rows are not read, rendered or
 * summarised here; the only audit interaction in the whole O1-F Owner contract
 * is F's own narrow insert, inside the database.
 */
const BOUNDARY = [
  {
    icon: <ShieldCheck className="size-4" />,
    title: "Platform owner authority",
    body: "Decided by the database for the signed-in session, through the existing owner check. Anyone else receives “not found” — the surface does not admit it exists.",
  },
  {
    icon: <Lock className="size-4" />,
    title: "Multi-factor session (AAL2) required",
    body: "An owner session without a second factor is sent to MFA before any owner page renders. You are seeing this because this session passed, and every approved RPC re-asserts it inside the database.",
  },
  {
    icon: <ShieldOff className="size-4" />,
    title: "No clinical access — including for the owner",
    body: "Ownership grants no read of any patient, consultation, prescription, investigation or document. This dashboard reaches aggregate and control-plane functions only.",
  },
  {
    icon: <UserX className="size-4" />,
    title: "No patient-level drill-down, no doctor probing",
    body: "There is no path from any number here to a person behind it, and no interface that accepts a doctor identifier to look one up.",
  },
  {
    icon: <EyeOff className="size-4" />,
    title: "Small groups are withheld, not rounded",
    body: "Where fewer than five doctors contribute, the source returns “Insufficient cohort” and this dashboard prints exactly that — never a zero and never an omitted row.",
  },
];

export default async function OwnerDashboardSecurityPage(props: PageProps<"/owner/dashboard/security">) {
  await requirePlatformOwner();

  const params = await props.searchParams;
  const period = parsePeriod(params);
  const window = periodWindow(period, todayIsoUtc());

  return (
    <MetricSection
      title="Security"
      description="The boundary this dashboard operates inside, and the posture signals it will report once an approved aggregate publishes them."
      window={describeWindow(window)}
      specs={SECURITY_AWAITED}
      measurements={{}}
    >
      <SectionCard className="overflow-hidden" data-security-boundary>
        <SectionHeader title="Enforced boundary" icon={<ShieldCheck className="size-4" />} />
        <ul className="grid min-w-0 gap-3 p-4 sm:p-5 md:grid-cols-2">
          {BOUNDARY.map((b) => (
            <li
              key={b.title}
              className="dd-material-record dd-record-pearl flex min-w-0 items-start gap-3 rounded-glass p-3.5"
            >
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
