import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { DoctorVoiceGuide } from "@/features/dictation/components/doctor-voice-guide";
import { M6F_VOICE_GUIDE } from "@/features/dictation/m6f-voice-guide";

export const metadata: Metadata = { title: "Voice Guide" };

export default function VoiceGuidePage() {
  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Doctor Voice"
        title="Voice Guide"
        subtitle={`${M6F_VOICE_GUIDE.metrics.targets} supported Voice surfaces, derived from the current consultation and prescription source inventory. No microphone or patient data is required.`}
      />
      <DoctorVoiceGuide
        entries={M6F_VOICE_GUIDE.entries}
        controls={M6F_VOICE_GUIDE.controls}
        safety={M6F_VOICE_GUIDE.safety}
      />
    </div>
  );
}
