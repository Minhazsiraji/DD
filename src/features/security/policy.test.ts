import { describe, it, expect } from "vitest";
import {
  shouldLock,
  shouldWarn,
  msUntilLock,
  idleLimitMs,
  requiresMfaChallenge,
  hasVerifiedFactor,
  canAddBackupFactor,
  isLastVerifiedFactor,
  maskSecret,
  IDLE_LIMIT_SHARED_MS,
  IDLE_LIMIT_PERSONAL_MS,
  MAX_TOTP_FACTORS,
} from "./policy";

const NOW = 1_800_000_000_000;

describe("idle lock", () => {
  it("locks a shared device after 10 minutes", () => {
    expect(shouldLock(NOW - IDLE_LIMIT_SHARED_MS + 1000, NOW, true)).toBe(false);
    expect(shouldLock(NOW - IDLE_LIMIT_SHARED_MS, NOW, true)).toBe(true);
  });

  it("gives a personal device a much longer window", () => {
    expect(shouldLock(NOW - IDLE_LIMIT_SHARED_MS, NOW, false)).toBe(false);
    expect(shouldLock(NOW - IDLE_LIMIT_PERSONAL_MS, NOW, false)).toBe(true);
    expect(idleLimitMs(false)).toBeGreaterThan(idleLimitMs(true));
  });

  it("locks rather than trusts a timestamp from the future", () => {
    // A wrong device clock must never read as "recently active".
    expect(shouldLock(NOW + 60_000, NOW, true)).toBe(true);
    expect(shouldLock(NOW + 60_000, NOW, false)).toBe(true);
  });

  it("locks on non-finite input rather than staying open", () => {
    expect(shouldLock(NaN, NOW, true)).toBe(true);
    expect(shouldLock(NOW, NaN, false)).toBe(true);
    expect(shouldLock(Infinity, NOW, true)).toBe(true);
  });

  it("warns shortly before locking, and not after", () => {
    const almost = NOW - IDLE_LIMIT_SHARED_MS + 30_000;
    expect(shouldWarn(almost, NOW, true)).toBe(true);
    expect(shouldLock(almost, NOW, true)).toBe(false);

    // Once locked, it is no longer merely a warning.
    expect(shouldWarn(NOW - IDLE_LIMIT_SHARED_MS, NOW, true)).toBe(false);
    // Fresh activity is neither warned nor locked.
    expect(shouldWarn(NOW - 1000, NOW, true)).toBe(false);
  });

  it("counts down and never goes negative", () => {
    expect(msUntilLock(NOW, NOW, true)).toBe(IDLE_LIMIT_SHARED_MS);
    expect(msUntilLock(NOW - IDLE_LIMIT_SHARED_MS * 2, NOW, true)).toBe(0);
  });
});

describe("MFA challenge gating", () => {
  it("demands a challenge when a verified factor exists but was not used", () => {
    expect(requiresMfaChallenge("aal1", "aal2")).toBe(true);
  });

  it("does not demand one once satisfied", () => {
    expect(requiresMfaChallenge("aal2", "aal2")).toBe(false);
  });

  it("does not demand one when the user has no verified factor", () => {
    expect(requiresMfaChallenge("aal1", "aal1")).toBe(false);
    expect(requiresMfaChallenge(null, null)).toBe(false);
  });
});

describe("factor management", () => {
  const verified = (id: string) => ({ id, status: "verified" });
  const unverified = (id: string) => ({ id, status: "unverified" });

  it("treats an unverified enrolment as no MFA at all", () => {
    expect(hasVerifiedFactor([unverified("a")])).toBe(false);
    expect(hasVerifiedFactor([])).toBe(false);
    expect(hasVerifiedFactor([verified("a")])).toBe(true);
  });

  it("allows a backup only after the first factor is verified", () => {
    expect(canAddBackupFactor([])).toBe(false);
    expect(canAddBackupFactor([unverified("a")])).toBe(false);
    expect(canAddBackupFactor([verified("a")])).toBe(true);
  });

  it("stops at the maximum number of factors", () => {
    const all = Array.from({ length: MAX_TOTP_FACTORS }, (_, i) =>
      verified(`f${i}`),
    );
    expect(canAddBackupFactor(all)).toBe(false);
  });

  it("identifies the last verified factor so removal can be warned about", () => {
    expect(isLastVerifiedFactor([verified("a")], "a")).toBe(true);
    expect(isLastVerifiedFactor([verified("a"), verified("b")], "a")).toBe(false);
    // An unverified sibling does not make "a" safe to remove quietly.
    expect(isLastVerifiedFactor([verified("a"), unverified("b")], "a")).toBe(true);
  });
});

describe("secret masking", () => {
  it("never returns the full secret", () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DP";
    const masked = maskSecret(secret);
    expect(masked).not.toBe(secret);
    expect(masked).not.toContain("EHPK3PXP");
    expect(masked.length).toBeLessThan(secret.length);
  });

  it("does not leak short secrets by partial disclosure", () => {
    expect(maskSecret("SHORT")).toBe("••••");
  });
});
