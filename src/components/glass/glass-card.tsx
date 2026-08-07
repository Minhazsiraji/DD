import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * GlassCard / GlassPanel — the translucent surfaces.
 *
 * DESIGN RULE (enforced by review, not by code):
 * Use these for chrome, navigation, and *summary* content only.
 * Clinical data — doses, vitals, lab values, prescriptions — belongs on
 * <SectionCard>, which is opaque and high-contrast.
 *
 * PERFORMANCE: cards use `glass-flat`, which is the same translucent material
 * WITHOUT a backdrop-filter. Real blur is reserved for chrome that content
 * scrolls beneath (sidebar, top bar, bottom nav, sheets) because each
 * backdrop-filter element is a separate compositing pass. Over our smooth
 * gradient the blur is imperceptible on a card; the cost is not.
 *
 * Budget: at most two blurred layers visible at once. Never place a blurred
 * surface inside a scrolling list.
 */

type Tone = "default" | "strong";

interface GlassCardProps extends React.ComponentProps<"div"> {
  tone?: Tone;
  /** Adds hover lift + pointer affordance. Use only when the whole card is a target. */
  interactive?: boolean;
  /**
   * Opt in to a real backdrop-filter. Only for a surface that genuinely
   * overlays scrolling content — and only within the two-layer budget.
   */
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
        "rounded-glass-lg shadow-soft",
        interactive && [
          "cursor-pointer transition-[box-shadow,transform] duration-200",
          // Pointer devices: lift on hover.
          "hover:-translate-y-0.5 hover:shadow-raised focus-within:shadow-raised",
          // Touch devices have no hover, so a tap would feel dead without this.
          "active:translate-y-0 active:scale-[0.985] active:shadow-soft",
          "motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        ],
        className,
      )}
      {...props}
    />
  );
}

/**
 * GlassPanel — a larger structural surface (sidebars, AI panel, sheets).
 * Same material, squarer corners, no default padding.
 */
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
        "rounded-glass-lg shadow-raised",
        className,
      )}
      {...props}
    />
  );
}
