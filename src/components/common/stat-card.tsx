import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/glass/glass-card";
import { IconOrb, type OrbAccent } from "@/components/common/icon-orb";

const ACCENT_TEXT: Record<OrbAccent, string> = {
  brand: "text-brand",
  violet: "text-[#6550db]",
  success: "text-[#087a62]",
  warning: "text-[#a65d0f]",
  danger: "text-[#b63745]",
  info: "text-[#376ed8]",
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
    <>
      <div className="flex items-start justify-between gap-3">
        <IconOrb accent={accent} size="lg">{icon}</IconOrb>
        <span className="text-[28px] leading-none font-bold tracking-[-0.035em] text-ink tabular-nums sm:text-[32px]">
          {value}
        </span>
      </div>
      <div className="mt-4">
        <p className={cn("text-sm font-semibold tracking-[-0.01em]", ACCENT_TEXT[accent])}>{label}</p>
        {hint ? <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{hint}</p> : null}
      </div>
    </>
  );

  if (href) {
    return (
      <GlassCard interactive className={cn("liquid-stat-card focus-within:focus-ring p-5", className)}>
        <Link href={href} className="block outline-none">{body}</Link>
      </GlassCard>
    );
  }

  return <GlassCard className={cn("liquid-stat-card p-5", className)}>{body}</GlassCard>;
}
