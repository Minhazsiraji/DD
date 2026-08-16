/**
 * Coalescing refresh scheduler.
 *
 * The queue is refreshed by three things at once — Realtime events, a polling
 * timer, and the user's own button — and they overlap constantly on a busy
 * screen.
 *
 * The naive guard ("if a read is already running, return") LOSES signals: a
 * Realtime event arriving mid-read is discarded, and once the channel is trusted
 * the next poll may be a minute away. A monotonic ticket does not help, because
 * the newer request never starts at all.
 *
 * So a request during an in-flight read is REMEMBERED, and exactly one trailing
 * read runs when the current one finishes. Any number of signals arriving during
 * that window coalesce into that single trailing read — the queue only needs the
 * latest state, not one read per event.
 *
 * Pure and framework-free so the timing can be tested deterministically.
 */
export interface RefreshScheduler {
  /** Ask for a refresh. Returns when this request's work is done. */
  request: (showSpinner?: boolean) => Promise<void>;
  /** True while a read is in flight — for the button's disabled state. */
  isBusy: () => boolean;
}

export interface SchedulerOptions {
  /** Performs one read. Rejections are contained; they never stop the loop. */
  run: (showSpinner: boolean) => Promise<void>;
  /** Notified whenever the visible "refreshing" state should change. */
  onBusyChange?: (busy: boolean) => void;
}

export function createRefreshScheduler({
  run,
  onBusyChange,
}: SchedulerOptions): RefreshScheduler {
  let inFlight = false;
  let pending = false;
  /** A manual refresh anywhere in the chain keeps the spinner visible. */
  let pendingSpinner = false;
  let spinnerShown = false;

  const setBusy = (busy: boolean) => {
    if (busy === spinnerShown) return;
    spinnerShown = busy;
    onBusyChange?.(busy);
  };

  async function cycle(showSpinner: boolean): Promise<void> {
    inFlight = true;
    if (showSpinner) setBusy(true);

    try {
      await run(showSpinner);
    } catch {
      // Swallowed on purpose: a failed read must not prevent the trailing one,
      // or a transient error would leave the screen stale until the next poll.
    } finally {
      inFlight = false;
    }

    if (pending) {
      /**
       * Exactly one trailing read per window, started WITHOUT awaiting it.
       *
       * Awaiting would make every caller wait for work it did not ask for — a
       * poll would block on a manual refresh's read, and the caller's own
       * promise would only settle when the whole chain drained.
       *
       * The flag is cleared BEFORE running, so signals arriving during the
       * trailing read open the next window rather than extending this one.
       */
      pending = false;
      const spin = pendingSpinner;
      pendingSpinner = false;
      void cycle(spin);
      return;
    }

    setBusy(false);
  }

  return {
    request(showSpinner = false) {
      if (inFlight) {
        pending = true;
        if (showSpinner) {
          pendingSpinner = true;
          setBusy(true); // the user pressed it; show them something happening
        }
        return Promise.resolve();
      }
      return cycle(showSpinner);
    },
    isBusy: () => inFlight,
  };
}
