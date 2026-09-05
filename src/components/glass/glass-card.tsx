import * as React from "react";
import { cn } from "@/lib/utils";

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
        "liquid-glass-card min-w-0 rounded-glass-lg shadow-soft",
        interactive && [
          "cursor-pointer transition-[box-shadow,transform,filter] duration-180",
          "hover:-translate-y-0.5 hover:shadow-raised hover:brightness-[1.01] focus-within:shadow-raised",
          "active:translate-y-0 active:scale-[0.99] active:shadow-soft",
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
        "liquid-panel min-w-0 rounded-glass-lg shadow-raised",
        className,
      )}
      {...props}
    />
  );
}
