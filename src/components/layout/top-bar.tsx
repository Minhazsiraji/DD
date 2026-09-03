import * as React from "react";
import Link from "next/link";
import { Search, Bell, LogOut } from "lucide-react";
import { QuickActionMenu } from "./quick-action-menu";
import { LocationSwitcher, type LocationOption } from "./location-switcher";
import { BrandMark } from "@/components/brand/brand-mark";
import { DesktopTopNav } from "./desktop-top-nav";
import { initials } from "@/lib/format";
import { signOutAction } from "@/features/auth/actions";

interface TopBarProps {
  doctorName: string;
  locations: LocationOption[];
  activeLocationId: string;
}

/** Floating desktop shell based on the approved Doctor's Diary UI board. */
export function TopBar({ doctorName, locations, activeLocationId }: TopBarProps) {
  const activeLocation = locations.find((item) => item.id === activeLocationId) ?? locations[0];

  return (
    <header data-print-hidden className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4 lg:px-6 lg:pt-5">
      <div className="liquid-app-header mx-auto flex min-h-[72px] max-w-[1560px] min-w-0 items-center gap-3 px-3.5 py-2.5 sm:px-4 lg:gap-4 lg:px-5">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2.5 rounded-2xl focus-visible:focus-ring"
          aria-label="Doctor's Diary — Today"
        >
          <BrandMark className="size-10 sm:size-11" />
          <span className="hidden min-w-0 sm:block">
            <span className="block whitespace-nowrap text-[18px] leading-tight font-semibold tracking-[-0.025em] text-[#39327e] lg:text-[20px]">
              Doctor&apos;s Diary
            </span>
            <span className="mt-0.5 block max-w-[180px] truncate text-[10px] font-medium tracking-[0.16em] text-[#716b95] uppercase">
              {activeLocation?.name ?? "Clinical workspace"}
            </span>
          </span>
        </Link>

        <div className="hidden h-9 w-px shrink-0 bg-white/65 xl:block" aria-hidden="true" />

        <div className="hidden min-w-0 flex-1 items-center justify-center xl:flex">
          <DesktopTopNav />
        </div>

        <div className="min-w-0 flex-1 xl:max-w-[340px]">
          <label htmlFor="global-search" className="sr-only">
            Search my patients by name, phone or patient number
          </label>
          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#77728d]"
              aria-hidden="true"
            />
            <input
              id="global-search"
              type="search"
              placeholder="Search my patients…"
              className="liquid-input h-11 min-w-0 w-full rounded-full pr-10 pl-10 text-[13px] text-ink placeholder:text-[#8b869a] focus-visible:focus-ring sm:h-12"
            />
          </div>
        </div>

        <div className="hidden lg:block xl:hidden">
          <LocationSwitcher locations={locations} activeLocationId={activeLocationId} />
        </div>

        <QuickActionMenu variant="button" className="hidden sm:inline-flex" />

        <button
          type="button"
          aria-label="Notifications"
          className="liquid-icon-button relative hidden size-11 shrink-0 items-center justify-center rounded-full text-[#5f5b78] transition-transform hover:-translate-y-px focus-visible:focus-ring sm:flex"
        >
          <Bell className="size-[19px]" aria-hidden="true" />
        </button>

        <div className="liquid-profile-chip hidden shrink-0 items-center gap-2 rounded-full p-1.5 pr-2.5 sm:flex">
          <span
            className="flex size-9 items-center justify-center rounded-full bg-[linear-gradient(145deg,#efeaff,#ddd6ff)] text-[12px] font-semibold text-[#5f50c9] ring-1 ring-white/80"
            aria-hidden="true"
          >
            {initials(doctorName)}
          </span>
          <span className="hidden min-w-0 2xl:block">
            <span className="block max-w-[110px] truncate text-[12px] leading-tight font-semibold text-[#312d5d]">
              {doctorName}
            </span>
            <span className="block text-[10px] text-[#7e7892]">Doctor</span>
          </span>
        </div>

        <form action={signOutAction} className="hidden sm:block">
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="liquid-icon-button flex size-10 items-center justify-center rounded-full text-[#6d6880] transition-transform hover:-translate-y-px focus-visible:focus-ring"
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </form>
      </div>

      <div className="mx-auto mt-2 hidden max-w-[1560px] px-1 lg:block xl:hidden">
        <div className="flex items-center justify-center">
          <DesktopTopNav />
        </div>
      </div>
    </header>
  );
}
