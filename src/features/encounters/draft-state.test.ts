import { describe, it, expect } from "vitest";
import {
  applySaveResult,
  beginSave,
  keepLocalEdits,
  ownedKeys,
  takeServerVersion,
} from "./draft-state";
import { buildPatch } from "./draft-patch";
import { emptyDraft, type DraftValues, type SaveResult } from "./schema";

function draft(overrides: Partial<DraftValues> = {}): DraftValues {
  return { ...emptyDraft(), ...overrides };
}

const ok = (version: number): SaveResult => ({
  ok: true,
  version,
  savedAt: "2026-08-17T06:00:00.000Z",
});

const conflict = (version: number, values: DraftValues): SaveResult => ({
  ok: false,
  kind: "conflict",
  version,
  values,
  message: "changed elsewhere",
});

/**
 * A tiny stand-in for the hook, running the same calls in the same order.
 *
 * The rules under test decide whether one doctor's note can overwrite
 * another's, so they are exercised directly rather than through a component —
 * including the ordering that only happens when someone types while a request
 * is still in the air.
 */
function makeDraft(initial: DraftValues, version = 1) {
  let values = initial;
  let baseline = initial;
  let current = version;
  let state = { kind: "clean" } as ReturnType<typeof applySaveResult>["state"];

  return {
    type(key: keyof DraftValues, text: string) {
      values = { ...values, [key]: text };
    },
    get values() {
      return values;
    },
    get baseline() {
      return baseline;
    },
    get version() {
      return current;
    },
    get state() {
      return state;
    },
    get dirtyKeys() {
      return ownedKeys(values, baseline);
    },
    /** Returns a `finish` you call when the server answers — the deferred half. */
    startSave() {
      const attempt = beginSave(values, baseline);
      if (!attempt) return null;
      state = { kind: "saving" };
      return {
        patch: attempt.patch,
        finish(result: SaveResult) {
          const applied = applySaveResult({
            sent: attempt.sent,
            current: values, // read AT RESPONSE TIME, as the hook does
            baseline,
            result,
          });
          if (applied.values) values = applied.values;
          baseline = applied.baseline;
          if (applied.version !== undefined) current = applied.version;
          state = applied.state;
        },
      };
    },
    keepMine(theirs: DraftValues) {
      const applied = keepLocalEdits({ current: values, baseline, theirs });
      values = applied.values!;
      baseline = applied.baseline;
      state = applied.state;
    },
    takeTheirs(theirs: DraftValues) {
      const applied = takeServerVersion(theirs);
      values = applied.values!;
      baseline = applied.baseline;
      state = applied.state;
    },
  };
}

describe("ownership is measured against the last acknowledgement", () => {
  /**
   * The sequence that a lifetime "fields I touched" set gets wrong.
   *
   * Tab A edits Assessment and SAVES it. Later, Tab B changes Assessment. Tab A
   * then edits only Advice and hits a conflict. Choosing "keep mine" must not
   * resurrect Tab A's older Assessment over Tab B's newer one — Tab A already
   * had its Assessment accepted, and has asserted nothing about it since.
   */
  it("does not re-assert a field that was already saved successfully", () => {
    const a = makeDraft(draft({ assessment: "Viral fever", advice: "Rest" }), 1);

    // 1. Tab A edits Assessment and saves it.
    a.type("assessment", "Viral fever, likely dengue");
    const first = a.startSave()!;
    expect(first.patch).toEqual({ assessment: "Viral fever, likely dengue" });
    first.finish(ok(2));
    expect(a.dirtyKeys).toEqual([]);

    // 2. Tab B changes Assessment afterwards, and Advice is untouched there.
    const serverNow = draft({
      assessment: "Confirmed dengue — platelets 90k",
      advice: "Rest",
    });

    // 3. Tab A changes only Advice, and collides.
    a.type("advice", "Rest, fluids, review tomorrow");
    const second = a.startSave()!;
    expect(second.patch).toEqual({ advice: "Rest, fluids, review tomorrow" });
    second.finish(conflict(3, serverNow));
    expect(a.state.kind).toBe("conflict");

    // 4. Keep mine: Advice is mine, Assessment is NOT.
    expect(a.dirtyKeys).toEqual(["advice"]);
    a.keepMine(serverNow);

    expect(a.values.advice).toBe("Rest, fluids, review tomorrow");
    expect(a.values.assessment).toBe("Confirmed dengue — platelets 90k");

    // …and the next patch carries only Advice, so nothing else is overwritten.
    expect(buildPatch(a.values, a.baseline)).toEqual({
      advice: "Rest, fluids, review tomorrow",
    });
  });

  it("still keeps a field that is genuinely unsaved here", () => {
    const a = makeDraft(draft({ examination: "" }), 1);
    a.type("examination", "Chest clear");

    const serverNow = draft({ examination: "", advice: "From the phone" });
    const attempt = a.startSave()!;
    attempt.finish(conflict(2, serverNow));

    a.keepMine(serverNow);
    expect(a.values.examination).toBe("Chest clear");
    expect(a.values.advice).toBe("From the phone");
    expect(buildPatch(a.values, a.baseline)).toEqual({ examination: "Chest clear" });
  });

  it("takes the whole saved version when asked to", () => {
    const a = makeDraft(draft({ advice: "mine" }), 1);
    a.type("advice", "mine, edited");
    const serverNow = draft({ advice: "theirs" });

    a.startSave()!.finish(conflict(2, serverNow));
    a.takeTheirs(serverNow);

    expect(a.values.advice).toBe("theirs");
    expect(a.dirtyKeys).toEqual([]);
    expect(a.state.kind).toBe("clean");
  });
});

describe("typing while a save is in flight", () => {
  /**
   * The doctor does not stop writing because a request is open. Anything typed
   * after the request left was never sent, so the screen must not call it
   * saved — and the next save must carry it.
   */
  it("acknowledges only what was sent, and never reports Saved over newer text", async () => {
    const a = makeDraft(draft(), 1);

    // 1. Start saving field A.
    a.type("chiefComplaints", "Fever three days");
    const attempt = a.startSave()!;
    expect(attempt.patch).toEqual({ chiefComplaints: "Fever three days" });
    expect(a.state.kind).toBe("saving");

    // 2. Type into field B before the response returns.
    let resolve!: (r: SaveResult) => void;
    const response = new Promise<SaveResult>((r) => (resolve = r));
    a.type("examination", "Chest clear, no rash");

    // 3. Resolve the save.
    resolve(ok(2));
    attempt.finish(await response);

    // 4. Field A is acknowledged; field B is still unsaved.
    expect(a.baseline.chiefComplaints).toBe("Fever three days");
    expect(a.dirtyKeys).toEqual(["examination"]);
    expect(a.state.kind).toBe("dirty");
    expect(a.state.kind).not.toBe("saved");
    expect(a.version).toBe(2);

    // …and the next patch contains only the newer edit.
    const next = a.startSave()!;
    expect(next.patch).toEqual({ examination: "Chest clear, no rash" });
  });

  it("reports Saved when nothing newer was typed", () => {
    const a = makeDraft(draft(), 1);
    a.type("advice", "Rest and fluids");
    a.startSave()!.finish(ok(2));

    expect(a.state.kind).toBe("saved");
    expect(a.dirtyKeys).toEqual([]);
  });

  /** A conflict acknowledges nothing, so in-flight typing stays owned. */
  it("keeps in-flight typing owned when the save is rejected", () => {
    const a = makeDraft(draft(), 1);
    a.type("chiefComplaints", "Fever");
    const attempt = a.startSave()!;
    a.type("examination", "Chest clear");

    attempt.finish(conflict(5, draft({ advice: "elsewhere" })));

    expect(a.baseline.chiefComplaints).toBe("");
    expect(a.dirtyKeys.sort()).toEqual(["chiefComplaints", "examination"]);
  });
});

describe("beginSave", () => {
  it("refuses to send an empty patch", () => {
    const same = draft({ advice: "Rest" });
    expect(beginSave(same, same)).toBeNull();
  });

  it("snapshots exactly what it sends", () => {
    const baseline = draft();
    const values = draft({ advice: "Rest" });
    const attempt = beginSave(values, baseline)!;
    expect(attempt.sent).toEqual(values);
    expect(attempt.sent).not.toBe(values);
  });
});

describe("applySaveResult on a plain failure", () => {
  it("moves nothing and keeps every edit owned", () => {
    const baseline = draft({ advice: "Rest" });
    const current = draft({ advice: "Rest, fluids" });
    const applied = applySaveResult({
      sent: current,
      current,
      baseline,
      result: { ok: false, kind: "error", message: "The network is down." },
    });

    expect(applied.baseline).toBe(baseline);
    expect(applied.version).toBeUndefined();
    expect(applied.state).toEqual({ kind: "error", message: "The network is down." });
    expect(ownedKeys(current, applied.baseline)).toEqual(["advice"]);
  });
});
