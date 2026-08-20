"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Hospital, Video, ChevronsUpDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { switchLocationAction } from "@/features/auth/switch-location";

/**
 * Switches which location the user is working in.
 *
 * IMPORTANT: this changes the *working context* — schedule, queue, staff,
 * fees. It does NOT scope patient identity. A patient belongs to the doctor,
 * so the doctor's timeline for that patient is the same everywhere. Location
 * scoping applies to the clinical events, which is what the RLS policies gate.
 */

export type LocationType = "PERSONAL_CHAMBER" | "CLINIC" | "HOSPITAL" | "TELEMEDICINE" | "OTHER";

export interface LocationOption {
  id: string;
  name: string;
  type: LocationType;
  roles: string[];
}

const TYPE_ICON: Record<LocationType, React.ReactNode> = {
  PERSONAL_CHAMBER: <Building2 className="size-4" />,
  CLINIC: <Hospital className="size-4" />,
  HOSPITAL: <Hospital className="size-4" />,
  TELEMEDICINE: <Video className="size-4" />,
  OTHER: <Building2 className="size-4" />,
};

const TYPE_LABEL: Record<LocationType, string> = {
  PERSONAL_CHAMBER: "Own chamber",
  CLINIC: "Clinic",
  HOSPITAL: "Hospital",
  TELEMEDICINE: "Telemedicine",
  OTHER: "Other",
};

const ROLE_LABEL: Record<string, string> = {
  DOCTOR: "Doctor",
  RECEPTIONIST: "Reception",
  LOCATION_ADMIN: "Admin",
};

export function LocationSwitcher({
  locations,
  activeLocationId,
  className,
}: {
  locations: LocationOption[];
  activeLocationId: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  /**
   * Show the chosen clinic AT ONCE.
   *
   * The switch is a server action followed by a full refresh, and the header
   * used to keep showing the old name for the whole round trip — several
   * seconds, during which the only feedback was a dimmed button. A doctor
   * reasonably clicks again.
   *
   * This is presentation only. The cookie is still written and re-verified
   * server-side against ACTIVE memberships, and `requireLocationContext`
   * re-checks on every request; nothing here grants access to anything.
   */
  const [optimisticId, setOptimisticId] = React.useState<string | null>(null);

  /**
   * Honoured only WHILE the switch is in flight. The moment the transition
   * ends, the server's answer wins again — so a refused or failed switch
   * cannot leave the header naming a clinic we are not in.
   */
  const activeId = pending && optimisticId ? optimisticId : activeLocationId;
  const active = locations.find((c) => c.id === activeId) ?? locations[0];
  if (!active) return null;

  function select(id: string) {
    if (id === active!.id) return;
    setOptimisticId(id);
    startTransition(async () => {
      try {
        await switchLocationAction(id);
        router.refresh();
      } catch {
        // Refused, or the network failed: fall back to what the server says
        // rather than leaving the header claiming a clinic we did not switch to.
        setOptimisticId(null);
      }
    });
  }

  const roleSummary = active.roles
    .map((r) => ROLE_LABEL[r] ?? r)
    .join(" · ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={pending}
            aria-label={`Location: ${active.name}. Change location.`}
            className={cn(
              "inline-flex h-10 max-w-[240px] items-center gap-2 rounded-xl border border-hairline bg-white/80 px-2.5 text-left transition-colors hover:bg-white disabled:opacity-60 focus-visible:focus-ring",
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
            {roleSummary || TYPE_LABEL[active.type]}
          </span>
        </span>
        <ChevronsUpDown
          className="size-3.5 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        {/* Base UI requires GroupLabel inside a Group — a bare label throws. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Where are you working?</DropdownMenuLabel>

          {locations.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => select(c.id)}
              className="items-start gap-2.5 py-2"
            >
              <span className="mt-0.5 shrink-0 text-brand" aria-hidden="true">
                {TYPE_ICON[c.type]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">
                  {c.name}
                </span>
                <span className="block truncate text-[11px] text-ink-muted">
                  {TYPE_LABEL[c.type]}
                  {c.roles.length
                    ? ` · ${c.roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ")}`
                    : ""}
                </span>
              </span>
              {c.id === active.id ? (
                <Check
                  className="mt-0.5 size-4 shrink-0 text-brand"
                  aria-hidden="true"
                />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <p className="border-t border-hairline px-2 pt-2 pb-1 text-[11px] leading-snug text-ink-muted">
          Switching changes your schedule, queue and staff. Your own patient
          records stay the same everywhere.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}






