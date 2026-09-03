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

export function TopBar({ doctorName, locations, activeLocationId }: TopBarProps) {
  return (
    <header
      data-print-hidden
      className="glass liquid-topbar sticky top-3 z-30 min-w-0"
    >
      <div className="flex h-[68px] min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-5">
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
              className="liquid-input h-11 min-w-0 w-full rounded-full pr-4 pl-10 text-[14px] text-ink placeholder:text-ink-muted sm:max-w-[560px]"
            />
          </div>
        </div>

        <QuickActionMenu variant="button" className="hidden sm:inline-flex" />

        <button
          type="button"
          aria-label="Notifications"
          className="liquid-secondary relative hidden size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-[transform,color] hover:-translate-y-px hover:text-brand focus-visible:focus-ring sm:flex"
        >
          <Bell className="size-[19px]" aria-hidden="true" />
        </button>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span
            className="liquid-secondary hidden size-10 items-center justify-center rounded-full text-[13px] font-semibold text-brand sm:flex"
            aria-hidden="true"
          >
            {initials(doctorName)}
          </span>
          <span className="hidden min-w-0 xl:block">
            <span className="block max-w-[150px] truncate text-[13px] leading-tight font-semibold text-ink">
              {doctorName}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">Doctor</span>
          </span>

          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex size-10 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-white/55 hover:text-brand focus-visible:focus-ring"
            >
              <LogOut className="size-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
