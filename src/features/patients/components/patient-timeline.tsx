import * as React from "react";
import Link from "next/link";
import {
  UserPlus, CalendarDays, Stethoscope, ClipboardPlus,
  FlaskConical, FileText, CalendarClock, MapPin, History,
  ChevronRight, CircleAlert,
} from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/utils";
import {
  TIMELINE_EVENT_TYPES,
  TIMELINE_LABEL,
  TIMELINE_AVAILABLE,
  type TimelineEvent,
  type TimelineEventType,
} from "../timeline";

const ICON: Record<TimelineEventType, React.ReactNode> = {
  registration: <UserPlus className="size-4" />,
  appointment: <CalendarDays className="size-4" />,
  consultation: <Stethoscope className="size-4" />,
  prescription: <ClipboardPlus className="size-4" />,
  investigation: <FlaskConical className="size-4" />,
  document: <FileText className="size-4" />,
  followup: <CalendarClock className="size-4" />,
};

function listSources(names: string[]): string {
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "Asia/Dhaka",
  }).format(d);
}

export function PatientTimeline({
  patientId,
  events,
  missing,
  activeType,
  activeLocationId,
  locations,
}: {
  patientId: string;
  events: TimelineEvent[];
  missing: string[];
  activeType: TimelineEventType | "all";
  activeLocationId: string | "all";
  locations: { id: string; name: string }[];
}) {
  const href = (type: string, loc: string) =>
    `/patients/${patientId}?type=${type}&loc=${loc}#timeline`;

  const moduleMissing =
    activeType !== "all" && !TIMELINE_AVAILABLE[activeType];

  return (
    <SectionCard id="timeline" className="min-w-0 overflow-hidden">
      <SectionHeader title="Timeline" icon={<History className="size-4" />} />

      {missing.length > 0 ? (
        <p
          role="alert"
          className="flex min-w-0 items-start gap-2 border-b border-hairline bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c] sm:px-5"
        >
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            This history is incomplete — {listSources(missing)} could not be loaded. Do not rely on
            it until the page has been reloaded successfully.
          </span>
        </p>
      ) : null}

      <div className="min-w-0 space-y-3 border-b border-hairline p-4 sm:p-5">
        {/*
          At phone widths the chips wrap so none can disappear beyond the
          viewport. From sm upward they become a compact horizontal scroller.
        */}
        <div
          data-mobile-timeline-filters
          className="flex min-w-0 flex-wrap gap-1.5 sm:-mx-1 sm:flex-nowrap sm:overflow-x-auto sm:px-1 sm:pb-1"
        >
          <FilterChip href={href("all", activeLocationId)} active={activeType === "all"}>
            All
          </FilterChip>
          {TIMELINE_EVENT_TYPES.filter((t) => t !== "registration").map((t) => (
            <FilterChip
              key={t}
              href={href(t, activeLocationId)}
              active={activeType === t}
              muted={!TIMELINE_AVAILABLE[t]}
            >
              {TIMELINE_LABEL[t]}
            </FilterChip>
          ))}
        </div>

        {locations.length > 1 ? (
          <div className="flex min-w-0 flex-wrap gap-1.5 sm:-mx-1 sm:flex-nowrap sm:overflow-x-auto sm:px-1 sm:pb-1">
            <FilterChip href={href(activeType, "all")} active={activeLocationId === "all"}>
              <MapPin className="size-3" aria-hidden="true" />
              All locations
            </FilterChip>
            {locations.map((l) => (
              <FilterChip
                key={l.id}
                href={href(activeType, l.id)}
                active={activeLocationId === l.id}
              >
                {l.name}
              </FilterChip>
            ))}
          </div>
        ) : null}
      </div>

      {moduleMissing ? (
        <EmptyState
          icon={ICON[activeType]}
          title={`${TIMELINE_LABEL[activeType]} is not included in this pilot yet`}
          description="Nothing is missing or hidden — this part of the record is not part of the pilot, so there is no data of this kind to show."
        />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<History className="size-5" />}
          title="Nothing here yet"
          description="Appointments, consultations and prescriptions will appear on this timeline as they happen."
        />
      ) : (
        <ol className="divide-y divide-hairline">
          {events.map((e) => {
            const body = (
              <>
                <span
                  className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"
                  aria-hidden="true"
                >
                  {ICON[e.type]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 break-words text-sm font-semibold text-ink">{e.title}</span>
                    {e.badge ? (
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                          e.badge === "Superseded"
                            ? "bg-warning-soft text-ink"
                            : "bg-success-soft text-ink",
                        )}
                      >
                        {e.badge}
                      </span>
                    ) : null}
                  </span>
                  {e.summary ? (
                    <span className="mt-0.5 block break-words text-[13px] text-ink-secondary">{e.summary}</span>
                  ) : null}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-ink-muted">
                    <span>{formatWhen(e.occurredAt)}</span>
                    {e.locationName ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          <span className="break-words">{e.locationName}</span>
                        </span>
                      </>
                    ) : null}
                  </span>
                </span>
                {e.href ? (
                  <ChevronRight className="mt-2 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                ) : null}
              </>
            );

            return (
              <li key={e.id} className="min-w-0">
                {e.href ? (
                  <Link
                    href={e.href}
                    className="flex min-w-0 gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:px-5"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-w-0 gap-3 px-4 py-3.5 sm:px-5">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

function FilterChip({
  href,
  active,
  muted,
  children,
}: {
  href: string;
  active: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:focus-ring",
        active
          ? "bg-brand text-white"
          : muted
            ? "bg-surface-muted text-ink-muted hover:text-ink-secondary"
            : "bg-surface-muted text-ink-secondary hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
