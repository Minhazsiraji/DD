"use client";

import * as React from "react";
import {
  RefreshCw,
  Wifi,
  WifiOff,
  Timer,
  CircleAlert,
  Users,
  UserX,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/common/empty-state";
import { useLiveQueue, type ConnectionState } from "../use-live-queue";
import { groupQueue, type QueueRow } from "../schema";
import { QueueCard } from "./queue-card";

/**
 * The room, in three groups.
 *
 * The groups are a FILTER over the order the database returned — never a sort.
 * `get_queue()` already applies priority and token rules, and re-deriving them
 * here would be the second copy ADR 0009 exists to prevent.
 */
export function QueueBoard({
  initialRows,
  initiallyOk,
  sessionDate,
  locationId,
  locationName,
  currentDoctorId = null,
}: {
  initialRows: QueueRow[];
  initiallyOk: boolean;
  sessionDate: string;
  locationId: string;
  locationName: string;
  /** Null when the viewer is not a doctor — reception sees this board too. */
  currentDoctorId?: string | null;
}) {
  const { rows, connection, failed, lastUpdated, refreshing, refresh } = useLiveQueue({
    sessionDate,
    locationId,
    initialRows,
    initiallyOk,
  });

  /**
   * A single clock for every card, ticking once a minute.
   *
   * Each card computing its own `Date.now()` would make "waiting 12 min" drift
   * between rows, and computing it during render is impure — the React compiler
   * lint rejects it outright.
   */
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { withDoctor, waiting, skipped } = groupQueue(rows);
  const empty = rows.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ConnectionPill connection={connection} lastUpdated={lastUpdated} now={now} />
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60 focus-visible:focus-ring"
        >
          <RefreshCw
            className={cn("size-4", refreshing && "animate-spin motion-reduce:animate-none")}
            aria-hidden="true"
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/*
        A failed read keeps whatever we last had on screen and says so. Blanking
        it would turn an outage into "nobody is waiting" — the one sentence that
        sends a patient home.
      */}
      {failed ? (
        <p className="flex items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          The queue could not be refreshed
          {lastUpdated ? ", so this is the last version that loaded" : ""}. This is
          not an empty waiting room — check with the desk before telling anyone
          they have been seen.
        </p>
      ) : null}

      {empty && !failed ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="Nobody is waiting"
          description={`Patients appear here at ${locationName} as soon as reception marks them arrived.`}
        />
      ) : null}

      {withDoctor.length > 0 ? (
        <Section
          title="With the doctor"
          icon={<Stethoscope className="size-4" />}
          count={withDoctor.length}
        >
          {withDoctor.map((row) => (
            <QueueCard
              key={row.appointmentId}
              row={row}
              variant="current"
              now={now}
              onChanged={refresh}
              currentDoctorId={currentDoctorId}
            />
          ))}
        </Section>
      ) : null}

      {waiting.length > 0 ? (
        <Section title="Waiting" icon={<Users className="size-4" />} count={waiting.length}>
          {waiting.map((row) => (
            <QueueCard
              key={row.appointmentId}
              row={row}
              variant="waiting"
              now={now}
              onChanged={refresh}
            />
          ))}
        </Section>
      ) : null}

      {skipped.length > 0 ? (
        <Section
          title="Did not answer"
          icon={<UserX className="size-4" />}
          count={skipped.length}
          hint="Still here and still owed a consultation — call them again when they appear."
        >
          {skipped.map((row) => (
            <QueueCard
              key={row.appointmentId}
              row={row}
              variant="skipped"
              now={now}
              onChanged={refresh}
            />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  hint,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="text-ink-muted" aria-hidden="true">
            {icon}
          </span>
          {title}
        </h2>
        <span className="text-xs tabular-nums text-ink-secondary">{count}</span>
        {hint ? <p className="basis-full text-xs text-ink-muted">{hint}</p> : null}
      </div>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

/**
 * Says which mechanism is actually carrying updates.
 *
 * "Live" means a Realtime channel is subscribed. "Checking every few seconds"
 * means it is not, and a timer is doing the work — claiming live when a poll is
 * carrying it would be a lie the user cannot check.
 */
function ConnectionPill({
  connection,
  lastUpdated,
  now,
}: {
  connection: ConnectionState;
  lastUpdated: number | null;
  now: number;
}) {
  const config: Record<
    ConnectionState,
    { label: string; icon: React.ReactNode; className: string }
  > = {
    connecting: {
      label: "Connecting…",
      icon: <Timer className="size-3.5" aria-hidden="true" />,
      className: "bg-surface-muted text-ink-secondary",
    },
    // Connected but nothing has come through yet, so it has not earned "Live".
    watching: {
      label: "Connected",
      icon: <Wifi className="size-3.5" aria-hidden="true" />,
      className: "bg-info-soft text-[#0a5a80]",
    },
    live: {
      label: "Live",
      icon: <Wifi className="size-3.5" aria-hidden="true" />,
      className: "bg-success-soft text-[#07684a]",
    },
    polling: {
      label: "Checking every few seconds",
      icon: <Timer className="size-3.5" aria-hidden="true" />,
      className: "bg-warning-soft text-[#8a3f07]",
    },
    offline: {
      label: "No connection",
      icon: <WifiOff className="size-3.5" aria-hidden="true" />,
      className: "bg-danger-soft text-[#a81c1c]",
    },
  };

  const c = config[connection];
  const ageSeconds = lastUpdated ? Math.floor((now - lastUpdated) / 1000) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
          c.className,
        )}
      >
        {c.icon}
        {c.label}
      </span>
      {ageSeconds !== null ? (
        <span className="text-xs text-ink-muted">
          {ageSeconds < 60 ? "updated just now" : `updated ${Math.floor(ageSeconds / 60)} min ago`}
        </span>
      ) : null}
    </div>
  );
}
