"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Bell, Stethoscope, Sparkles } from "lucide-react";
import { QuickActionMenu } from "./quick-action-menu";
import { LocationSwitcher } from "./location-switcher";
import { IconOrb } from "@/components/common/icon-orb";
import { initials } from "@/lib/format";
import type { PracticeLocation } from "@/mocks/types";

interface TopBarProps {
  doctorName: string;
  locations: PracticeLocation[];
  activeLocationId: string;
}

/**
 * TopBar — compact header on mobile, search + actions bar on desktop.
 * Sticky and glass; counts as the second (and final) blur layer alongside the
 * sidebar / bottom nav.
 */
export function TopBar({
  doctorName,
  locations,
  activeLocationId,
}: TopBarProps) {
  return (
    <header
      data-print-hidden
      className="glass sticky top-0 z-30 border-b border-glass-border"
    >
      <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6">
        {/* Brand — mobile only; the sidebar carries it from lg up. */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 lg:hidden focus-visible:focus-ring rounded-lg"
        >
          <IconOrb accent="brand" size="md">
            <Stethoscope className="size-[18px]" />
          </IconOrb>
          <span className="sr-only">Doctor&apos;s Diary — Dashboard</span>
        </Link>

        <LocationSwitcher
          locations={locations}
          activeLocationId={activeLocationId}
          className="shrink-0"
        />

        {/* Search — the fastest route to a patient, so it owns the space. */}
        <div className="min-w-0 flex-1">
          <label htmlFor="global-search" className="sr-only">
            Search patients by name, phone or patient number
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <input
              id="global-search"
              type="search"
              placeholder="Search patients…"
              className="h-10 w-full rounded-xl border border-hairline bg-white/80 pr-3 pl-9 text-sm text-ink placeholder:text-ink-muted focus-visible:focus-ring sm:max-w-md"
            />
          </div>
        </div>

        <Link
          href="/assistant"
          className="hidden h-10 items-center gap-2 rounded-xl border border-hairline bg-white/80 px-3 text-sm font-medium text-brand transition-colors hover:bg-white focus-visible:focus-ring sm:inline-flex"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Ask AI
        </Link>

        <QuickActionMenu variant="button" className="hidden sm:inline-flex" />

        <button
          type="button"
          aria-label="Notifications, 3 unread"
          className="relative flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-white/70 focus-visible:focus-ring"
        >
          <Bell className="size-5" aria-hidden="true" />
          <span
            className="absolute top-2 right-2 size-2 rounded-full bg-danger ring-2 ring-white"
            aria-hidden="true"
          />
        </button>

        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand"
            aria-hidden="true"
          >
            {initials(doctorName)}
          </span>
          <span className="hidden min-w-0 xl:block">
            <span className="block truncate text-[13px] leading-tight font-semibold text-ink">
              {doctorName}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">
              Signed in
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}
