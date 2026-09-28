import { GlassCard } from "@/components/glass/glass-card";

export default function AnalyticsLoading() {
  return (
    <div className="space-y-5" aria-label="Loading Doctor Analytics">
      <div className="h-16 animate-pulse rounded-xl bg-white/30" />
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <GlassCard key={index} className="h-36 animate-pulse" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard className="h-72 animate-pulse" />
        <GlassCard className="h-72 animate-pulse" />
      </div>
    </div>
  );
}
