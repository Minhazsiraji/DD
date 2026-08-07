"use client";

import * as React from "react";
import {
  Building2,
  Hospital,
  Video,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { LocationType, PracticeLocation } from "@/mocks/types";

/**
 * LocationSwitcher — chooses which chamber/clinic the doctor is working from.
 *
 * IMPORTANT: this filters the *day* (appointments, queue, fees). It does NOT
 * scope patient data. Patients belong to the doctor, so a patient first seen at
 * one location and later at another is a single record with a single timeline.
 * That is the core of Doctor's Diary — clinics keep their own systems.
 */

const TYPE_ICON: Record<LocationType, React.ReactNode> = {
  OWN_CHAMBER: <Building2 className="size-4" />,
  CLINIC: <Hospital className="size-4" />,
  HOSPITAL: <Hospital className="size-4" />,
  TELEMEDICINE: <Video className="size-4" />,
};

const TYPE_LABEL: Record<LocationType, string> = {
  OWN_CHAMBER: "Own chamber",
  CLINIC: "Clinic",
  HOSPITAL: "Hospital",
  TELEMEDICINE: "Telemedicine",
};

export function LocationSwitcher({
  locations,
  activeLocationId,
  className,
}: {
  locations: PracticeLocation[];
  activeLocationId: string;
  className?: string;
}) {
  // Phase 1 keeps selection local. Phase 4 moves it into the session.
  const [activeId, setActiveId] = React.useState(activeLocationId);
  const active = locations.find((l) => l.id === activeId) ?? locations[0];

  if (!active) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Practice location: ${active.name}. Change location.`}
            className={cn(
              "inline-flex h-10 max-w-[240px] items-center gap-2 rounded-xl border border-hairline bg-white/80 px-2.5 text-left transition-colors hover:bg-white focus-visible:focus-ring",
              className,
            )}
          />
        }
      >
        <span className="shrink-0 text-brand" aria-hidden="true">
          {TYPE_ICON[active.type]}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-[13px] leading-tight font-semibold text-ink">
            {active.name}
          </span>
          <span className="block truncate text-[11px] text-ink-muted">
            {TYPE_LABEL[active.type]}
          </span>
        </span>
        <ChevronsUpDown
          className="size-3.5 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        {/* Base UI requires GroupLabel to live inside a Group — unlike Radix,
            a bare <DropdownMenuLabel> throws MenuGroupContext is missing. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Where are you practising?</DropdownMenuLabel>

          {locations.map((loc) => (
            <DropdownMenuItem
              key={loc.id}
              onClick={() => setActiveId(loc.id)}
              className="items-start gap-2.5 py-2"
            >
              <span className="mt-0.5 shrink-0 text-brand" aria-hidden="true">
                {TYPE_ICON[loc.type]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">
                  {loc.name}
                </span>
                <span className="block truncate text-[11px] text-ink-muted tabular-nums">
                  {TYPE_LABEL[loc.type]} · ৳{loc.consultationFee} ·{" "}
                  {loc.slotMinutes} min slots
                </span>
              </span>
              {loc.id === active.id ? (
                <Check
                  className="mt-0.5 size-4 shrink-0 text-brand"
                  aria-hidden="true"
                />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <p className="border-t border-hairline px-2 pt-2 pb-1 text-[11px] leading-snug text-ink-muted">
          Switching filters today&apos;s schedule and fees. Your patient records
          stay the same everywhere.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
