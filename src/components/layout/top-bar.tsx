import * as React from "react";
import Link from "next/link";
import { Search, Bell, LogOut } from "lucide-react";
import { QuickActionMenu } from "./quick-action-menu";
import { LocationSwitcher, type LocationOption } from "./location-switcher";
import { BrandMark } from "@/components/brand/brand-mark";
import { initials } from "@/lib/format";
import { signOutAction } from "@/features/auth/actions";

interface TopBarProps {
  doctorName: string;
  locations: LocationOption[];
  activeLocationId: string;
}

/** Sticky application chrome — one of the few places where liquid glass is used. */
export function TopBar({ doctorName, locations, activeLocationId }: TopBarProps) {
  return (
    <header
      data-print-hidden
      className="glass sticky top-0 z-30 min-w-0 border-b border-glass-border"
    >
      <div className="flex h-16 min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-6">
        {/* Brand — mobile only; desktop/tablet rail carries the wordmark. */}
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2 rounded-xl lg:hidden focus-visible:focus-ring"
          aria-label="Doctor's Diary — Today"
        >
          <BrandMark className="size-10" />
        </Link>

        <LocationSwitcher
          locations={locations}
          activeLocationId={activeLocationId}
          className="shrink-0"
        />

        {/* Patient search owns the available header space. */}
        <div className="min-w-0 flex-1">
          <label htmlFor="global-search" className="sr-only">
            Search my patients by name, phone or patient number
          </label>
          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <input
              id="global-search"
              type="search"
              placeholder="Search my patients…"
              className="h-11 min-w-0 w-full rounded-xl border border-hairline bg-white/92 pr-3 pl-9 text-[14px] text-ink shadow-[0_1px_2px_rgb(23_34_59/0.025)] placeholder:text-ink-muted transition-[border-color,box-shadow,background-color] focus:border-brand/40 focus:bg-white focus-visible:focus-ring sm:max-w-lg"
            />
          </div>
        </div>

        <QuickActionMenu variant="button" className="hidden sm:inline-flex" />

        <button
          type="button"
          aria-label="Notifications"
          className="relative hidden size-11 shrink-0 items-center justify-center rounded-xl border border-transparent text-ink-secondary transition-colors hover:border-brand/10 hover:bg-white/75 hover:text-ink focus-visible:focus-ring sm:flex"
        >
          <Bell className="size-5" aria-hidden="true" />
        </button>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <span
            className="hidden size-9 items-center justify-center rounded-xl bg-brand-soft text-[13px] font-semibold text-brand ring-1 ring-inset ring-brand/10 sm:flex"
            aria-hidden="true"
          >
            {initials(doctorName)}
          </span>
          <span className="hidden min-w-0 xl:block">
            <span className="block max-w-[160px] truncate text-[13px] leading-tight font-semibold text-ink">
              {doctorName}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">Doctor</span>
          </span>

          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex size-10 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-white/75 hover:text-ink focus-visible:focus-ring"
            >
              <LogOut className="size-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
