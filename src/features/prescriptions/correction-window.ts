export const CORRECTION_UI_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Presentation-only correction eligibility for finalized prescription UI.
 *
 * This prevents the normal correction affordance from being offered on an old
 * historical prescription. It is NOT an authorization boundary: MD must enforce
 * the same policy in the authoritative server/database mutation path.
 */
export function isCorrectionUiWindowOpen(
  finalizedAt: string | null,
  now = new Date(),
): boolean {
  if (!finalizedAt) return false;
  const finalizedMs = Date.parse(finalizedAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(finalizedMs) || !Number.isFinite(nowMs)) return false;

  const elapsed = nowMs - finalizedMs;
  return elapsed >= 0 && elapsed <= CORRECTION_UI_WINDOW_MS;
}
