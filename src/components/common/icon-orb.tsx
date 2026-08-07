import * as React from "react";
import { cn } from "@/lib/utils";

export type OrbAccent =
  | "brand"
  | "violet"
  | "success"
  | "warning"
  | "danger"
  | "info";

const ACCENT: Record<OrbAccent, string> = {
  brand: "orb-brand",
  violet: "orb-violet",
  success: "orb-success",
  warning: "orb-warning",
  danger: "orb-danger",
  info: "orb-info",
};

const SIZE = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
  xl: "size-14",
} as const;

/**
 * IconOrb — the circular, gradient-filled icon badge with a coloured glow.
 *
 * Purely decorative: it is `aria-hidden`, so the meaning must always be carried
 * by adjacent text. Never use an orb as the only indicator of clinical status —
 * that is what <SeverityBadge> is for.
 */
export function IconOrb({
  children,
  accent = "brand",
  size = "md",
  className,
}: {
  children: React.ReactNode;
  accent?: OrbAccent;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("icon-orb shrink-0", ACCENT[accent], SIZE[size], className)}
    >
      {children}
    </span>
  );
}
