import { describe, it, expect } from "vitest";
import {
  detectFindingConflict,
  detectRemovalConflict,
  notesConflicted,
} from "./finding-conflict";
import type { FindingRow, ListKind } from "./finding-types";
import { emptyDraft, type DraftValues } from "./schema";
import { changedKeys } from "./draft-patch";

const row = (over: Partial<FindingRow> = {}): FindingRow => ({
  id: "d1",
  title: "Dengue fever",
  note: null,
  position: 1,
  certainty: "PROVISIONAL",
  ...over,
});

const pending = (list: ListKind, r: FindingRow) => ({ list, row: r });

/**
 * A pending removal has no open editor, so it produced no conflict subject at
 * all — and a stored conflict with zero subjects renders no panel while still
 * blocking every mutation. The doctor was left reading "settle the change
 * above" with nothing above to settle, and no way out of the consultation.
 */
describe("a refused removal is a conflict subject", () => {
  it("target unchanged, encounter moved: the removal simply did not happen", () => {
    const c = detectRemovalConflict(pending("diagnosis", row()), [row()]);
    expect(c?.kind).toBe("removal-stale");
    expect(c?.list).toBe("diagnosis");
  });

  it("target changed before the delete: the doctor must look again", () => {
    const c = detectRemovalConflict(pending("diagnosis", row()), [
      row({ title: "Dengue haemorrhagic fever", certainty: "CONFIRMED" }),
    ]);
    expect(c?.kind).toBe("removal-changed");
    if (c?.kind !== "removal-changed") throw new Error("unreachable");
    expect(c.base.title).toBe("Dengue fever");
    expect(c.theirs.title).toBe("Dengue haemorrhagic fever");
  });

  it("target already gone: nothing left to delete", () => {
    const c = detectRemovalConflict(pending("diagnosis", row()), [row({ id: "other" })]);
    expect(c?.kind).toBe("removal-gone");
  });

  it("the same three cases for an investigation", () => {
    const base = row({ id: "i1", title: "CBC", certainty: undefined });
    expect(detectRemovalConflict(pending("investigation", base), [base])?.kind).toBe(
      "removal-stale",
    );
    expect(
      detectRemovalConflict(pending("investigation", base), [
        row({ id: "i1", title: "CBC with platelets", certainty: undefined }),
      ])?.kind,
    ).toBe("removal-changed");
    expect(detectRemovalConflict(pending("investigation", base), [])?.kind).toBe("removal-gone");
  });

  it("says nothing when no removal is pending", () => {
    expect(detectRemovalConflict(null, [row()])).toBeNull();
  });

  /** A row that only shifted position has not changed clinically. */
  it("ignores a position shift", () => {
    const c = detectRemovalConflict(pending("diagnosis", row({ position: 3 })), [
      row({ position: 1 }),
    ]);
    expect(c?.kind).toBe("removal-stale");
  });
});

/**
 * The invariant behind the blocker: a conflict must never be STORED with
 * nothing to resolve. This mirrors the coordinator's decision, which is why it
 * is asserted over the same inputs the coordinator uses.
 */
describe("no conflict may be stored with zero subjects", () => {
  const values = (over: Partial<DraftValues> = {}): DraftValues => ({ ...emptyDraft(), ...over });

  function subjects(args: {
    editor: Parameters<typeof detectFindingConflict>[0];
    pendingRemoval: { list: ListKind; row: FindingRow } | null;
    rows: FindingRow[];
    mine: DraftValues;
    theirs: DraftValues;
  }) {
    const findings = [
      detectFindingConflict(args.editor, args.rows),
      detectRemovalConflict(args.pendingRemoval, args.rows),
    ].filter(Boolean);
    return { findings, notes: notesConflicted(args.mine, args.theirs) };
  }

  it("the exact reproduction now produces a subject", () => {
    // Confirmation open, encounter advanced by an unrelated change.
    const found = subjects({
      editor: null,
      pendingRemoval: pending("diagnosis", row()),
      rows: [row()],
      mine: values(),
      theirs: values(),
    });
    expect(found.notes).toBe(false);
    expect(found.findings).toHaveLength(1);
    expect(found.findings[0]?.kind).toBe("removal-stale");
  });

  it("with nothing open and matching notes there is nothing to resolve", () => {
    const found = subjects({
      editor: null,
      pendingRemoval: null,
      rows: [row()],
      mine: values({ advice: "Rest" }),
      theirs: values({ advice: "Rest" }),
    });
    // The coordinator must adopt the refreshed state and show a notice, NOT
    // store a conflict — a conflict here is the unresolvable screen.
    expect(found.notes).toBe(false);
    expect(found.findings).toHaveLength(0);
  });

  it("a removal and a notes disagreement are two separate decisions", () => {
    const found = subjects({
      editor: null,
      pendingRemoval: pending("diagnosis", row()),
      rows: [row({ title: "Changed" })],
      mine: values({ advice: "Mine" }),
      theirs: values({ advice: "Theirs" }),
    });
    expect(found.notes).toBe(true);
    expect(found.findings).toHaveLength(1);
    expect(found.findings[0]?.kind).toBe("removal-changed");
  });

  /** An open editor AND a pending removal both count. */
  it("collects an editor subject and a removal subject together", () => {
    const base = row({ id: "d2", title: "Anaemia" });
    const found = subjects({
      editor: {
        list: "diagnosis",
        mode: "edit",
        rowId: "d2",
        base,
        draft: { title: "Iron deficiency", note: "", certainty: "WORKING" },
      },
      pendingRemoval: pending("investigation", row({ id: "i1", certainty: undefined })),
      rows: [row({ id: "d2", title: "Anaemia, severe" })],
      mine: values(),
      theirs: values(),
    });
    expect(found.findings.map((f) => f?.kind).sort()).toEqual(["changed", "removal-gone"]);
  });
});

/**
 * A finding-only conflict must not invent a notes state.
 *
 * Setting the notes to "dirty" on the way past left the save bar announcing
 * "0 unsaved changes" — a state that cannot exist, reported on a clinical
 * screen whose entire job is telling the truth about what is stored.
 */
describe("a finding-only conflict leaves the notes alone", () => {
  const values = (over: Partial<DraftValues> = {}): DraftValues => ({ ...emptyDraft(), ...over });

  // Mirrors the coordinator's `deriveNotesState`.
  const derive = (mine: DraftValues, baseline: DraftValues) =>
    notesConflicted(mine, baseline) ? "dirty" : "clean";

  it("clean notes stay clean", () => {
    const saved = values({ advice: "Rest" });
    expect(derive(saved, saved)).toBe("clean");
  });

  it("dirty notes stay dirty, with the real count", () => {
    const baseline = values({ advice: "Rest" });
    const mine = values({ advice: "Rest, fluids", examination: "Chest clear" });
    expect(derive(mine, baseline)).toBe("dirty");
    expect(changedKeys(mine, baseline).sort()).toEqual(["advice", "examination"]);
  });

  /** The impossible state the bug produced. */
  it("never reports dirty with nothing changed", () => {
    const saved = values({ advice: "Rest" });
    const state = derive(saved, saved);
    const count = changedKeys(saved, saved).length;
    expect(state === "dirty" && count === 0).toBe(false);
  });
});
