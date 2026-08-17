/**
 * The one thing standing between a stale screen and a wrong clinical write.
 *
 * Two rules, and both are invariants rather than button states:
 *
 *   - only one mutation from this screen at a time
 *   - NO mutation at all while a conflict or desynchronisation is unresolved
 *
 * Deliberately framework-free. The bug this replaces was subtle and entirely
 * about timing: the gate was closed from a `useEffect`, but the mutation that
 * caused the conflict released its in-flight flag in its own `finally`, which
 * runs BEFORE any effect. In that window the gate was still open and a direct
 * call could start a second mutation against a version already known to be
 * stale. Disabled buttons hid it; the coordinator is supposed to be the rule.
 *
 * So closing is synchronous, and testable without rendering anything.
 */
export class MutationGate {
  private inFlight = false;
  private closed = false;

  /** True while a conflict or desync owns the encounter. */
  get isClosed(): boolean {
    return this.closed;
  }

  get isBusy(): boolean {
    return this.inFlight;
  }

  /** Shut immediately — before the mutation that discovered the problem returns. */
  close(): void {
    this.closed = true;
  }

  /** Only once every subject is settled, or synchronisation is restored. */
  open(): void {
    this.closed = false;
  }

  /**
   * Returns null WITHOUT calling `fn` when the gate is shut or something is
   * already running. Callers treat null as "did not happen", never as failure.
   */
  async run<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.inFlight || this.closed) return null;
    this.inFlight = true;
    try {
      return await fn();
    } finally {
      this.inFlight = false;
    }
  }
}
