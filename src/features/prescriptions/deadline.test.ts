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
    const boom = Promise.reject(new Error("network went away"));
    await expect(withWriteDeadline(boom, 1000)).resolves.toMatchObject({ kind: "unconfirmed" });
  });

  it("a slow write that DOES answer keeps its own outcome", async () => {
    let release!: (v: RxResult) => void;
    const slow = new Promise<RxResult>((r) => (release = r));
    const settled = withWriteDeadline(slow, 5000);
    await vi.advanceTimersByTimeAsync(4000);
    release(ok);
    expect(await settled).toEqual(ok);
  });

  it("the budget clears a real production save with room to spare", () => {
    expect(RX_WRITE_DEADLINE_MS).toBeGreaterThan(17_500 * 2);
  });
});

describe("the settled state is the SAFE one", () => {
  it("`unconfirmed` says the commit is unknown — never 'not saved'", () => {
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
    for (const file of ["deadline.ts", "use-prescription.ts"]) {
      const src = strip(await readFile(path.resolve("src/features/prescriptions", file), "utf8"));
      expect(src, `${file} must not retry a clinical write`).not.toMatch(
        /\bretry|retries|attempt\s*\+\+|backoff/i,
      );
    }
  });

  it("the coordinator actually applies the deadline to every mutation", async () => {
    const src = strip(
      await readFile(path.resolve("src/features/prescriptions/use-prescription.ts"), "utf8"),
    );
    expect(src).toMatch(/gate\.run\(\(\) => withWriteDeadline\(fn\(liveVersion\.current\)\)\)/);
  });
});

describe("a convenience read cannot delay a clinical write", () => {
  it("signed medicine suggestions are fetched over HTTP, not as a server action", async () => {
    const form = strip(
      await readFile(
        path.resolve("src/features/prescriptions/components/medicine-form.tsx"),
        "utf8",
      ),
    );
    expect(form).toMatch(/fetch\(`\/api\/m3-signed-medicine-history/);
    expect(form).not.toMatch(/medicineSuggestionsAction|getSignedMedicineHistoryAction/);

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

  it("the signed-history route authorises and stays private/no-store", async () => {
    const route = strip(
      await readFile(path.resolve("src/app/api/m3-signed-medicine-history/route.ts"), "utf8"),
    );
    expect(route).toMatch(/await requireLocationContext\(\)/);
    expect(route).toMatch(/getSignedMedicineHistory\(/);
    expect(route).toMatch(/private, no-store/);
  });
});
