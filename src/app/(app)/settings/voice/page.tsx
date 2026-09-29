import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { VoicePersonalizationSettings } from "@/features/dictation/components/voice-personalization-settings";

export const metadata: Metadata = { title: "Voice personalization" };

export default function VoicePersonalizationPage() {
  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <PageHeader eyebrow="Settings · Voice" title="Voice Personalization" subtitle="Teach this browser your preferred language, command phrases and field terminology without changing Doctor’s Diary’s protected canonical actions." />
      <VoicePersonalizationSettings />
    </div>
  );
}
