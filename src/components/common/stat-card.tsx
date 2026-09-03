import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/glass/glass-card";
import { IconOrb, type OrbAccent } from "@/components/common/icon-orb";

const ACCENT_TEXT: Record<OrbAccent, string> = {
  brand: "text-brand",
  violet: "text-[#6b35d6]",
  success: "text-[#07684a]",
  warning: "text-[#8a3f07]",
  danger: "text-[#a81c1c]",
  info: "text-[#0a5a80]",
};

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: OrbAccent;
  hint?: string;
  href?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon,
  accent = "brand",
  hint,
  href,
  className,
}: StatCardProps) {
  const body = (
    <div className="flex min-w-0 items-center gap-3">
      <IconOrb accent={accent} size="md">{icon}</IconOrb>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={cn("truncate text-[12.5px] font-semibold", ACCENT_TEXT[accent])}>{label}</p>
          <span className="shrink-0 text-[24px] leading-none font-bold text-ink tabular-nums">{value}</span>
        </div>
        {hint ? <p className="mt-1 truncate text-[11px] text-ink-muted">{hint}</p> : null}
      </div>
    </div>
  );

  if (href) {
    return (
      <GlassCard interactive className={cn("dd-dashboard-card focus-within:focus-ring p-3.5", className)}>
        <Link href={href} className="block outline-none">{body}</Link>
      </GlassCard>
    );
  }

  return <GlassCard className={cn("dd-dashboard-card p-3.5", className)}>{body}</GlassCard>;
}
