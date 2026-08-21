import { RX_UNCONFIRMED_MESSAGE } from "./errors";
import type { RxResult } from "./actions";

/**
 * NO CLINICAL WRITE MAY SPIN FOREVER.
 *
 * The pilot reported a medicine that sat on "Saving…" for over five minutes and
 * never resolved. A spinner with no end is the worst answer a clinical write
 * can give: the doctor cannot tell whether the medicine is on the prescription,
 * so they either wait on a screen that will never change, or re-enter it and
 * risk prescribing it twice.
 *
 * So the wait is BOUNDED HERE, in the client, rather than trusted to be short.
 * Whatever the cause — a locked row, a cold serverless function, a stalled
 * connection, a request that will never come back — the screen reaches a
 * settled state.
 *
 * WHY THE ANSWER IS "unconfirmed" AND NOT "failed"
 *
 * When the deadline fires we genuinely DO NOT KNOW whether the write committed;
 * the request may still be in flight and may still land. `unconfirmed` is
 * exactly that statement, and its row in the recovery table already does the
 * safe thing: close the editor so the same medicine cannot be sent twice, block
 * further mutation, and tell the doctor to reload rather than re-enter.
 *
 * Calling it a failure would be a lie in the dangerous direction — "not saved"
 * about a write that did commit is how a patient gets a medicine twice.
 *
 * AND WE NEVER RETRY.
 *
 * Retrying an unknown commit state is how one dose becomes two. The deadline
 * abandons the WAIT, never the write.
 */

/**
 * Long enough that a slow-but-working save still reports its real outcome, short
 * enough that a doctor is not left guessing. Measured against production: a
 * cold save took 17.5s and a warm one 8s, so a smaller budget would convert
 * ordinary slowness into false uncertainty — which has its own cost, because
 * `unconfirmed` blocks the composer until the page is reloaded.
 */
export const RX_WRITE_DEADLINE_MS = 45_000;

/**
 * Resolve with the action's own answer, or with `unconfirmed` when the deadline
 * passes first. Never rejects, never retries, never cancels the request.
 */
export async function withWriteDeadline(
  work: Promise<RxResult>,
  deadlineMs: number = RX_WRITE_DEADLINE_MS,
): Promise<RxResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<RxResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, kind: "unconfirmed", message: RX_UNCONFIRMED_MESSAGE }),
      deadlineMs,
    );
  });

  try {
    /**
     * A rejected action is also an answer the screen must survive. An
     * unhandled rejection here would leave `busy` true forever — the same
     * frozen spinner by another route.
     */
    return await Promise.race([
      work.catch(() => ({
        ok: false as const,
        kind: "unconfirmed" as const,
        message: RX_UNCONFIRMED_MESSAGE,
      })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
