import * as React from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/glass/glass-card";
import { SectionCard } from "@/components/common/section-card";

/**
 * Loading primitives.
 *
 * Skeletons mirror the real layout's box model so the page does not shift when
 * data arrives. Each carries `aria-hidden` — the live region announcing "Loading"
 * belongs on the container, once, not on every shimmer block.
 */

export function Shimmer({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-ink/10", className)}
      {...props}
    />
  );
}

export function StatCardSkeleton() {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <Shimmer className="size-9 rounded-xl" />
        <Shimmer className="h-7 w-10" />
      </div>
      <Shimmer className="mt-4 h-3.5 w-24" />
      <Shimmer className="mt-2 h-3 w-16" />
    </GlassCard>
  );
}

export function ListRowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-hairline">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Shimmer className="size-9 rounded-full" />
          <div className="min-w-0 flex-1">
            <Shimmer className="h-3.5 w-2/5" />
            <Shimmer className="mt-2 h-3 w-3/5" />
          </div>
          <Shimmer className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SectionSkeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <SectionCard className={className}>
      <div className="border-b border-hairline px-4 py-3">
        <Shimmer className="h-4 w-32" />
      </div>
      <ListRowSkeleton rows={rows} />
    </SectionCard>
  );
}

export function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-5 sm:space-y-6"
    >
      <span className="sr-only">Loading dashboard</span>
      <div>
        <Shimmer className="h-4 w-28" />
        <Shimmer className="mt-2 h-8 w-64" />
        <Shimmer className="mt-2 h-3.5 w-48" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <GlassCard className="h-44 p-4" />
      <div className="grid gap-4 xl:grid-cols-3">
        <SectionSkeleton className="xl:col-span-2" rows={4} />
        <SectionSkeleton rows={3} />
      </div>
    </div>
  );
}
