import { describe, it, expect } from "vitest";
import { applyOutcome, reconcileHeld, type HeldState } from "./recovery";
import { draftFromRow, emptyMedicine, type MedicineRow } from "./schema";

/**
 * The recovery outcomes as a doctor actually meets them.
 *
 * These drive the real `applyOutcome` — the same function the composer calls —
 * rather than a restatement of its rule, so collapsing two outcomes in the
 * source breaks these tests rather than leaving them passing against a mirror.
 *
 * The single question each scenario asks: after this went wrong, is the
 * doctor's typed medicine still on the screen, and can it be sent twice?
 */

function row(over: Partial<MedicineRow> = {}): MedicineRow {
  return {
    id: "item-1",
    display_name: "Tab. Napa 500 mg",
    brand_name: "Napa",
    generic_name: "Paracetamol",
    strength_text: "500 mg",
    dose_text: "1 tablet",
    dosage_form: "Tablet",
    route: "Oral",
    schedule_text: "1+0+1",
    duration_text: "7 days",
    quantity_text: null,
    food_relation: "After food",
    is_prn: false,
    instructions: "খাবারের পরে",
    substitution_allowed: true,
    position: 1,
    ...over,
  };
}

/** A doctor part-way through editing an existing medicine. */
function editing(target: MedicineRow, typed: Partial<Record<string, string>> = {}): HeldState {
  return {
    editor: { mode: "edit", row: target },
    draft: { ...draftFromRow(target), ...typed },
    confirmingRemoval: null,
  };
}

/** A doctor part-way through writing a new medicine. */
function adding(displayName: string, instructions = ""): HeldState {
  return {
    editor: { mode: "add" },
    draft: { ...emptyMedicine(), displayName, instructions },
    confirmingRemoval: null,
  };
}

// ---------------------------------------------------------------------------
// 1. Definitely rejected, and the record could not be read back.
// ---------------------------------------------------------------------------
describe("rejected + read-back failed (conflict-unloadable)", () => {
  it("preserves an UPDATE editor and every typed character", () => {
    const held = editing(row(), { doseText: "2 tablets", instructions: "অবশ্যই খাবারের পরে" });
    const after = applyOutcome({ kind: "conflict-unloadable", held, fresh: null });

    expect(after.held.editor).toEqual(held.editor);
    expect(after.held.draft.doseText).toBe("2 tablets");
    expect(after.held.draft.instructions).toBe("অবশ্যই খাবারের পরে");
    expect(after.blocks).toBe(true);
  });

  it("preserves the editor BASELINE, so a later save still sends only what changed", () => {
    const target = row();
    const held = editing(target, { doseText: "2 tablets" });
    const after = applyOutcome({ kind: "conflict-unloadable", held, fresh: null });

    // The baseline is the row the doctor last saw. Losing it would make the
    // next save either resend everything or nothing.
    expect(after.held.editor).toEqual({ mode: "edit", row: target });
  });

  it("preserves an ADD form with the medicine the doctor entered", () => {
    const held = adding("Cap. Omeprazole 20 mg", "খালি পেটে");
    const after = applyOutcome({ kind: "conflict-unloadable", held, fresh: null });

    expect(after.held.editor).toEqual({ mode: "add" });
    expect(after.held.draft.displayName).toBe("Cap. Omeprazole 20 mg");
    expect(after.held.draft.instructions).toBe("খালি পেটে");
  });

  it("preserves a pending removal, so the doctor is not asked from scratch", () => {
    const target = row();
    const held: HeldState = { editor: null, draft: emptyMedicine(), confirmingRemoval: target };
    const after = applyOutcome({ kind: "conflict-unloadable", held, fresh: null });

    expect(after.held.confirmingRemoval).toEqual(target);
    expect(after.blocks).toBe(true);
  });

  it("adopts nothing, because there was nothing to adopt", () => {
    const held = editing(row(), { doseText: "2 tablets" });
    const after = applyOutcome({ kind: "conflict-unloadable", held, fresh: null });
    expect(after.notice).toBeNull();
    expect(after.held).toEqual(held);
  });
});

describe("recovering from conflict-unloadable", () => {
  it("compares the preserved edit against the fresh record and permits a later save", () => {
    const target = row();
    const held = editing(target, { doseText: "2 tablets" });

    // The other device changed a field this doctor never touched.
    const fresh = [row({ schedule_text: "1+1+1", position: 1 })];
    const settled = reconcileHeld(held, fresh);

    // Their typed dose survives …
    expect(settled.held.draft.doseText).toBe("2 tablets");
    // … the untouched field adopts what the record now says …
    expect(settled.held.draft.scheduleText).toBe("1+1+1");
    // … and the baseline moves with it, so re-saving cannot revert it.
    expect(settled.held.editor).toEqual({ mode: "edit", row: fresh[0] });
  });

  it("turns an edit whose medicine has gone into an add, keeping the text", () => {
    const held = editing(row(), { doseText: "2 tablets" });
    const settled = reconcileHeld(held, [row({ id: "item-2", display_name: "Something else" })]);

    // An update to a row that no longer exists could only ever fail.
    expect(settled.held.editor).toEqual({ mode: "add" });
    expect(settled.held.draft.doseText).toBe("2 tablets");
    expect(settled.notice).toMatch(/removed somewhere else/i);
    expect(settled.notice).toMatch(/still here/i);
  });

  it("drops a pending removal for a medicine somebody else already removed", () => {
    const target = row();
    const held: HeldState = { editor: null, draft: emptyMedicine(), confirmingRemoval: target };
    const settled = reconcileHeld(held, []);

    expect(settled.held.confirmingRemoval).toBeNull();
    expect(settled.notice).toMatch(/already been removed/i);
  });

  it("re-points a pending removal at the current row when it is still there", () => {
    const target = row();
    const moved = row({ position: 3 });
    const held: HeldState = { editor: null, draft: emptyMedicine(), confirmingRemoval: target };
    const settled = reconcileHeld(held, [moved]);

    expect(settled.held.confirmingRemoval).toEqual(moved);
    expect(settled.notice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Genuinely unknown.
// ---------------------------------------------------------------------------
describe("unknown outcome (unconfirmed)", () => {
  it("closes an ADD form so the medicine cannot be entered twice", () => {
    const held = adding("Tab. Uncertain 5 mg");
    const after = applyOutcome({ kind: "unconfirmed", held, fresh: null });

    expect(after.held.editor).toBeNull();
    expect(after.held.draft.displayName).toBe("");
    expect(after.blocks).toBe(true);
  });

  it("clears a pending removal, which may already have happened", () => {
    const held: HeldState = { editor: null, draft: emptyMedicine(), confirmingRemoval: row() };
    expect(applyOutcome({ kind: "unconfirmed", held, fresh: null }).held.confirmingRemoval).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Definitely committed, then the record moved.
// ---------------------------------------------------------------------------
describe("committed then advanced (write-confirmed-advanced)", () => {
  it("closes the ADD form, because the medicine is already on the prescription", () => {
    const held = adding("Tab. Napa 500 mg");
    const committed = row({ id: "item-9", display_name: "Tab. Napa 500 mg" });
    const after = applyOutcome({ kind: "write-confirmed-advanced", held, fresh: [committed] });

    expect(after.held.editor).toBeNull();
    expect(after.held.draft.displayName).toBe("");
    expect(after.blocks).toBe(true);
  });

  it("cannot be resubmitted after resynchronising, so nothing is duplicated", () => {
    const held = adding("Tab. Napa 500 mg");
    const committed = row({ id: "item-9", display_name: "Tab. Napa 500 mg" });

    const after = applyOutcome({ kind: "write-confirmed-advanced", held, fresh: [committed] });
    // Recovery settles an empty hand against the record: still nothing to send.
    const recovered = reconcileHeld(after.held, [committed, row({ id: "item-10" })]);

    expect(recovered.held.editor).toBeNull();
    expect(recovered.held.draft.displayName).toBe("");
  });

  it("does not describe a committed UPDATE as rejected", () => {
    const held = editing(row(), { doseText: "2 tablets" });
    const after = applyOutcome({
      kind: "write-confirmed-advanced",
      held,
      fresh: [row({ dose_text: "2 tablets" })],
    });

    // The edit landed. Leaving the form open would invite it to be sent again.
    expect(after.held.editor).toBeNull();
  });

  it("clears the removal confirmation when the removal itself committed", () => {
    const held: HeldState = { editor: null, draft: emptyMedicine(), confirmingRemoval: row() };
    const after = applyOutcome({ kind: "write-confirmed-advanced", held, fresh: [] });

    // Otherwise the doctor is invited to remove a medicine that has already gone.
    expect(after.held.confirmingRemoval).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The ordinary refusal still behaves as it did.
// ---------------------------------------------------------------------------
describe("ordinary conflict, with the record readable", () => {
  it("keeps the form and settles it against the fresh rows", () => {
    const target = row();
    const held = editing(target, { instructions: "নতুন নির্দেশনা" });
    const fresh = [row({ position: 2 }), row({ id: "item-2", display_name: "Другое" })];

    const after = applyOutcome({ kind: "conflict", held, fresh });

    expect(after.held.editor).toEqual({ mode: "edit", row: fresh[0] });
    expect(after.held.draft.instructions).toBe("নতুন নির্দেশনা");
    expect(after.blocks).toBe(true);
  });
});

describe("a clean success", () => {
  it("closes the form and does not block", () => {
    const held = adding("Tab. Napa 500 mg");
    const after = applyOutcome({ kind: "ok", held, fresh: [row()] });

    expect(after.held.editor).toBeNull();
    expect(after.blocks).toBe(false);
  });
});

describe("an ordinary error", () => {
  it("leaves the doctor where they are, to fix it and try again", () => {
    const held = adding("");
    const after = applyOutcome({ kind: "error", held, fresh: null });

    expect(after.held).toEqual(held);
    expect(after.blocks).toBe(false);
  });
});
