"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  Hospital,
  Video,
  ChevronsUpDown,
  Check,
  LockKeyhole,
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
import { switchLocationAction } from "@/features/auth/switch-location";

export type LocationType =
  | "PERSONAL_CHAMBER"
  | "CLINIC"
  | "HOSPITAL"
  | "TELEMEDICINE"
  | "OTHER";

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
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  const [optimisticId, setOptimisticId] = React.useState<string | null>(null);

  const activeId = pending && optimisticId ? optimisticId : activeLocationId;
  const active = locations.find((c) => c.id === activeId) ?? locations[0];
  if (!active) return null;

  const clinicalContextLocked =
    pathname.startsWith("/consultation/") || pathname.startsWith("/prescription/");

  function select(id: string) {
    if (id === active!.id || clinicalContextLocked) return;
    setOptimisticId(id);
    startTransition(async () => {
      try {
        await switchLocationAction(id);
        router.refresh();
      } catch {
        setOptimisticId(null);
      }
    });
  }

  const roleSummary = active.roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ");

  if (clinicalContextLocked) {
    return (
      <div
        className={cn(
          "inline-flex h-11 max-w-[240px] items-center gap-2 rounded-xl border border-brand/12 bg-white/82 px-2.5 text-left shadow-[0_1px_2px_rgb(23_34_59/0.025)]",
          className,
        )}
        aria-label={`Locked clinical context: ${active.name}`}
        title="This consultation stays in the chamber where it was opened. Leave the autosaved workflow before switching chamber."
      >
        <LockKeyhole className="size-4 shrink-0 text-brand" aria-hidden="true" />
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-[13px] leading-tight font-semibold text-ink">
            {active.name}
          </span>
          <span className="block truncate text-[11px] text-ink-muted">Locked context</span>
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={pending}
            aria-label={`Location: ${active.name}. Change location.`}
            className={cn(
              "inline-flex h-11 max-w-[240px] items-center gap-2 rounded-xl border border-hairline bg-white/82 px-2.5 text-left shadow-[0_1px_2px_rgb(23_34_59/0.025)] transition-[background-color,border-color] hover:border-brand/20 hover:bg-white disabled:opacity-60 focus-visible:focus-ring",
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
        <ChevronsUpDown className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72 rounded-2xl border-hairline bg-white/96 p-1.5 shadow-raised">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Where are you working?</DropdownMenuLabel>

          {locations.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => select(c.id)}
              className="items-start gap-2.5 rounded-xl py-2.5"
            >
              <span className="mt-0.5 shrink-0 text-brand" aria-hidden="true">
                {TYPE_ICON[c.type]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{c.name}</span>
                <span className="block truncate text-[11px] text-ink-muted">
                  {TYPE_LABEL[c.type]}
                  {c.roles.length
                    ? ` · ${c.roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ")}`
                    : ""}
                </span>
              </span>
              {c.id === active.id ? (
                <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <p className="border-t border-hairline px-2 pt-2 pb-1 text-[11px] leading-snug text-ink-muted">
          Switching changes your working chamber. Active clinical workflows keep the context in which they were opened.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
