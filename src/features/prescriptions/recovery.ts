/**
 * What happened to a write, and what the screen must therefore do.
 *
 * Both halves live here, pure and separately tested, because Stage 6C proved
 * that this decision does not survive being spread across a server action and a
 * hook: Stage 7B re-collapsed two outcomes into one the moment the rule existed
 * only as branches in two files. A table can be read in one sitting; branches
 * cannot.
 *
 * Everything turns on one question — DID IT COMMIT? — and the two mistakes are
 * not symmetrical but are both serious:
 *
 *   saying "not saved" about a write that DID commit
 *       → the doctor enters the medicine again → the patient gets it twice
 *   saying "may have saved" about a write that certainly did NOT
 *       → the screen closes the form → the doctor's only copy is gone
 */

import { draftFromRow, emptyMedicine, rebaseDraft, type MedicineDraft, type MedicineRow } from "./schema";

export type RxOutcomeKind =
  | "ok"
  | "conflict"
  | "conflict-unloadable"
  | "write-confirmed-advanced"
  | "unconfirmed"
  /** The reviewed content moved before approval. Nothing was finalised. */
  | "review-stale"
  | "error";

export interface RecoveryPolicy {
  /** Did the write reach the record? The question everything else follows from. */
  committed: "yes" | "no" | "unknown";
  /** Close the submitted editor so the same medicine cannot be sent twice. */
  closesEditor: boolean;
  /** Drop a pending removal confirmation. */
  clearsPendingRemoval: boolean;
  /** Refuse further mutation until the doctor reloads. */
  blocks: boolean;
  /** Fresh rows came with the outcome and may be shown. */
  adoptsState: boolean;
  /**
   * Reloading is not enough — the doctor must LOOK at the content again.
   *
   * Only `review-stale` sets this. Every other outcome is settled by fetching
   * current state; this one means what they already read has changed, and a
   * silent refresh under an approval button would let them approve content
   * they never saw.
   */
  requiresFreshReview: boolean;
}

/**
 * The one table.
 *
 * `closesEditor` tracks `committed` exactly: a write that is on the record, or
 * might be, must not stay resubmittable; a write that certainly is not is the
 * doctor's only copy and must stay on screen. Any future kind has to answer
 * "did it commit?" first, and its row follows from that.
 */
export function recoveryPolicy(kind: RxOutcomeKind): RecoveryPolicy {
  switch (kind) {
    case "ok":
      return {
        committed: "yes",
        closesEditor: true,
        clearsPendingRemoval: true,
        blocks: false,
        adoptsState: true,
        requiresFreshReview: false,
      };

    /** Refused, and we can show what the record now holds. */
    case "conflict":
      return {
        committed: "no",
        closesEditor: false,
        clearsPendingRemoval: false,
        blocks: true,
        adoptsState: true,
        requiresFreshReview: false,
      };

    /**
     * Refused, and the record could not be read back. The refusal is no less
     * certain for that — a second failure tells us nothing new about the first.
     */
    case "conflict-unloadable":
      return {
        committed: "no",
        closesEditor: false,
        clearsPendingRemoval: false,
        blocks: true,
        adoptsState: false,
        requiresFreshReview: false,
      };

    /**
     * COMMITTED, and somebody else wrote immediately afterwards. The editor
     * closes not because anything failed but because the medicine is already on
     * the prescription.
     */
    case "write-confirmed-advanced":
      return {
        committed: "yes",
        closesEditor: true,
        clearsPendingRemoval: true,
        blocks: true,
        adoptsState: true,
        requiresFreshReview: false,
      };

    /**
     * The prescription was NOT finalised, and we know it — `finalize_prescription`
     * rebuilt the bundle, found a different digest and aborted before writing
     * anything. Distinct from a draft CAS conflict: nothing the doctor typed is
     * at stake, but what they READ is now out of date, so the fix is not "try
     * again" but "look at it again". Blocks until a fresh bundle is reviewed.
     */
    case "review-stale":
      return {
        committed: "no",
        closesEditor: false,
        clearsPendingRemoval: false,
        blocks: true,
        adoptsState: false,
        requiresFreshReview: true,
      };

    /** It may be on the record. Treated like "yes" for everything that matters. */
    case "unconfirmed":
      return {
        committed: "unknown",
        closesEditor: true,
        clearsPendingRemoval: true,
        blocks: true,
        adoptsState: false,
        requiresFreshReview: false,
      };

    /** An ordinary refusal the doctor can act on. Nothing to recover from. */
    case "error":
      return {
        committed: "no",
        closesEditor: false,
        clearsPendingRemoval: false,
        blocks: false,
        adoptsState: false,
        requiresFreshReview: false,
      };
  }
}

/**
 * What the doctor is holding on the screen that the record does not have.
 *
 * The open editor, the text in it, and any removal they have been asked to
 * confirm. This is the thing a bad recovery destroys, so it is modelled
 * explicitly rather than living as four pieces of component state.
 */
export interface HeldState {
  editor: { mode: "add" } | { mode: "edit"; row: MedicineRow } | null;
  draft: MedicineDraft;
  confirmingRemoval: MedicineRow | null;
}

/**
 * Settle what the doctor is holding against a freshly read list.
 *
 * Called after a refusal and after every reload. Each way the record can have
 * moved under an open editor is decided here rather than left for the next save
 * to discover:
 *
 *   the medicine is GONE      the typed text becomes a NEW medicine — an edit
 *                             to a row that no longer exists could only fail,
 *                             and discarding the text is what we are avoiding
 *   the medicine CHANGED      untouched fields adopt the record's values and
 *                             the baseline moves with them, so re-saving cannot
 *                             revert the other device's work
 *   a removal was PENDING     re-pointed at the current row, or dropped if
 *                             somebody else already removed it
 */
export function reconcileHeld(
  held: HeldState,
  fresh: MedicineRow[],
): { held: HeldState; notice: string | null } {
  let notice: string | null = null;
  const next: HeldState = { ...held };

  if (held.confirmingRemoval) {
    const current = fresh.find((r) => r.id === held.confirmingRemoval!.id) ?? null;
    next.confirmingRemoval = current;
    if (!current) {
      notice = `${held.confirmingRemoval.display_name} has already been removed from this prescription.`;
    }
  }

  if (held.editor?.mode === "edit") {
    const was = held.editor.row;
    const current = fresh.find((r) => r.id === was.id);
    if (!current) {
      next.editor = { mode: "add" };
      notice =
        `${was.display_name} was removed somewhere else. ` +
        "What you typed is still here — add it again if you still want it.";
    } else {
      next.draft = rebaseDraft(held.draft, draftFromRow(was), draftFromRow(current));
      next.editor = { mode: "edit", row: current };
    }
  }

  return { held: next, notice };
}

/**
 * Apply one outcome to what the doctor is holding.
 *
 * The single place where "did it commit?" turns into "is their text still on
 * the screen?". Both review blockers were failures of exactly this step, so it
 * is pure and driven from `recoveryPolicy` rather than re-decided inline.
 */
export function applyOutcome(input: {
  kind: RxOutcomeKind;
  held: HeldState;
  /** Rows that arrived with the outcome, or null when none could be read. */
  fresh: MedicineRow[] | null;
}): { held: HeldState; notice: string | null; blocks: boolean } {
  const policy = recoveryPolicy(input.kind);

  if (policy.closesEditor) {
    // On the record, or possibly on it. Either way it must not be sendable again.
    return {
      held: { editor: null, draft: emptyMedicine(), confirmingRemoval: null },
      notice: null,
      blocks: policy.blocks,
    };
  }

  // Certainly not on the record: every character stays exactly where it is.
  if (!policy.adoptsState || !input.fresh) {
    return { held: input.held, notice: null, blocks: policy.blocks };
  }

  const settled = reconcileHeld(input.held, input.fresh);
  return { held: settled.held, notice: settled.notice, blocks: policy.blocks };
}

/**
 * Classify one write from the three facts the server actually has.
 *
 * `currentVersion === null` means the read-back failed — NOT that the write
 * failed. Conflating those is Blocker 1; treating a version that has moved past
 * ours as a refusal is Blocker 2.
 */
export function classifyWrite(input: {
  /** The RPC raised a version conflict: the write was certainly rejected. */
  refused: boolean;
  /** The version this write earned, or null if the RPC's answer was unusable. */
  earnedVersion: number | null;
  /** What the record reports now, or null if it could not be read. */
  currentVersion: number | null;
}): RxOutcomeKind {
  const { refused, earnedVersion, currentVersion } = input;

  if (refused) {
    // Certainly rejected. Only our view of the record is in question.
    return currentVersion === null ? "conflict-unloadable" : "conflict";
  }

  // No version we can believe in means no answer to "did it commit?".
  if (earnedVersion === null) return "unconfirmed";

  // The write succeeded but we cannot see the result. Same honest answer.
  if (currentVersion === null) return "unconfirmed";

  /**
   * Our write committed AND somebody else has written since. Reporting this as
   * a refusal would tell the doctor their medicine was not saved while it sits
   * on the prescription.
   */
  if (currentVersion > earnedVersion) return "write-confirmed-advanced";

  /**
   * A version cannot go backwards: it rises by exactly one per accepted write.
   * If it has, our model of the record is wrong and the only honest answer to
   * "did it commit?" is that we do not know.
   */
  if (currentVersion < earnedVersion) return "unconfirmed";

  return "ok";
}
