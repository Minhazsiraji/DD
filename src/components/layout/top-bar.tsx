import * as React from "react";
import Link from "next/link";
import { Bell, Sparkles, LogOut } from "lucide-react";
import { QuickActionMenu } from "./quick-action-menu";
import { LocationSwitcher, type LocationOption } from "./location-switcher";
import { BrandMark } from "@/components/brand/brand-mark";
import { initials } from "@/lib/format";
import { signOutAction } from "@/features/auth/actions";
import { GlobalPatientFinder } from "@/features/patients/components/global-patient-finder";

interface TopBarProps {
  doctorName: string;
  locations: LocationOption[];
  activeLocationId: string;
}

/**
 * Sticky app header. Glass is correct here — it is chrome, and one of the two
 * blurred layers the view is allowed.
 */
export function TopBar({ doctorName, locations, activeLocationId }: TopBarProps) {
  return (
    <header
      data-print-hidden
      className="dd-topbar glass sticky top-0 z-30 min-w-0 border-b border-glass-border"
    >
      <div className="flex h-16 min-w-0 items-center gap-1.5 px-3 sm:gap-3 sm:px-6">
        {/* Brand — mobile only; the sidebar carries it from lg up. */}
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2 rounded-lg lg:hidden focus-visible:focus-ring"
        >
          <BrandMark className="h-8 w-10" />
          <span className="sr-only">Doctor&apos;s Diary — Dashboard</span>
        </Link>

        <LocationSwitcher
          locations={locations}
          activeLocationId={activeLocationId}
          className="shrink-0"
        />

        <GlobalPatientFinder />

        <Link
          href="/assistant"
          className="hidden h-10 items-center gap-2 rounded-xl border border-hairline bg-white/80 px-3 text-sm font-medium text-brand transition-colors hover:bg-white sm:inline-flex focus-visible:focus-ring"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Ask AI
        </Link>

        <QuickActionMenu variant="button" className="hidden sm:inline-flex" />

        {/* Secondary chrome disappears first on a phone; search keeps the room. */}
        <button
          type="button"
          aria-label="Notifications"
          className="relative hidden size-10 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-white/70 focus-visible:focus-ring sm:flex"
        >
          <Bell className="size-5" aria-hidden="true" />
        </button>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <span
            className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand xl:hidden"
            aria-hidden="true"
          >
            {initials(doctorName)}
          </span>
          <span className="hidden min-w-0 xl:block">
            <span className="block max-w-[160px] truncate text-[13px] leading-tight font-semibold text-ink">
              {doctorName}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">
              Signed in
            </span>
          </span>

          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex size-10 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-white/70 hover:text-ink focus-visible:focus-ring sm:size-9"
            >
              <LogOut className="size-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
