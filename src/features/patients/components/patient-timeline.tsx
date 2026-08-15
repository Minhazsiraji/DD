import * as React from "react";
import Link from "next/link";
import {
  UserPlus, CalendarDays, Stethoscope, ClipboardPlus,
  FlaskConical, FileText, CalendarClock, MapPin, History,
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

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "Asia/Dhaka",
  }).format(d);
}

/**
 * The patient's one continuous timeline, across every practice location.
 *
 * Filters for modules that do not exist yet still render — but say so plainly.
 * Showing an empty list for "Prescriptions" would read as "this patient has
 * never been prescribed anything", which is a clinically misleading thing to
 * imply.
 */
export function PatientTimeline({
  patientId,
  events,
  activeType,
  activeLocationId,
  locations,
}: {
  patientId: string;
  events: TimelineEvent[];
  activeType: TimelineEventType | "all";
  activeLocationId: string | "all";
  locations: { id: string; name: string }[];
}) {
  const href = (type: string, loc: string) =>
    `/patients/${patientId}?type=${type}&loc=${loc}#timeline`;

  const moduleMissing =
    activeType !== "all" && !TIMELINE_AVAILABLE[activeType];

  return (
    <SectionCard id="timeline" className="overflow-hidden">
      <SectionHeader title="Timeline" icon={<History className="size-4" />} />

      <div className="space-y-3 border-b border-hairline p-4 sm:p-5">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
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
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
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
          title={`${TIMELINE_LABEL[activeType]} isn't built yet`}
          description="This filter will fill in when the module ships. Nothing is hidden — there is simply no data of this kind yet."
        />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<History className="size-5" />}
          title="Nothing here yet"
          description="Appointments, consultations and prescriptions will appear on this timeline as they happen."
        />
      ) : (
        <ol className="divide-y divide-hairline">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 px-4 py-3.5 sm:px-5">
              <span
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"
                aria-hidden="true"
              >
                {ICON[e.type]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{e.title}</p>
                {e.summary ? (
                  <p className="mt-0.5 text-[13px] text-ink-secondary">{e.summary}</p>
                ) : null}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted tabular-nums">
                  <span>{formatWhen(e.occurredAt)}</span>
                  {e.locationName ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden="true" />
                        {e.locationName}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
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
        "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:focus-ring",
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
