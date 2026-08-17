import { describe, it, expect } from "vitest";
import { classifyWrite, recoveryPolicy, type RxOutcomeKind } from "./recovery";
import {
  RX_ADVANCED_MESSAGE,
  RX_CONFLICT_UNLOADABLE_MESSAGE,
  RX_UNCONFIRMED_MESSAGE,
  translateRxError,
} from "./errors";

/**
 * The recovery contract.
 *
 * Two defects were found in review, and both were the same shape: an outcome
 * that had merged into a neighbouring one because the rule lived as branches in
 * two files rather than as a table anybody could read.
 *
 *   Blocker 1  refused + read-back failed  was reported as "may have saved",
 *              so the screen closed the form and destroyed the doctor's only
 *              copy of a change the database had already told us it rejected.
 *
 *   Blocker 2  committed + somebody else wrote next  was reported as a refusal,
 *              so an ADD form stayed resubmittable and the same medicine could
 *              go onto one prescription twice.
 *
 * These tests exist to make either regression impossible to land quietly.
 */

const KINDS: RxOutcomeKind[] = [
  "ok",
  "conflict",
  "conflict-unloadable",
  "write-confirmed-advanced",
  "unconfirmed",
  "error",
];

describe("classifyWrite — did it commit?", () => {
  it("a refusal with the record readable is an ordinary conflict", () => {
    expect(classifyWrite({ refused: true, earnedVersion: null, currentVersion: 7 })).toBe(
      "conflict",
    );
  });

  /** Blocker 1. */
  it("a refusal whose read-back fails is NOT unconfirmed", () => {
    const kind = classifyWrite({ refused: true, earnedVersion: null, currentVersion: null });
    expect(kind).toBe("conflict-unloadable");
    expect(kind).not.toBe("unconfirmed");
  });

  it("a second failure tells us nothing new about the first refusal", () => {
    // The database already said it rejected the write. Failing to read the
    // record afterwards cannot make that any less certain.
    expect(recoveryPolicy(classifyWrite({ refused: true, earnedVersion: 5, currentVersion: null })).committed).toBe("no");
  });

  it("a clean success is ok", () => {
    expect(classifyWrite({ refused: false, earnedVersion: 6, currentVersion: 6 })).toBe("ok");
  });

  /** Blocker 2. */
  it("a success the record has moved past is committed, not refused", () => {
    // v5 → our add commits as v6 → another device writes v7 → we read v7.
    const kind = classifyWrite({ refused: false, earnedVersion: 6, currentVersion: 7 });
    expect(kind).toBe("write-confirmed-advanced");
    expect(kind).not.toBe("conflict");
    expect(recoveryPolicy(kind).committed).toBe("yes");
  });

  it("a success we cannot read back is unconfirmed", () => {
    expect(classifyWrite({ refused: false, earnedVersion: 6, currentVersion: null })).toBe(
      "unconfirmed",
    );
  });

  it("an unusable version from the RPC is unconfirmed", () => {
    expect(classifyWrite({ refused: false, earnedVersion: null, currentVersion: 6 })).toBe(
      "unconfirmed",
    );
  });

  it("a version that went backwards is unconfirmed, never ok", () => {
    // Impossible under CAS. Whatever it means, we cannot claim to know.
    const kind = classifyWrite({ refused: false, earnedVersion: 9, currentVersion: 4 });
    expect(kind).toBe("unconfirmed");
    expect(recoveryPolicy(kind).committed).toBe("unknown");
  });
});

describe("recoveryPolicy — the editor follows the commit", () => {
  it("closes the editor on exactly the outcomes where the write may be on the record", () => {
    for (const kind of KINDS) {
      const p = recoveryPolicy(kind);
      expect({ kind, closes: p.closesEditor }).toEqual({
        kind,
        closes: p.committed !== "no",
      });
    }
  });

  it("keeps a pending removal exactly when the editor is kept", () => {
    for (const kind of KINDS) {
      const p = recoveryPolicy(kind);
      expect(p.clearsPendingRemoval).toBe(p.closesEditor);
    }
  });

  it("never adopts state it was not given", () => {
    // These two arrive with no rows attached, so nothing may be adopted.
    expect(recoveryPolicy("conflict-unloadable").adoptsState).toBe(false);
    expect(recoveryPolicy("unconfirmed").adoptsState).toBe(false);
  });

  it("blocks further writing on every outcome that is not clean", () => {
    for (const kind of KINDS) {
      if (kind === "ok" || kind === "error") continue;
      expect(recoveryPolicy(kind).blocks).toBe(true);
    }
  });

  it("lets an ordinary refusal be corrected and retried in place", () => {
    const p = recoveryPolicy("error");
    expect(p.blocks).toBe(false);
    expect(p.closesEditor).toBe(false);
  });
});

/**
 * The reviewer's requirement, stated as tests: each recovery outcome must be
 * LOAD-BEARING. Collapsing any one into its neighbour has to break something —
 * these are the assertions that break.
 */
describe("each outcome is load-bearing", () => {
  it("collapsing conflict-unloadable into unconfirmed would lose typed text", () => {
    const refused = recoveryPolicy("conflict-unloadable");
    const unknown = recoveryPolicy("unconfirmed");
    expect(refused.closesEditor).toBe(false);
    expect(unknown.closesEditor).toBe(true);
    expect(refused.closesEditor).not.toBe(unknown.closesEditor);
  });

  it("collapsing write-confirmed-advanced into conflict would invite a duplicate", () => {
    const committed = recoveryPolicy("write-confirmed-advanced");
    const refusedKind = recoveryPolicy("conflict");
    expect(committed.closesEditor).toBe(true);
    expect(refusedKind.closesEditor).toBe(false);
    expect(committed.committed).toBe("yes");
    expect(refusedKind.committed).toBe("no");
  });

  it("collapsing write-confirmed-advanced into ok would hide that the record moved", () => {
    expect(recoveryPolicy("write-confirmed-advanced").blocks).toBe(true);
    expect(recoveryPolicy("ok").blocks).toBe(false);
  });

  it("every kind is distinguishable from every other by its policy or its copy", () => {
    const seen = new Map<string, RxOutcomeKind>();
    for (const kind of KINDS) {
      const key = JSON.stringify(recoveryPolicy(kind));
      const clash = seen.get(key);
      // `ok` and `write-confirmed-advanced` differ only by `blocks`; `conflict`
      // and `conflict-unloadable` only by `adoptsState`. Any further merging
      // means an outcome has stopped doing work.
      expect(clash, `${kind} is indistinguishable from ${clash}`).toBeUndefined();
      seen.set(key, kind);
    }
  });
});

describe("the copy for each outcome", () => {
  it("never says a definitely-refused change may have been saved", () => {
    expect(RX_CONFLICT_UNLOADABLE_MESSAGE).toMatch(/was NOT saved/);
    expect(RX_CONFLICT_UNLOADABLE_MESSAGE).not.toMatch(/may (already )?have been saved/i);
    expect(RX_CONFLICT_UNLOADABLE_MESSAGE).toMatch(/still here/i);
  });

  it("never says a definitely-committed change was unsaved", () => {
    expect(RX_ADVANCED_MESSAGE).toMatch(/WAS saved/);
    expect(RX_ADVANCED_MESSAGE).not.toMatch(/not saved|was not|failed/i);
    // The one instruction that stops a duplicate.
    expect(RX_ADVANCED_MESSAGE).toMatch(/do not enter your change again/i);
  });

  it("keeps 'may' for the one outcome that genuinely does not know", () => {
    expect(RX_UNCONFIRMED_MESSAGE).toMatch(/may already have been saved/i);
    expect(RX_ADVANCED_MESSAGE).not.toMatch(/\bmay already have been saved\b/i);
    expect(RX_CONFLICT_UNLOADABLE_MESSAGE).not.toMatch(/\bmay already have been saved\b/i);
  });

  it("gives all four recovery outcomes different words", () => {
    const messages = [
      translateRxError("PRESCRIPTION_VERSION_CONFLICT").message,
      RX_CONFLICT_UNLOADABLE_MESSAGE,
      RX_ADVANCED_MESSAGE,
      RX_UNCONFIRMED_MESSAGE,
    ];
    expect(new Set(messages).size).toBe(4);
  });
});
