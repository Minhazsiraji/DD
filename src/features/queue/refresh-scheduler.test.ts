import { describe, it, expect, vi } from "vitest";
import { createRefreshScheduler } from "./refresh-scheduler";

/** A read we can hold open and release on demand — no timers, no flakiness. */
function controllable() {
  const calls: Array<{ showSpinner: boolean; release: () => void }> = [];
  const run = (showSpinner: boolean) =>
    new Promise<void>((resolve) => {
      calls.push({ showSpinner, release: resolve });
    });
  return { run, calls };
}

/** Let queued microtasks settle. The trailing read is started, not awaited. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("refresh scheduler", () => {
  it("runs a request immediately when idle", async () => {
    const { run, calls } = controllable();
    const s = createRefreshScheduler({ run });

    void s.request();
    expect(calls).toHaveLength(1);
    calls[0]!.release();
  });

  /**
   * THE REGRESSION THIS EXISTS FOR.
   *
   * The previous implementation returned early while a read was in flight, so a
   * Realtime event arriving mid-read was silently dropped and the screen stayed
   * stale until the next poll — up to a minute once the channel was trusted.
   */
  it("runs a trailing read for a signal that arrives mid-read", async () => {
    const { run, calls } = controllable();
    const s = createRefreshScheduler({ run });

    const first = s.request();
    expect(calls).toHaveLength(1);

    // A Realtime event lands while the first read is still open.
    void s.request();
    expect(calls, "must not start a second read yet").toHaveLength(1);

    calls[0]!.release();
    await first;
    await flush();

    expect(calls, "the signal must not be lost").toHaveLength(2);
    calls[1]!.release();
  });

  it("coalesces many signals during one read into a single trailing read", async () => {
    const { run, calls } = controllable();
    const s = createRefreshScheduler({ run });

    const first = s.request();
    for (let i = 0; i < 5; i++) void s.request();

    calls[0]!.release();
    await first;
    await flush();

    expect(calls, "five signals, one catch-up read").toHaveLength(2);
    calls[1]!.release();
  });

  it("queues a further read when a signal arrives during the trailing read", async () => {
    const { run, calls } = controllable();
    const s = createRefreshScheduler({ run });

    const first = s.request();
    void s.request(); // schedules the trailing read
    calls[0]!.release();
    await first;
    await flush();

    expect(calls).toHaveLength(2);
    void s.request(); // arrives during the trailing read
    calls[1]!.release();
    await flush();

    expect(calls, "the newest signal is honoured too").toHaveLength(3);
    calls[2]!.release();
  });

  it("honours a manual refresh that lands during a background read", async () => {
    const { run, calls } = controllable();
    const busy: boolean[] = [];
    const s = createRefreshScheduler({ run, onBusyChange: (b) => busy.push(b) });

    const first = s.request(false); // background poll, no spinner
    expect(busy).toEqual([]);

    void s.request(true); // user presses Refresh
    expect(busy, "the button must react immediately").toEqual([true]);

    calls[0]!.release();
    await first;
    await flush();

    expect(calls).toHaveLength(2);
    expect(calls[1]!.showSpinner, "the trailing read is the manual one").toBe(true);

    calls[1]!.release();
    await flush();
    expect(busy.at(-1), "spinner clears when the chain finishes").toBe(false);
  });

  /**
   * A failed read must still hand over to the trailing one. Otherwise one
   * transient error strands the screen until the next poll.
   */
  it("still runs the trailing read after a failure, and does not loop", async () => {
    let attempts = 0;
    const s = createRefreshScheduler({
      run: async () => {
        attempts++;
        throw new Error("network");
      },
    });

    await s.request();
    expect(attempts, "one failure alone must not retry").toBe(1);

    // A signal during a failing read still earns exactly one trailing read.
    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    const s2 = createRefreshScheduler({
      run: () =>
        new Promise<void>((_, reject) => {
          calls++;
          if (calls === 1) releaseFirst = () => reject(new Error("network"));
          else reject(new Error("network"));
        }),
    });

    const p = s2.request();
    void s2.request();
    releaseFirst!();
    await p;
    await flush();

    expect(calls, "exactly one trailing read, no runaway loop").toBe(2);
  });

  it("reports busy only while a read is actually in flight", async () => {
    const { run, calls } = controllable();
    const s = createRefreshScheduler({ run });

    expect(s.isBusy()).toBe(false);
    const first = s.request();
    expect(s.isBusy()).toBe(true);
    calls[0]!.release();
    await first;
    expect(s.isBusy()).toBe(false);
  });

  it("does not spam the busy callback with repeats", async () => {
    const { run, calls } = controllable();
    const onBusyChange = vi.fn();
    const s = createRefreshScheduler({ run, onBusyChange });

    const first = s.request(true);
    void s.request(true);
    void s.request(true);
    calls[0]!.release();
    await first;
    await flush();
    calls[1]!.release();
    await flush();

    expect(onBusyChange.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });
});
