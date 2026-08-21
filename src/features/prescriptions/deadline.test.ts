import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { withWriteDeadline, RX_WRITE_DEADLINE_MS } from "./deadline";
import { RX_UNCONFIRMED_MESSAGE } from "./errors";
import { recoveryPolicy } from "./recovery";
import type { RxResult } from "./actions";

/**
 * "Saving…" MUST END.
 *
 * The pilot reported a medicine stuck on "Saving…" for over five minutes that
 * never resolved, with the row absent from a freshly opened tab. A clinical
 * write with no terminal state is the worst of both errors: the doctor cannot
 * tell whether the medicine is on the prescription, so they either wait on a
 * screen that will never change or enter it again.
 */

const ok: RxResult = { ok: true, version: 2, items: [] };

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("every write reaches a settled state", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes a real answer straight through", async () => {
    await expect(withWriteDeadline(Promise.resolve(ok))).resolves.toEqual(ok);
  });

  it("a write that never answers becomes `unconfirmed`, not a spinner", async () => {
    // The reported bug, in one line: a promise that never settles.
    const never = new Promise<RxResult>(() => {});
    const settled = withWriteDeadline(never, 1000);

    await vi.advanceTimersByTimeAsync(1001);

    expect(await settled).toEqual({
      ok: false,
      kind: "unconfirmed",
      message: RX_UNCONFIRMED_MESSAGE,
    });
  });

  it("a REJECTED write settles too, rather than leaving the form busy", async () => {
    // An unhandled rejection is the same frozen spinner by another route.
    const boom = Promise.reject(new Error("network went away"));
    await expect(withWriteDeadline(boom, 1000)).resolves.toMatchObject({ kind: "unconfirmed" });
  });

  it("a slow write that DOES answer keeps its own outcome", async () => {
    /**
     * The deadline must not convert ordinary slowness into false uncertainty:
     * `unconfirmed` blocks the composer until the page is reloaded, so
     * over-eager timing has its own clinical cost.
     */
    let release!: (v: RxResult) => void;
    const slow = new Promise<RxResult>((r) => (release = r));
    const settled = withWriteDeadline(slow, 5000);

    await vi.advanceTimersByTimeAsync(4000);
    release(ok);

    expect(await settled).toEqual(ok);
  });

  it("the budget clears a real production save with room to spare", () => {
    // Measured on production: 17.5s cold, 8s warm.
    expect(RX_WRITE_DEADLINE_MS).toBeGreaterThan(17_500 * 2);
  });
});

describe("the settled state is the SAFE one", () => {
  it("`unconfirmed` says the commit is unknown — never 'not saved'", () => {
    /**
     * Reporting "not saved" about a write that did commit is how a patient
     * receives a medicine twice. The deadline abandons the WAIT, never the
     * write, so the only honest answer is that we do not know.
     */
    expect(recoveryPolicy("unconfirmed").committed).toBe("unknown");
  });

  it("it closes the editor and blocks, so the same medicine cannot be sent twice", () => {
    const policy = recoveryPolicy("unconfirmed");
    expect(policy.closesEditor).toBe(true);
    expect(policy.blocks).toBe(true);
  });

  it("the sentence tells the doctor to reload, not to re-enter", () => {
    expect(RX_UNCONFIRMED_MESSAGE).toMatch(/[Dd]o not enter it again/);
    expect(RX_UNCONFIRMED_MESSAGE).toMatch(/reload/i);
  });

  it("nothing in the write path retries automatically", async () => {
    /**
     * Retrying an unknown commit state is how one dose becomes two. There is no
     * retry loop, no backoff and no second attempt anywhere in the deadline or
     * the coordinator.
     */
    for (const file of ["deadline.ts", "use-prescription.ts"]) {
      const src = strip(await readFile(path.resolve("src/features/prescriptions", file), "utf8"));
      expect(src, `${file} must not retry a clinical write`).not.toMatch(
        /\bretry|retries|attempt\s*\+\+|backoff/i,
      );
    }
  });

  it("the coordinator actually applies the deadline to every mutation", async () => {
    /**
     * One choke point: `run()`. A mutation added later that bypassed it would
     * bring the frozen spinner straight back.
     */
    const src = strip(
      await readFile(path.resolve("src/features/prescriptions/use-prescription.ts"), "utf8"),
    );
    expect(src).toMatch(/gate\.run\(\(\) => withWriteDeadline\(fn\(liveVersion\.current\)\)\)/);
  });
});

describe("a convenience read cannot delay a clinical write", () => {
  it("medicine suggestions are fetched over HTTP, not as a server action", async () => {
    /**
     * Next.js SERIALISES server actions from one client. As an action, this
     * autocomplete queued in front of the doctor's save — measured on
     * production at 1,838ms during which the already-clicked save had not
     * started. That is the reported "Saving…" that would not end, and it is
     * why PRN looked responsible: PRN is ticked immediately after typing the
     * name, so the lookup is still in flight on that attempt and settled on
     * the retry.
     */
    const form = strip(
      await readFile(
        path.resolve("src/features/prescriptions/components/medicine-form.tsx"),
        "utf8",
      ),
    );
    expect(form).toMatch(/fetch\(`\/api\/medicine-suggestions/);
    expect(form).not.toMatch(/medicineSuggestionsAction/);

    // And the action is gone, not merely unused: it was a live POST endpoint.
    const actions = strip(
      await readFile(path.resolve("src/features/prescriptions/actions.ts"), "utf8"),
    );
    expect(actions).not.toMatch(/export async function medicineSuggestionsAction/);
  });

  it("the lookup is abortable, so a stale one cannot answer over a newer one", async () => {
    const form = strip(
      await readFile(
        path.resolve("src/features/prescriptions/components/medicine-form.tsx"),
        "utf8",
      ),
    );
    expect(form).toMatch(/new AbortController\(\)/);
    expect(form).toMatch(/controller\.abort\(\)/);
  });

  it("the route still authorises exactly as the action did", async () => {
    /**
     * Moving a read off the action queue must not move it outside the session.
     * `requireLocationContext()` first, and the query still runs under the
     * caller's own session with RLS — so it can only ever return their own
     * signed wording.
     */
    const route = strip(
      await readFile(path.resolve("src/app/api/medicine-suggestions/route.ts"), "utf8"),
    );
    expect(route).toMatch(/await requireLocationContext\(\)/);
    expect(route).toMatch(/getMedicineSuggestions\(/);
    // Never a shared cache: a doctor's past wording is theirs alone.
    expect(route).toMatch(/private, no-store/);
  });
});
