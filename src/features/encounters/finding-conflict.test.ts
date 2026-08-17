import { describe, it, expect } from "vitest";
import {
  detectFindingConflict,
  editorAsNewFinding,
  editorKeepingMine,
  editorTakingTheirs,
  notesConflicted,
} from "./finding-conflict";
import { draftFromRow, editorIsDirty, emptyFinding, type FindingEditor, type FindingRow } from "./finding-types";
import { acceptVersion } from "./list-schema";
import { emptyDraft, type DraftValues } from "./schema";

const row = (over: Partial<FindingRow> = {}): FindingRow => ({
  id: "row-1",
  title: "Dengue fever",
  note: "Platelets falling",
  position: 1,
  certainty: "PROVISIONAL",
  ...over,
});

const editing = (base: FindingRow, draft = draftFromRow(base)): FindingEditor => ({
  list: "diagnosis",
  mode: "edit",
  rowId: base.id,
  base,
  draft,
});

describe("a finding conflict names its own subject", () => {
  /**
   * The defect this exists to prevent: the row a doctor is editing changes
   * remotely, the notes panel opens instead, and after answering an unrelated
   * question their stale finding can be submitted over the newer one.
   */
  it("detects a remote UPDATE of the diagnosis being edited", () => {
    const base = row();
    const editor = editing(base, { ...draftFromRow(base), title: "Dengue fever, severe" });
    const theirs = row({ title: "Dengue haemorrhagic fever", certainty: "CONFIRMED" });

    const conflict = detectFindingConflict(editor, [theirs]);
    expect(conflict?.kind).toBe("changed");
    if (conflict?.kind !== "changed") throw new Error("unreachable");

    // Both versions are carried, so the doctor can be shown a comparison.
    expect(conflict.mine.title).toBe("Dengue fever, severe");
    expect(conflict.theirs.title).toBe("Dengue haemorrhagic fever");
    expect(conflict.base.title).toBe("Dengue fever");
  });

  it("detects a remote UPDATE of the investigation being edited", () => {
    const base = row({ id: "inv-1", title: "CBC", certainty: undefined });
    const editor: FindingEditor = {
      ...editing(base, { ...draftFromRow(base), note: "Fasting" }),
      list: "investigation",
    };
    const theirs = row({ id: "inv-1", title: "CBC with platelet count", certainty: undefined });

    const conflict = detectFindingConflict(editor, [theirs]);
    expect(conflict?.kind).toBe("changed");
    expect(conflict?.list).toBe("investigation");
  });

  it("detects a remote REMOVAL of the diagnosis being edited", () => {
    const base = row();
    const editor = editing(base, { ...draftFromRow(base), title: "Dengue fever, severe" });

    const conflict = detectFindingConflict(editor, [row({ id: "other" })]);
    expect(conflict?.kind).toBe("removed");
    // The typed text must survive the row that carried it.
    if (conflict?.kind !== "removed") throw new Error("unreachable");
    expect(conflict.mine.title).toBe("Dengue fever, severe");
  });

  it("detects a remote REMOVAL of the investigation being edited", () => {
    const base = row({ id: "inv-9", title: "NS1", certainty: undefined });
    const editor: FindingEditor = { ...editing(base), list: "investigation" };

    const conflict = detectFindingConflict(editor, []);
    expect(conflict?.kind).toBe("removed");
    expect(conflict?.list).toBe("investigation");
  });

  it("flags an ADD form holding text when something unrelated moved", () => {
    const editor: FindingEditor = {
      list: "diagnosis",
      mode: "add",
      rowId: null,
      base: null,
      draft: { ...emptyFinding(), title: "Dehydration" },
    };
    expect(detectFindingConflict(editor, [])?.kind).toBe("interrupted");
  });

  it("says nothing about an empty add form", () => {
    const editor: FindingEditor = {
      list: "diagnosis", mode: "add", rowId: null, base: null, draft: emptyFinding(),
    };
    expect(detectFindingConflict(editor, [])).toBeNull();
  });

  it("says nothing when the edited row did not actually change", () => {
    const base = row();
    const editor = editing(base, { ...draftFromRow(base), title: "Locally edited" });
    // Same row, unchanged remotely — the conflict came from somewhere else.
    expect(detectFindingConflict(editor, [row()])).toBeNull();
  });

  /**
   * A finding that only shifted up because something above it was removed has
   * not changed clinically. Asking about it would train doctors to dismiss
   * conflict dialogs without reading them.
   */
  it("ignores a position shift", () => {
    const base = row({ position: 3 });
    expect(detectFindingConflict(editing(base), [row({ position: 1 })])).toBeNull();
  });

  it("says nothing when no editor is open", () => {
    expect(detectFindingConflict(null, [row()])).toBeNull();
  });
});

describe("notesConflicted", () => {
  const values = (over: Partial<DraftValues> = {}): DraftValues => ({ ...emptyDraft(), ...over });

  /** No empty comparison table when only a finding moved. */
  it("is false when the notes agree", () => {
    const mine = values({ examination: "Chest clear" });
    expect(notesConflicted(mine, values({ examination: "Chest clear" }))).toBe(false);
  });

  it("is true when they genuinely differ", () => {
    expect(
      notesConflicted(values({ examination: "Chest clear" }), values({ examination: "Crackles" })),
    ).toBe(true);
  });
});

describe("resolving a finding conflict keeps the text reachable", () => {
  it("taking theirs replaces the draft and clears the staleness", () => {
    const base = row();
    const editor = editing(base, { ...draftFromRow(base), title: "Mine" });
    const theirs = row({ title: "Theirs", certainty: "CONFIRMED" });

    const next = editorTakingTheirs(editor, theirs);
    expect(next.draft.title).toBe("Theirs");
    expect(next.base).toBe(theirs);
    expect(detectFindingConflict(next, [theirs])).toBeNull();
    expect(editorIsDirty(next)).toBe(false);
  });

  it("keeping mine preserves the draft and rebases so it may be submitted", () => {
    const base = row();
    const editor = editing(base, { ...draftFromRow(base), title: "Mine" });
    const theirs = row({ title: "Theirs" });

    const next = editorKeepingMine(editor, theirs);
    expect(next.draft.title).toBe("Mine");
    expect(next.base).toBe(theirs);
    // No longer stale, so the submission is a deliberate overwrite the doctor
    // chose after seeing both — not last-write-wins.
    expect(detectFindingConflict(next, [theirs])).toBeNull();
    expect(editorIsDirty(next)).toBe(true);
  });

  /**
   * The stranded-editor bug: the row vanishes, the editor keeps pointing at a
   * dead id, no form renders, Add stays hidden, and the typed text is
   * unreachable and uncancellable.
   */
  it("a removed row becomes an add rather than a dangling reference", () => {
    const base = row();
    const editor = editing(base, { ...draftFromRow(base), title: "Still wanted" });

    const next = editorAsNewFinding(editor);
    expect(next.mode).toBe("add");
    expect(next.rowId).toBeNull();
    expect(next.base).toBeNull();
    expect(next.draft.title).toBe("Still wanted");
    // Renderable again: an add form always renders, whatever the rows contain.
    expect(detectFindingConflict(next, [])?.kind).toBe("interrupted");
  });
});

describe("acceptVersion", () => {
  /**
   * `Number(data) || expected + 1` turned every one of these into an apparent
   * success, and the guessed number was then sent as the next expected version.
   */
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a word", "not-a-number"],
    ["an object", { version: 5 }],
    ["zero", 0],
    ["a negative", -1],
    ["a fraction", 5.5],
  ])("refuses %s", (_label, data) => {
    expect(acceptVersion(data, 4)).toBeNull();
  });

  it("refuses a version that jumped further than the contract allows", () => {
    expect(acceptVersion(7, 4)).toBeNull();
    expect(acceptVersion(4, 4)).toBeNull();
  });

  it("accepts exactly expectedVersion + 1", () => {
    expect(acceptVersion(5, 4)).toBe(5);
    expect(acceptVersion("5", 4)).toBe(5);
  });
});
