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

/** Context only; desktop navigation stays in the locked left sidebar. */
export function TopBar({ doctorName, locations, activeLocationId }: TopBarProps) {
  return (
    <header data-print-hidden className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4 lg:px-4 lg:pt-4 xl:px-5">
      <div className="dd-topbar mx-auto flex min-h-[68px] max-w-[1480px] min-w-0 items-center gap-2.5 px-3.5 py-2.5 sm:gap-3 sm:px-4 lg:px-5">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2 rounded-2xl lg:hidden focus-visible:focus-ring"
          aria-label="Doctor's Diary — Today"
        >
          <BrandMark className="size-10" />
        </Link>

        <LocationSwitcher
          locations={locations}
          activeLocationId={activeLocationId}
          className="shrink-0"
        />

        <div className="min-w-0 flex-1">
          <label htmlFor="global-search" className="sr-only">
            Search my patients by name, phone or patient number
          </label>
          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <input
              id="global-search"
              type="search"
              placeholder="Search my patients…"
              className="dd-input h-11 min-w-0 w-full rounded-full pr-4 pl-10 text-[13px] text-ink placeholder:text-ink-muted focus-visible:focus-ring sm:h-12 sm:max-w-[620px]"
            />
          </div>
        </div>

        <QuickActionMenu variant="button" className="hidden sm:inline-flex" />

        <button
          type="button"
          aria-label="Notifications"
          className="dd-icon-btn relative hidden size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-transform hover:-translate-y-px hover:text-brand focus-visible:focus-ring sm:flex"
        >
          <Bell className="size-[19px]" aria-hidden="true" />
        </button>

        <div className="dd-profile-chip hidden shrink-0 items-center gap-2 rounded-full p-1.5 pr-2.5 sm:flex">
          <span
            className="flex size-9 items-center justify-center rounded-full bg-[linear-gradient(145deg,#efeaff,#ddd6ff)] text-[12px] font-semibold text-[#5f50c9] ring-1 ring-white/80"
            aria-hidden="true"
          >
            {initials(doctorName)}
          </span>
          <span className="hidden min-w-0 2xl:block">
            <span className="block max-w-[120px] truncate text-[12px] leading-tight font-semibold text-ink">
              {doctorName}
            </span>
            <span className="block text-[10px] text-ink-muted">Doctor</span>
          </span>
        </div>

        <form action={signOutAction} className="hidden sm:block">
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="dd-icon-btn flex size-10 items-center justify-center rounded-full text-ink-secondary transition-transform hover:-translate-y-px hover:text-brand focus-visible:focus-ring"
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </header>
  );
}
