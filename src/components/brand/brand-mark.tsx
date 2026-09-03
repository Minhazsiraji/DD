import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Exact owner-approved Doctor's Diary DD mark.
 *
 * IMPORTANT: do not redraw or reinterpret this mark in SVG/CSS. The source
 * image is the approved shape and must remain visually unchanged.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("dd-brand-mark inline-flex shrink-0 items-center justify-center", className)}
      aria-hidden="true"
    >
      <img
        src="/brand/dd-mark-exact.png"
        alt=""
        draggable={false}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

export function BrandWordmark({
  className,
  tagline = false,
}: {
  className?: string;
  tagline?: boolean;
}) {
  return (
    <span className={cn("min-w-0", className)}>
      <span className="dd-wordmark block whitespace-nowrap leading-none font-semibold tracking-[-0.035em]">
        <span className="dd-wordmark-doctor">Doctor&apos;s</span>{" "}
        <span className="dd-wordmark-diary">Diary</span>
      </span>
      {tagline ? (
        <span className="dd-brand-tagline mt-1 hidden whitespace-nowrap text-[8.5px] font-medium uppercase tracking-[0.18em] sm:block">
          Care · Record · Connect
        </span>
      ) : null}
    </span>
  );
}
