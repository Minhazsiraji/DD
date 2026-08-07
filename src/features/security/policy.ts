/**
 * Account & device security policy.
 *
 * Pure functions, no I/O — so the rules that decide whether a screen locks or a
 * second factor is demanded can be tested exhaustively without a browser or a
 * database. Everything here is enforced again on the server; none of it is a
 * client-side-only control.
 */

/**
 * Supabase Authenticator Assurance Level — "aal1" | "aal2" in practice, but the
 * SDK types it open-endedly, so accept any string and compare to the literal.
 * An unknown value must never be treated as "already satisfied".
 */
export type AAL = string | null | undefined;

export const SHARED_DEVICE_COOKIE = "dd_shared_device";

/**
 * Idle limits before the app locks itself.
 *
 * Shared clinic and hospital computers get a deliberately short window: the
 * realistic threat is a doctor called away mid-consultation leaving records on
 * screen, not a remote attacker. Personal devices get a long window so the app
 * is not hostile to use all day in your own chamber.
 */
export const IDLE_LIMIT_SHARED_MS = 10 * 60 * 1000; // 10 minutes
export const IDLE_LIMIT_PERSONAL_MS = 8 * 60 * 60 * 1000; // 8 hours

/** Warn shortly before locking so work in progress can be saved. */
export const IDLE_WARNING_MS = 60 * 1000;

export function idleLimitMs(sharedDevice: boolean): number {
  return sharedDevice ? IDLE_LIMIT_SHARED_MS : IDLE_LIMIT_PERSONAL_MS;
}

/**
 * Should the screen be locked?
 *
 * Clock skew is treated conservatively: a lastActivity timestamp in the future
 * must never be read as "recently active", or a device with a wrong clock would
 * never lock.
 */
export function shouldLock(
  lastActivityAt: number,
  now: number,
  sharedDevice: boolean,
): boolean {
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return true;
  if (lastActivityAt > now) return true;
  return now - lastActivityAt >= idleLimitMs(sharedDevice);
}

/** True once the user is inside the warning window before the lock. */
export function shouldWarn(
  lastActivityAt: number,
  now: number,
  sharedDevice: boolean,
): boolean {
  if (shouldLock(lastActivityAt, now, sharedDevice)) return false;
  const remaining = idleLimitMs(sharedDevice) - (now - lastActivityAt);
  return remaining <= IDLE_WARNING_MS;
}

export function msUntilLock(
  lastActivityAt: number,
  now: number,
  sharedDevice: boolean,
): number {
  return Math.max(0, idleLimitMs(sharedDevice) - (now - lastActivityAt));
}

/**
 * Does this session still owe a second factor?
 *
 * Supabase reports nextLevel = "aal2" when the user has a VERIFIED factor. If
 * they are still at aal1, the challenge has not been completed and protected
 * routes must not render.
 */
export function requiresMfaChallenge(current: AAL, next: AAL): boolean {
  return next === "aal2" && current !== "aal2";
}

/** MFA is fully set up only when a factor exists AND has been verified. */
export function hasVerifiedFactor(
  factors: readonly { status: string }[],
): boolean {
  return factors.some((f) => f.status === "verified");
}

/**
 * A backup factor may only be added once the first one is verified — otherwise
 * a half-finished enrolment could be mistaken for a working backup.
 */
export function canAddBackupFactor(
  factors: readonly { status: string }[],
): boolean {
  const verified = factors.filter((f) => f.status === "verified").length;
  return verified >= 1 && verified < MAX_TOTP_FACTORS;
}

export const MAX_TOTP_FACTORS = 2;

/**
 * Removing the LAST verified factor silently downgrades the account back to a
 * password alone. Allowed, but the UI must say so plainly rather than treating
 * it as a routine delete.
 */
export function isLastVerifiedFactor(
  factors: readonly { id: string; status: string }[],
  factorId: string,
): boolean {
  const verified = factors.filter((f) => f.status === "verified");
  return verified.length === 1 && verified[0]?.id === factorId;
}

/** Never render a TOTP secret in full in a log or an error. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "••••";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
