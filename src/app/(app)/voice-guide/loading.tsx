import { GlassCard } from "@/components/glass/glass-card";

export default function VoiceGuideLoading() {
  return (
    <div className="space-y-5" aria-label="Loading Voice Guide">
      <div className="h-16 animate-pulse rounded-xl bg-white/30" />
      <GlassCard className="h-36 animate-pulse" />
      <GlassCard className="h-80 animate-pulse" />
    </div>
  );
}
