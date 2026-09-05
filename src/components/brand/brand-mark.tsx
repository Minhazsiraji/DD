import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Doctor's Diary selected brand mark: a calm violet liquid tile with a white
 * heart and medical cross, finished with a tiny aqua highlight.
 */
export function BrandMark({
  className,
  label = "Doctor's Diary",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex shrink-0", className)}
    >
      <svg
        viewBox="0 0 48 48"
        className="size-full overflow-visible"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="dd-brand-tile" x1="7" y1="4" x2="44" y2="47" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9A8BFF" />
            <stop offset="0.7" stopColor="#6F5AE8" />
            <stop offset="1" stopColor="#69D8F5" />
          </linearGradient>
          <linearGradient id="dd-brand-shine" x1="12" y1="5" x2="34" y2="31" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" stopOpacity="0.9" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <filter id="dd-brand-glow" x="-35%" y="-35%" width="170%" height="170%">
            <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor="#6F5AE8" floodOpacity="0.22" />
          </filter>
        </defs>

        <rect x="3" y="3" width="42" height="42" rx="12" fill="url(#dd-brand-tile)" filter="url(#dd-brand-glow)" />
        <rect x="4" y="4" width="40" height="40" rx="11" fill="none" stroke="white" strokeOpacity="0.58" />
        <path d="M8 15C12 8 19 5 28 6C20 8 14 13 10 22C8 20 7 18 8 15Z" fill="url(#dd-brand-shine)" opacity="0.62" />

        <path
          d="M24 37.2C22.3 35.8 15.1 30.3 11.8 26.1C7.2 20.3 9.7 13.5 15.8 12.5C19.2 11.9 22 13.5 24 16C26 13.5 28.8 11.9 32.2 12.5C38.3 13.5 40.8 20.3 36.2 26.1C32.9 30.3 25.7 35.8 24 37.2Z"
          fill="white"
          fillOpacity="0.98"
        />
        <rect x="21.9" y="18.1" width="4.2" height="12.2" rx="1.4" fill="#6F5AE8" />
        <rect x="17.9" y="22.1" width="12.2" height="4.2" rx="1.4" fill="#6F5AE8" />
        <circle cx="39.2" cy="8.8" r="2.2" fill="#5FD7F6" />
        <circle cx="39.2" cy="8.8" r="1" fill="white" fillOpacity="0.82" />
      </svg>
    </span>
  );
}
