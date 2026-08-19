import { describe, it, expect } from "vitest";
import {
  classifyFinalize,
  finalizePolicy,
  resolveAfterRecovery,
  type FinalizeKind,
} from "./finalize-outcome";
import {
  GENERIC_RX_ERROR,
  RX_FINALIZE_ALREADY_MESSAGE,
  RX_FINALIZE_REJECTED_MESSAGE,
  RX_FINALIZE_STALE_MESSAGE,
  RX_FINALIZE_UNCONFIRMED_MESSAGE,
} from "./errors";

/**
 * The irreversible write.
 *
 * A medicine entered twice can be removed from a draft. A prescription
 * finalised twice cannot be — the second is a permanent clinical record with
 * the same content and a different id, and the patient may be holding either.
 * So every assertion here is ultimately about one thing: after this outcome,
 * can the doctor click Finalize again?
 */

const KINDS: FinalizeKind[] = [
  "finalized",
  "already-finalized",
  "review-stale",
  "conflict-rejected",
  "finalization-unconfirmed",
  "error",
];

/** Mirrors `finalizeMessage` in actions.ts, which is a "use server" module. */
const MESSAGE: Record<FinalizeKind, string> = {
  finalized: "This prescription is approved and is now part of the patient's record.",
  "already-finalized": RX_FINALIZE_ALREADY_MESSAGE,
  "review-stale": RX_FINALIZE_STALE_MESSAGE,
  "conflict-rejected": RX_FINALIZE_REJECTED_MESSAGE,
  "finalization-unconfirmed": RX_FINALIZE_UNCONFIRMED_MESSAGE,
  error: GENERIC_RX_ERROR,
};

describe("classifyFinalize — did it commit?", () => {
  it("a clean success with a confirmed FINALIZED record is finalized", () => {
    expect(classifyFinalize({ refusal: "none", earnedVersion: 8, status: "FINALIZED" })).toBe(
      "finalized",
    );
  });

  it("REVIEW_STALE is certain, and stays certain when the record cannot be read", () => {
    // It is raised BEFORE anything is written, so a failed read afterwards
    // tells us nothing new.
    expect(classifyFinalize({ refusal: "review-stale", earnedVersion: null, status: null })).toBe(
      "review-stale",
    );
    expect(
      classifyFinalize({ refusal: "review-stale", earnedVersion: null, status: "DRAFT" }),
    ).toBe("review-stale");
  });

  it("a version conflict whose record is FINALIZED is somebody else's success", () => {
    // Showing this as an error would invite approving a prescription that
    // already exists.
    expect(classifyFinalize({ refusal: "conflict", earnedVersion: null, status: "FINALIZED" })).toBe(
      "already-finalized",
    );
    expect(
      classifyFinalize({ refusal: "not-draft", earnedVersion: null, status: "FINALIZED" }),
    ).toBe("already-finalized");
  });

  it("a version conflict whose record is still DRAFT is a plain rejection", () => {
    expect(classifyFinalize({ refusal: "conflict", earnedVersion: null, status: "DRAFT" })).toBe(
      "conflict-rejected",
    );
  });

  /** The defect this project has now seen twice, in its most costly form. */
  it("a rejected finalisation whose read fails is NOT unconfirmed", () => {
    const kind = classifyFinalize({ refusal: "conflict", earnedVersion: null, status: null });
    expect(kind).toBe("conflict-rejected");
    expect(kind).not.toBe("finalization-unconfirmed");
    expect(finalizePolicy(kind).committed).toBe("no");
  });

  it("a success we cannot read back is unconfirmed", () => {
    expect(classifyFinalize({ refusal: "none", earnedVersion: 8, status: null })).toBe(
      "finalization-unconfirmed",
    );
  });

  it("a success with an unusable version is unconfirmed, never ok", () => {
    // The call may well have committed; we simply cannot prove it.
    expect(classifyFinalize({ refusal: "none", earnedVersion: null, status: "FINALIZED" })).toBe(
      "finalization-unconfirmed",
    );
  });

  it("a success whose record still says DRAFT is unconfirmed", () => {
    // Both cannot be true. We do not get to pick the convenient one.
    expect(classifyFinalize({ refusal: "none", earnedVersion: 8, status: "DRAFT" })).toBe(
      "finalization-unconfirmed",
    );
  });

  it("an ordinary refusal is its own outcome", () => {
    expect(classifyFinalize({ refusal: "error", earnedVersion: null, status: "DRAFT" })).toBe(
      "error",
    );
  });
});

describe("finalizePolicy — can they click Finalize again?", () => {
  /** The whole safety argument, in one assertion. */
  it("never offers Finalize when the write is on the record or might be", () => {
    for (const kind of KINDS) {
      const p = finalizePolicy(kind);
      if (p.committed !== "no") {
        expect({ kind, offers: p.offersFinalize }).toEqual({ kind, offers: false });
      }
    }
  });

  it("does not offer it after a refusal either, until the doctor re-reads", () => {
    // A refusal proves the record is not what the approval described.
    for (const kind of ["review-stale", "conflict-rejected"] as const) {
      const p = finalizePolicy(kind);
      expect(p.offersFinalize).toBe(false);
      expect(p.requiresFreshReview).toBe(true);
      expect(p.blocks).toBe(true);
    }
  });

  it("offers it again only for an ordinary, actionable refusal", () => {
    const p = finalizePolicy("error");
    expect(p.offersFinalize).toBe(true);
    expect(p.requiresFreshReview).toBe(false);
    expect(p.blocks).toBe(false);
  });

  it("shows a finalized record exactly when one exists", () => {
    for (const kind of KINDS) {
      const p = finalizePolicy(kind);
      expect({ kind, shows: p.showsFinalized }).toEqual({ kind, shows: p.committed === "yes" });
    }
  });

  it("blocks on every uncertain or refused outcome", () => {
    expect(finalizePolicy("finalization-unconfirmed").blocks).toBe(true);
    expect(finalizePolicy("review-stale").blocks).toBe(true);
    expect(finalizePolicy("conflict-rejected").blocks).toBe(true);
  });
});

describe("resolveAfterRecovery — the read decides, never a resubmit", () => {
  it("a FINALIZED record resolves an uncertain approval to success", () => {
    expect(
      resolveAfterRecovery({ wasCertainlyRejected: false, status: "FINALIZED" }),
    ).toBe("already-finalized");
  });

  it("a DRAFT record means it did not land, and a fresh review is required", () => {
    const kind = resolveAfterRecovery({ wasCertainlyRejected: false, status: "DRAFT" });
    expect(kind).toBe("conflict-rejected");
    expect(finalizePolicy(kind).requiresFreshReview).toBe(true);
    expect(finalizePolicy(kind).offersFinalize).toBe(false);
  });

  it("an unreadable record keeps an uncertain approval uncertain", () => {
    expect(resolveAfterRecovery({ wasCertainlyRejected: false, status: null })).toBe(
      "finalization-unconfirmed",
    );
  });

  it("…and keeps a CERTAIN rejection certain", () => {
    // Nothing has happened since to make its fate less knowable.
    const kind = resolveAfterRecovery({ wasCertainlyRejected: true, status: null });
    expect(kind).toBe("conflict-rejected");
    expect(finalizePolicy(kind).committed).toBe("no");
  });
});

/**
 * Each outcome must be LOAD-BEARING: collapsing it into a neighbour has to
 * break something. These are the assertions that break.
 */
describe("each outcome is load-bearing", () => {
  it("collapsing review-stale into error would offer Finalize on stale content", () => {
    expect(finalizePolicy("review-stale").offersFinalize).toBe(false);
    expect(finalizePolicy("error").offersFinalize).toBe(true);
  });

  it("collapsing rejected into unconfirmed would lose a known certainty", () => {
    expect(finalizePolicy("conflict-rejected").committed).toBe("no");
    expect(finalizePolicy("finalization-unconfirmed").committed).toBe("unknown");
  });

  it("collapsing unconfirmed into error would invite a second permanent record", () => {
    expect(finalizePolicy("finalization-unconfirmed").offersFinalize).toBe(false);
    expect(finalizePolicy("finalization-unconfirmed").blocks).toBe(true);
    expect(finalizePolicy("error").offersFinalize).toBe(true);
  });

  it("collapsing already-finalized into rejected would hide a real record", () => {
    expect(finalizePolicy("already-finalized").showsFinalized).toBe(true);
    expect(finalizePolicy("conflict-rejected").showsFinalized).toBe(false);
  });

  /**
   * Some outcomes SHOULD share a policy.
   *
   * `finalized` and `already-finalized` have identical consequences — there is
   * a permanent record either way. So do `review-stale` and
   * `conflict-rejected` — nothing was written and the doctor must read the new
   * bundle either way. Forcing their behaviour apart would be inventing a
   * difference that does not exist.
   *
   * What must never coincide is the SENTENCE. Two outcomes that behave the same
   * but happened for different reasons still owe the doctor different words, or
   * they cannot tell what went on.
   */
  it("outcomes that behave alike still explain themselves differently", () => {
    const byPolicy = new Map<string, FinalizeKind[]>();
    for (const kind of KINDS) {
      const key = JSON.stringify(finalizePolicy(kind));
      byPolicy.set(key, [...(byPolicy.get(key) ?? []), kind]);
    }

    const sharing = [...byPolicy.values()].filter((group) => group.length > 1);
    expect(sharing).toEqual([
      ["finalized", "already-finalized"],
      ["review-stale", "conflict-rejected"],
    ]);

    for (const group of sharing) {
      const messages = group.map((k) => MESSAGE[k]);
      expect(new Set(messages).size, `${group.join(" and ")} share a sentence`).toBe(group.length);
    }
  });

  it("…and no outcome shares BOTH its behaviour and its words", () => {
    const seen = new Set<string>();
    for (const kind of KINDS) {
      const key = `${JSON.stringify(finalizePolicy(kind))}::${MESSAGE[kind]}`;
      expect(seen.has(key), `${kind} is indistinguishable from an earlier kind`).toBe(false);
      seen.add(key);
    }
  });
});

describe("the copy", () => {
  it("keeps 'may' for the one outcome that genuinely does not know", () => {
    expect(RX_FINALIZE_UNCONFIRMED_MESSAGE).toMatch(/may already have gone through/i);
    for (const message of [
      RX_FINALIZE_STALE_MESSAGE,
      RX_FINALIZE_REJECTED_MESSAGE,
      RX_FINALIZE_ALREADY_MESSAGE,
    ]) {
      expect(message).not.toMatch(/\bmay already\b/i);
    }
  });

  it("says plainly that a refused approval added nothing to the record", () => {
    expect(RX_FINALIZE_STALE_MESSAGE).toMatch(/NOT approved/);
    expect(RX_FINALIZE_STALE_MESSAGE).toMatch(/nothing has been added/i);
    expect(RX_FINALIZE_REJECTED_MESSAGE).toMatch(/NOT approved/);
    expect(RX_FINALIZE_REJECTED_MESSAGE).toMatch(/nothing has been added/i);
  });

  it("tells the doctor why not to approve again while we check", () => {
    // The consequence is the point: vagueness here is what produces a
    // second click.
    expect(RX_FINALIZE_UNCONFIRMED_MESSAGE).toMatch(/do not approve it again/i);
    expect(RX_FINALIZE_UNCONFIRMED_MESSAGE).toMatch(/two prescriptions/i);
  });

  it("reassures rather than alarms when somebody else already approved it", () => {
    expect(RX_FINALIZE_ALREADY_MESSAGE).toMatch(/already been approved/i);
    expect(RX_FINALIZE_ALREADY_MESSAGE).toMatch(/not been approved twice/i);
    expect(RX_FINALIZE_ALREADY_MESSAGE).not.toMatch(/error|failed/i);
  });

  it("gives all four recovery outcomes different words", () => {
    const messages = [
      RX_FINALIZE_STALE_MESSAGE,
      RX_FINALIZE_REJECTED_MESSAGE,
      RX_FINALIZE_ALREADY_MESSAGE,
      RX_FINALIZE_UNCONFIRMED_MESSAGE,
    ];
    expect(new Set(messages).size).toBe(4);
  });
});
