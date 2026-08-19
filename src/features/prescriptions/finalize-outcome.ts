/**
 * What became of a finalisation — the irreversible write.
 *
 * The same discipline as every other clinical write in this app (Stage 6C,
 * Stage 7B): answer ONE question before anything else, and let everything the
 * screen does follow from the answer.
 *
 *     DID IT COMMIT?
 *
 * What makes finalisation different is not the question, it is the cost of
 * getting it wrong. A medicine entered twice can be removed from a draft. A
 * prescription finalised twice cannot be: the second one is a permanent
 * clinical record with the same content and a different id, and the patient may
 * be holding either. So the rule that mattered in 7B — never invite a retry of
 * something that may already have landed — is not a nicety here.
 *
 * The mistakes are asymmetric and both are real:
 *
 *   saying "it failed" about a write that COMMITTED
 *       → the doctor finalises again → two records of one prescription
 *   saying "it may have committed" about one that certainly did NOT
 *       → the doctor is stranded, afraid to touch a prescription that is
 *         simply still a draft
 */

export type FinalizeKind =
  /** Committed, and the record confirms it. */
  | "finalized"
  /** Definitely NOT committed: something printable moved since review. */
  | "review-stale"
  /** Definitely NOT committed: version or state refused it. */
  | "conflict-rejected"
  /** Somebody else got there first. Committed — just not by this request. */
  | "already-finalized"
  /** It may be on the record. The one outcome allowed to say "may". */
  | "finalization-unconfirmed"
  /** Definitely NOT committed, for a reason the doctor can act on. */
  | "error";

export interface FinalizePolicy {
  committed: "yes" | "no" | "unknown";
  /**
   * May the Finalize control be offered again from the state we are in?
   *
   * False whenever the write is on the record or might be — that is what stops
   * a second permanent prescription — and false after a refusal too, because a
   * refused finalisation means the reviewed content is out of date and the
   * doctor must read the new one before approving anything.
   */
  offersFinalize: boolean;
  /** The doctor must READ a fresh canonical bundle before approving again. */
  requiresFreshReview: boolean;
  /** Refuse further finalisation until an explicit re-read resolves it. */
  blocks: boolean;
  /** The prescription is now a permanent record; show it as one. */
  showsFinalized: boolean;
}

/**
 * The one table.
 *
 * `offersFinalize` is never true where `committed` is "yes" or "unknown". That
 * is the property the tests hold this file to, and it is the whole safety
 * argument in one line.
 */
export function finalizePolicy(kind: FinalizeKind): FinalizePolicy {
  switch (kind) {
    case "finalized":
      return {
        committed: "yes",
        offersFinalize: false,
        requiresFreshReview: false,
        blocks: false,
        showsFinalized: true,
      };

    /** Committed, by someone else. Identical consequences, different story. */
    case "already-finalized":
      return {
        committed: "yes",
        offersFinalize: false,
        requiresFreshReview: false,
        blocks: false,
        showsFinalized: true,
      };

    /**
     * Definitely not committed, and what the doctor read is out of date. A
     * silent refresh under the button would let them approve, in one click,
     * content they have never seen.
     */
    case "review-stale":
      return {
        committed: "no",
        offersFinalize: false,
        requiresFreshReview: true,
        blocks: true,
        showsFinalized: false,
      };

    /**
     * Definitely not committed: the version moved, or the prescription left
     * DRAFT under us. Also needs a fresh review — the refusal itself proves the
     * record is not what the approval described.
     */
    case "conflict-rejected":
      return {
        committed: "no",
        offersFinalize: false,
        requiresFreshReview: true,
        blocks: true,
        showsFinalized: false,
      };

    /**
     * It may be a permanent clinical record already. Everything here exists to
     * stop a second click: no control, no retry, blocked until an authoritative
     * status read says which world we are in.
     */
    case "finalization-unconfirmed":
      return {
        committed: "unknown",
        offersFinalize: false,
        requiresFreshReview: false,
        blocks: true,
        showsFinalized: false,
      };

    /**
     * An ordinary refusal — not authorised, not configured, not valid. Nothing
     * was written and nothing about the review changed, so the doctor can fix
     * the cause and approve the same bundle.
     */
    case "error":
      return {
        committed: "no",
        offersFinalize: true,
        requiresFreshReview: false,
        blocks: false,
        showsFinalized: false,
      };
  }
}

/**
 * What the RPC told us, before we know what it means.
 *
 * `refused` and `unknown` are the distinction this stage turns on. "I received
 * an error" is NOT "the database rejected the write": a request can commit in
 * Postgres and then lose its response to a dropped connection, a timeout or a
 * gateway. Treating that as a proven refusal would put the Finalize button back
 * in front of a doctor whose prescription is already signed.
 */
export type FinalizeRefusal =
  | "none"
  /** Our own function raised, so the whole transaction aborted. */
  | "review-stale"
  | "conflict"
  | "not-draft"
  /** Another refusal our function raised — certainly nothing was written. */
  | "refused"
  /** We cannot prove anything. The write may be on the record. */
  | "unknown";

/** The prescription's authoritative status, or null when it could not be read. */
export type AuthoritativeStatus = "FINALIZED" | "DRAFT" | "VOIDED" | null;

/**
 * Classify one finalisation from the three facts the server actually has.
 *
 * `status === null` means the READ failed — never that the write failed. That
 * distinction is the one this whole file exists for, and collapsing it is the
 * defect that has now appeared twice in this project.
 */
export function classifyFinalize(input: {
  refusal: FinalizeRefusal;
  /** The version the RPC returned, already validated, or null if unusable. */
  earnedVersion: number | null;
  status: AuthoritativeStatus;
}): FinalizeKind {
  const { refusal, earnedVersion, status } = input;

  /**
   * A refusal we can PROVE came from our own function. Every token it raises
   * aborts the transaction, so nothing was written and the doctor may fix the
   * cause and approve the same bundle.
   */
  if (refusal === "refused") return "error";

  /**
   * We could not prove the database refused it — so we must assume it might
   * have committed, and find out by reading rather than by asking the doctor
   * to click again.
   *
   * This is deliberately the SAME treatment as a success we cannot read back.
   * The two are indistinguishable from here, and the safe reading of both is
   * "it may be on the record".
   */
  if (refusal === "unknown") {
    if (status === "FINALIZED") return "finalized";
    // Still a draft: the write provably did not land, but what was reviewed is
    // no longer trustworthy, so a fresh review comes before another attempt.
    if (status === "DRAFT" || status === "VOIDED") return "conflict-rejected";
    return "finalization-unconfirmed";
  }

  /**
   * REVIEW_STALE is raised BEFORE anything is written — `finalize_prescription`
   * rebuilds the bundle, compares, and aborts. So it is certain, and it stays
   * certain even if we then fail to read the record.
   */
  if (refusal === "review-stale") return "review-stale";

  if (refusal === "conflict" || refusal === "not-draft") {
    /**
     * Refused. But "refused because it is already FINALIZED" is a completely
     * different message from "refused because the version moved": the first is
     * a success somebody else earned, and showing it as an error would invite
     * the doctor to try again for a prescription that already exists.
     */
    if (status === "FINALIZED") return "already-finalized";
    // DRAFT, VOIDED, or unreadable — the refusal is certain either way.
    return "conflict-rejected";
  }

  /**
   * The RPC did not refuse. From here on the write may well be on the record,
   * so every remaining branch has to be careful in the other direction.
   */

  // A version we cannot believe, after a call that may have committed.
  if (earnedVersion === null) return "finalization-unconfirmed";

  if (status === "FINALIZED") return "finalized";

  /**
   * The RPC reported success and the record says DRAFT. Those cannot both be
   * true, so we do not get to pick one — the honest answer is that we do not
   * know, and the doctor must not click again while we find out.
   */
  if (status === "DRAFT" || status === "VOIDED") return "finalization-unconfirmed";

  // Unreadable.
  return "finalization-unconfirmed";
}

/**
 * Every token our prescription functions raise.
 *
 * Each one aborts the transaction before or instead of the write, so seeing one
 * is positive evidence that nothing committed. Nothing else in the world
 * produces these strings — which is exactly why they, and not the mere presence
 * of an error, are the evidence.
 */
const REFUSAL_TOKENS = [
  "REVIEW_STALE",
  "PRESCRIPTION_VERSION_CONFLICT",
  "PRESCRIPTION_NOT_DRAFT",
  "PRESCRIPTION_EMPTY",
  "PRESCRIPTION_ITEM_INVALID",
  "PRESCRIPTION_REPLACEMENT_NEEDS_REASON",
  "TEMPLATE_NOT_AVAILABLE",
  "TEMPLATE_LOGO_UNSUPPORTED",
  "SIGNATURE_NOT_FROZEN",
  "POSITION_OUT_OF_RANGE",
  "PRESCRIPTION NOT FOUND",
  "ENCOUNTER NOT FOUND",
  "LOCATION NOT FOUND",
  "ONLY A DOCTOR CAN WRITE A PRESCRIPTION",
  "NOT A DOCTOR",
  "NOT AUTHENTICATED",
] as const;

/**
 * What the database said, if we can prove the database said anything.
 *
 * The default is NOT "error". For an irreversible write, an unrecognised
 * failure means UNKNOWN COMMIT STATE — a fetch that never returned, a timeout,
 * a reset connection or a gateway between us and a transaction that may well
 * have committed. Only a token we raise ourselves downgrades that to certainty.
 */
export function classifyRefusal(error: { message?: unknown; code?: unknown } | null): FinalizeRefusal {
  if (!error) return "none";

  const message = typeof error.message === "string" ? error.message.toUpperCase() : "";
  if (message === "") return "unknown";

  if (message.includes("REVIEW_STALE")) return "review-stale";
  if (message.includes("PRESCRIPTION_VERSION_CONFLICT")) return "conflict";
  if (message.includes("PRESCRIPTION_NOT_DRAFT")) return "not-draft";

  return REFUSAL_TOKENS.some((token) => message.includes(token)) ? "refused" : "unknown";
}

/**
 * What an authoritative status read means for a prescription we are unsure
 * about, or one whose finalisation was refused.
 *
 * Recovery never re-submits. It reads, and the read decides.
 */
export function resolveAfterRecovery(input: {
  wasCertainlyRejected: boolean;
  status: AuthoritativeStatus;
}): FinalizeKind {
  if (input.status === "FINALIZED") return "already-finalized";

  if (input.status === null) {
    /**
     * Still cannot read it. A KNOWN refusal must not decay into "may have
     * finalised" just because a later read also failed — nothing has happened
     * since to make its fate less certain.
     */
    return input.wasCertainlyRejected ? "conflict-rejected" : "finalization-unconfirmed";
  }

  /**
   * Still a draft: the finalisation did not land. The doctor may approve again,
   * but only after reading a fresh bundle — the one they approved is stale by
   * definition, or this would not have happened.
   */
  return "conflict-rejected";
}
