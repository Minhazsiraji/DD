import * as React from "react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("dd-brand-mark inline-flex shrink-0 items-center justify-center", className)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" className="size-full" fill="none">
        <defs>
          <linearGradient id="ddMark" x1="6" y1="5" x2="43" y2="44" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9C8BFF" />
            <stop offset="0.55" stopColor="#745CEB" />
            <stop offset="1" stopColor="#55CBEF" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="42" height="42" rx="13" fill="url(#ddMark)" />
        <path
          d="M24 35.2c-1.1-1-9.7-6.2-12.1-11.6C9.5 18.4 12.2 13 17.5 13c2.9 0 5.1 1.7 6.5 3.8 1.4-2.1 3.6-3.8 6.5-3.8 5.3 0 8 5.4 5.6 10.6C33.7 29 25.1 34.2 24 35.2Z"
          fill="white"
          fillOpacity="0.98"
        />
        <path d="M22 19h4v4h4v4h-4v4h-4v-4h-4v-4h4v-4Z" fill="#7059E8" />
        <circle cx="36.5" cy="10.5" r="3" fill="white" fillOpacity="0.78" />
      </svg>
    </span>
  );
}
