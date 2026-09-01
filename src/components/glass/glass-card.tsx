import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * GlassCard / GlassPanel — the translucent surfaces.
 * Summary/chrome only; clinical data belongs on SectionCard.
 */

type Tone = "default" | "strong";

interface GlassCardProps extends React.ComponentProps<"div"> {
  tone?: Tone;
  interactive?: boolean;
  blur?: boolean;
}

export function GlassCard({
  className,
  tone = "default",
  interactive = false,
  blur = false,
  ...props
}: GlassCardProps) {
  const material = blur
    ? tone === "strong"
      ? "glass-strong"
      : "glass"
    : tone === "strong"
      ? "glass-flat-strong"
      : "glass-flat";

  return (
    <div
      className={cn(
        material,
        "min-w-0 rounded-glass-lg shadow-soft",
        interactive && [
          "cursor-pointer transition-[box-shadow,transform] duration-200",
          "hover:-translate-y-0.5 hover:shadow-raised focus-within:shadow-raised",
          "active:translate-y-0 active:scale-[0.985] active:shadow-soft",
          "motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        ],
        className,
      )}
      {...props}
    />
  );
}

export function GlassPanel({
  className,
  tone = "strong",
  blur = true,
  ...props
}: React.ComponentProps<"div"> & { tone?: Tone; blur?: boolean }) {
  const material = blur
    ? tone === "strong"
      ? "glass-strong"
      : "glass"
    : tone === "strong"
      ? "glass-flat-strong"
      : "glass-flat";

  return (
    <div
      className={cn(
        material,
        "min-w-0 rounded-glass-lg shadow-raised",
        className,
      )}
      {...props}
    />
  );
}
