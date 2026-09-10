import type { Metadata } from "next";
import { Palette } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { BackgroundAppearance } from "@/features/settings/components/background-appearance";

export const metadata: Metadata = { title: "Appearance" };

export default function AppearancePage() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Settings · Appearance"
        title="Background appearance"
        subtitle="Keep Doctor’s Diary’s default canvas or personalize only the background on this browser."
      />

      <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
        <Palette className="size-4 text-brand" aria-hidden="true" />
        Default · Color · Image
      </div>

      <BackgroundAppearance />
    </div>
  );
}
