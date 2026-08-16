"use client";

import * as React from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { refreshQueueAction } from "./actions";
import { createRefreshScheduler, type RefreshScheduler } from "./refresh-scheduler";
import type { QueueRow } from "./schema";

/**
 * Keeping the queue screen current.
 *
 * TWO MECHANISMS, ONE SOURCE OF TRUTH.
 *
 * Supabase Realtime tells us *that* something changed. It never tells us *what*
 * to display: every refresh re-reads through `refreshQueueAction`, which goes
 * to the RLS-checked server path. Rendering a Realtime payload would mean
 * trusting Realtime's row filtering to agree with our policies, and those are
 * two different mechanisms — if they ever disagreed, the screen would be the
 * place it showed up.
 *
 * Polling is a bounded fallback, not the plan. It runs slowly while Realtime is
 * connected (in case an event is missed), faster when it is not, and stops
 * entirely while the tab is hidden — a queue screen left open overnight on a
 * clinic PC should not poll until morning.
 */

/**
 * `watching` and `live` are deliberately different.
 *
 * A channel reporting SUBSCRIBED only means the socket opened — it does not mean
 * events are arriving. That distinction is not academic: the first version of
 * this screen sat there saying "Live" while a change made directly in the
 * database never appeared, because the socket had connected without the user's
 * JWT and RLS was filtering everything out.
 *
 * So "Live" has to be EARNED by an event actually arriving. Until then the
 * screen says it is connected and polls briskly, because an unproven channel is
 * indistinguishable from a broken one.
 */
export type ConnectionState =
  | "connecting"
  | "watching"
  | "live"
  | "polling"
  | "offline";

/** Slow heartbeat once Realtime has proven itself; brisker until then. */
const POLL_LIVE_MS = 60_000;
const POLL_WATCHING_MS = 15_000;
const POLL_FALLBACK_MS = 8_000;

interface Options {
  sessionDate: string;
  locationId: string;
  initialRows: QueueRow[];
  /** False when the first server render already failed — see the outage state. */
  initiallyOk: boolean;
}

export interface LiveQueue {
  rows: QueueRow[];
  connection: ConnectionState;
  /** True when the last read failed. Never rendered as an empty queue. */
  failed: boolean;
  lastUpdated: number | null;
  refreshing: boolean;
  refresh: () => void;
}

export function useLiveQueue({
  sessionDate,
  locationId,
  initialRows,
  initiallyOk,
}: Options): LiveQueue {
  const [rows, setRows] = React.useState<QueueRow[]>(initialRows);
  const [failed, setFailed] = React.useState(!initiallyOk);
  const [connection, setConnection] = React.useState<ConnectionState>("connecting");
  // Lazy initialiser: Date.now() during render is impure and the compiler
  // rejects it — the value must be computed once, on mount.
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(() =>
    initiallyOk ? Date.now() : null,
  );
  const [refreshing, setRefreshing] = React.useState(false);

  /**
   * Monotonic ticket. A slow response that started before a newer one must
   * never overwrite it — on a clinic's connection that reordering is common,
   * and it would show a queue that has already moved on.
   */
  const ticket = React.useRef(0);

  const readOnce = React.useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const outcome = await refreshQueueAction(sessionDate);
      if (mine !== ticket.current) return; // overtaken by a newer read
      if (outcome.ok) {
        setRows(outcome.rows);
        setFailed(false);
        setLastUpdated(Date.now());
      } else {
        // Keep the rows we already have. A failed read is not an empty room.
        setFailed(true);
      }
    } catch {
      if (mine === ticket.current) setFailed(true);
    }
  }, [sessionDate]);

  /**
   * Signals are COALESCED, never dropped.
   *
   * The earlier version returned early while a read was in flight, so a
   * Realtime event arriving mid-read was silently discarded — and once the
   * channel was trusted, the next poll could be a minute away. The scheduler
   * remembers that a refresh was asked for and runs exactly one catch-up read
   * when the current one finishes.
   */
  /**
   * One scheduler for the lifetime of the screen.
   *
   * It reaches the current `readOnce` through a ref rather than being rebuilt
   * when the date changes — recreating it would drop any pending trailing read,
   * which is the exact signal loss this is here to prevent.
   */
  const readOnceRef = React.useRef(readOnce);
  React.useEffect(() => {
    readOnceRef.current = readOnce;
  }, [readOnce]);

  // Built in an effect, not during render: constructing it inline would hand a
  // ref to a function while rendering, which the compiler lint rejects.
  const schedulerRef = React.useRef<RefreshScheduler | null>(null);
  React.useEffect(() => {
    schedulerRef.current = createRefreshScheduler({
      run: () => readOnceRef.current(),
      onBusyChange: setRefreshing,
    });
  }, []);

  const load = React.useCallback((showSpinner: boolean) => {
    void schedulerRef.current?.request(showSpinner);
  }, []);

  const refresh = React.useCallback(() => load(true), [load]);

  // ---- Realtime -----------------------------------------------------------
  React.useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const onChange = () => {
      if (cancelled) return;
      // An event actually arrived, so the channel has earned "Live".
      setConnection("live");
      void load(false);
    };

    (async () => {
      /**
       * The socket must carry the USER's token, not the anon key.
       *
       * Without this the channel still reports SUBSCRIBED — it simply never
       * delivers anything, because RLS filters every row for an anonymous
       * subscriber. That failure is silent and looks exactly like a working
       * connection, which is how it survived the first pass.
       */
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);

      /**
       * One channel, named for the location and day: two mounts of the same
       * screen cannot produce two subscriptions, and changing location tears
       * the old one down before opening the new.
       */
      channel = supabase
        .channel(`queue:${locationId}:${sessionDate}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "appointments",
            filter: `practice_location_id=eq.${locationId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "queue_entries",
            filter: `practice_location_id=eq.${locationId}`,
          },
          onChange,
        )
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            // Connected, but unproven until an event arrives.
            setConnection((c) => (c === "live" ? c : "watching"));
            void load(false); // catch anything missed while connecting
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setConnection("polling");
          } else if (status === "CLOSED") {
            setConnection((c) => (c === "offline" ? c : "polling"));
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [locationId, sessionDate, load]);

  // ---- Polling fallback ---------------------------------------------------
  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) clearInterval(timer);
      const period =
        connection === "live"
          ? POLL_LIVE_MS
          : connection === "watching"
            ? POLL_WATCHING_MS
            : POLL_FALLBACK_MS;
      timer = setInterval(() => void load(false), period);
    };

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    // A queue screen left open overnight should not poll until morning.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        void load(false); // catch up on whatever happened while hidden
        start();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [connection, load]);

  // ---- Browser online/offline --------------------------------------------
  React.useEffect(() => {
    const goOffline = () => setConnection("offline");
    const goOnline = () => {
      setConnection("connecting");
      void load(false);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [load]);

  return { rows, connection, failed, lastUpdated, refreshing, refresh };
}
