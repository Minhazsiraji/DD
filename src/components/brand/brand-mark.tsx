import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * BrandMark follows the owner's approved Doctor's Diary logo:
 * a blue notebook-style D, a teal D, binding rings, and a medical plus.
 * The compact mark is used where the full wordmark would not fit.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("dd-brand-mark inline-flex shrink-0 items-center justify-center", className)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 72 52" className="size-full overflow-visible" fill="none">
        <defs>
          <linearGradient id="ddBlue" x1="10" y1="4" x2="46" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0667E9" />
            <stop offset="0.56" stopColor="#0157D2" />
            <stop offset="1" stopColor="#022869" />
          </linearGradient>
          <linearGradient id="ddTeal" x1="33" y1="5" x2="67" y2="47" gradientUnits="userSpaceOnUse">
            <stop stopColor="#07CBB8" />
            <stop offset="0.58" stopColor="#03BBAB" />
            <stop offset="1" stopColor="#049190" />
          </linearGradient>
          <linearGradient id="ddRing" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#FFFFFF" />
            <stop offset="0.45" stopColor="#CFE0EE" />
            <stop offset="1" stopColor="#7E9BB0" />
          </linearGradient>
          <filter id="ddShadow" x="-20%" y="-20%" width="150%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="1.7" floodColor="#052D7E" floodOpacity="0.22" />
          </filter>
        </defs>

        <path
          d="M31.5 5H47C59.7 5 69 14.3 69 26S59.7 47 47 47H31.5V5Z"
          fill="url(#ddTeal)"
          filter="url(#ddShadow)"
        />
        <path
          d="M40.5 14.2H47C54.2 14.2 59.5 19.2 59.5 26S54.2 37.8 47 37.8H40.5V14.2Z"
          fill="white"
          fillOpacity="0.97"
        />

        <path
          d="M12 5H31C44 5 53.5 14.3 53.5 26S44 47 31 47H12V5Z"
          fill="url(#ddBlue)"
          filter="url(#ddShadow)"
        />
        <path
          d="M23 14.2H31C38.6 14.2 44.2 19.2 44.2 26S38.6 37.8 31 37.8H23V14.2Z"
          fill="white"
          fillOpacity="0.98"
        />

        <path d="M30.2 21.1H35.1V24.1H38.2V29H35.1V32.1H30.2V29H27.1V24.1H30.2V21.1Z" fill="#03A996" />

        {[13, 21.6, 30.2, 38.8].map((y) => (
          <g key={y}>
            <circle cx="12.1" cy={y} r="3.2" fill="#052A6C" fillOpacity="0.95" />
            <rect x="3" y={y - 1.55} width="11.7" height="3.1" rx="1.55" fill="url(#ddRing)" />
          </g>
        ))}
      </svg>
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
