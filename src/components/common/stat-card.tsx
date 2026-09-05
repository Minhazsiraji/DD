import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/glass/glass-card";
import { IconOrb, type OrbAccent } from "@/components/common/icon-orb";

const ACCENT_TEXT: Record<OrbAccent, string> = {
  brand: "text-brand",
  // (teal — see --dd-brand; deep enough to carry text at 5.5:1 on white)
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

/**
 * StatCard — a summary tile. Summary content, so the glass material is fine.
 * The value uses tabular numerals so a row of tiles stays optically aligned.
 */
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
        <IconOrb accent={accent} size="lg">
          {icon}
        </IconOrb>
        <span className="text-[28px] leading-none font-bold text-ink tabular-nums sm:text-[32px]">
          {value}
        </span>
      </div>
      <div className="mt-4">
        <p className={cn("text-sm font-semibold", ACCENT_TEXT[accent])}>{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
      </div>
    </>
  );

  if (href) {
    return (
      <GlassCard
        interactive
        className={cn("dd-dashboard-card focus-within:focus-ring p-5", className)}
      >
        <Link href={href} className="block outline-none">
          {body}
        </Link>
      </GlassCard>
    );
  }

  return <GlassCard className={cn("dd-dashboard-card p-5", className)}>{body}</GlassCard>;
}
