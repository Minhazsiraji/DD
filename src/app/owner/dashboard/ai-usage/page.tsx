import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { AI_USAGE_METRICS } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { parsePeriod } from "@/features/owner/dashboard/periods";
import { readAiUsage } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "AI Usage · Owner dashboard" };

export default async function OwnerDashboardAIUsagePage(props: PageProps<"/owner/dashboard/ai-usage">) {
  // First await, before any read: the owner + AAL2 boundary.
  await requirePlatformOwner();

  const period = parsePeriod(await props.searchParams);
  const measurements = await readAiUsage(period);

  return (
    <MetricSection
      title="AI Usage"
      description="AI drafting and voice transcription activity, measured as counts, tokens and minutes. Never the prompt, the transcript or the draft itself."
      period={period}
      specs={AI_USAGE_METRICS}
      measurements={measurements}
    />
  );
}
