/**
 * Which visits OPEN the previous-visit card rather than merely offering it.
 *
 * A report review and a follow-up are visits ABOUT the last one — the doctor is
 * there to compare, so making them look for the context is the whole gap this
 * closes. A new complaint is not, and reading it through the lens of an old
 * visit is its own kind of error; the card is there, collapsed, one press away.
 *
 * Pure and kept apart from the query it serves, which is `server-only`.
 */
export function opensPreviousVisit(visitType: string | null): boolean {
  return visitType === "REPORT_REVIEW" || visitType === "FOLLOW_UP";
}
