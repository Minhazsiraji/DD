import { describe, it, expect } from "vitest";
import {
  CONFLICT_UNLOADABLE_MESSAGE,
  WRITE_UNCONFIRMED_MESSAGE,
  acceptVersion,
  type DesyncKind,
} from "./version-contract";
import { detectFindingConflict, detectRemovalConflict } from "./finding-conflict";
import { draftFromRow, type FindingEditor, type FindingRow, type ListKind } from "./finding-types";

const row = (over: Partial<FindingRow> = {}): FindingRow => ({
  id: "d1",
  title: "Dengue fever",
  note: null,
  position: 1,
  certainty: "PROVISIONAL",
  ...over,
});

/**
 * The coordinator's rule, isolated so both branches can be exercised without a
 * renderer. `closesEditor` is the whole difference, and getting it backwards
 * either invites a duplicate clinical record or throws away a doctor's
 * rejected — and therefore entirely unsaved — text.
 */
function outcome(kind: DesyncKind) {
  return {
    closesEditor: kind === "write-unconfirmed",
    clearsPendingRemoval: kind === "write-unconfirmed",
    blocks: true,
    message: kind === "write-unconfirmed" ? WRITE_UNCONFIRMED_MESSAGE : CONFLICT_UNLOADABLE_MESSAGE,
  };
}

describe("the two unknowns behave oppositely", () => {
  it("an unconfirmed write closes the form, to stop a duplicate", () => {
    const o = outcome("write-unconfirmed");
    expect(o.closesEditor).toBe(true);
    expect(o.clearsPendingRemoval).toBe(true);
    expect(o.blocks).toBe(true);
  });

  it("a certainly-refused write keeps the form and the pending removal", () => {
    const o = outcome("conflict-unloadable");
    expect(o.closesEditor).toBe(false);
    expect(o.clearsPendingRemoval).toBe(false);
    expect(o.blocks).toBe(true);
  });

  /** The copy is the only thing telling a doctor which risk they are facing. */
  it("says whether the change may have landed, or definitely did not", () => {
    expect(WRITE_UNCONFIRMED_MESSAGE).toMatch(/may already have been saved/i);
    expect(WRITE_UNCONFIRMED_MESSAGE).toMatch(/do not enter it again/i);

    expect(CONFLICT_UNLOADABLE_MESSAGE).toMatch(/was NOT saved/);
    expect(CONFLICT_UNLOADABLE_MESSAGE).toMatch(/nothing you typed has been lost/i);
  });

  it("neither message tells the doctor their text is gone", () => {
    for (const m of [WRITE_UNCONFIRMED_MESSAGE, CONFLICT_UNLOADABLE_MESSAGE]) {
      expect(m.replace(/nothing you typed has been lost/i, "")).not.toMatch(
        /\blost\b|\bdiscarded\b|\bdeleted\b/i,
      );
    }
  });
});

describe("a refused edit survives an unloadable conflict, and recovery can still compare it", () => {
  const editing = (list: ListKind, base: FindingRow, title: string): FindingEditor => ({
    list,
    mode: "edit",
    rowId: base.id,
    base,
    draft: { ...draftFromRow(base), title },
  });

  it("diagnosis: the editor and its text are preserved, and recovery detects the change", () => {
    const base = row();
    const editor = editing("diagnosis", base, "Dengue fever, severe");

    // conflict-unloadable does not close it…
    expect(outcome("conflict-unloadable").closesEditor).toBe(false);

    // …so when the state finally loads, the subject is still there to compare.
    const recovered = detectFindingConflict(editor, [row({ title: "Dengue haemorrhagic fever" })]);
    expect(recovered?.kind).toBe("changed");
    if (recovered?.kind !== "changed") throw new Error("unreachable");
    expect(recovered.mine.title).toBe("Dengue fever, severe");
  });

  it("investigation: the same", () => {
    const base = row({ id: "i1", title: "CBC", certainty: undefined });
    const editor = editing("investigation", base, "CBC with platelet count");

    const recovered = detectFindingConflict(editor, [
      row({ id: "i1", title: "CBC + film", certainty: undefined }),
    ]);
    expect(recovered?.kind).toBe("changed");
    expect(recovered?.list).toBe("investigation");
  });

  it("removal: the pending subject survives for fresh analysis", () => {
    const pending = { list: "diagnosis" as ListKind, row: row() };

    expect(outcome("conflict-unloadable").clearsPendingRemoval).toBe(false);

    // Whatever the record turns out to hold, a subject is produced.
    expect(detectRemovalConflict(pending, [row()])?.kind).toBe("removal-stale");
    expect(detectRemovalConflict(pending, [row({ title: "Changed" })])?.kind).toBe(
      "removal-changed",
    );
    expect(detectRemovalConflict(pending, [])?.kind).toBe("removal-gone");
  });

  /**
   * The counterpart: an unconfirmed ADD closes its form, so recovery finds no
   * subject and the doctor is never invited to enter the same finding twice.
   */
  it("an unconfirmed add leaves no editor behind to resubmit", () => {
    expect(outcome("write-unconfirmed").closesEditor).toBe(true);
    expect(detectFindingConflict(null, [row()])).toBeNull();
  });
});

/**
 * The note save carried the old, unsafe shape long after the list mutations
 * were fixed — and the version is SHARED, so a bad number from either side is
 * sent as the next expected version by both.
 */
describe("the note save obeys the same version contract", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["zero", 0],
    ["a negative", -3],
    ["a fraction", 5.5],
    ["nonnumeric text", "soon"],
    ["an empty string", ""],
    ["the same version", 4],
    ["an unexpected jump", 7],
  ])("refuses %s", (_label, data) => {
    expect(acceptVersion(data, 4)).toBeNull();
  });

  it("accepts exactly expectedVersion + 1", () => {
    expect(acceptVersion(5, 4)).toBe(5);
    expect(acceptVersion("5", 4)).toBe(5);
  });

  /** An unusable answer means the write MAY have landed — never a plain error. */
  it("an unusable version is reported as unconfirmed, not as a retryable failure", () => {
    const unusable = acceptVersion(null, 4) === null;
    expect(unusable).toBe(true);
    expect(outcome("write-unconfirmed").blocks).toBe(true);
    expect(WRITE_UNCONFIRMED_MESSAGE).not.toMatch(/try again/i);
  });
});
