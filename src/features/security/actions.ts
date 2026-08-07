"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import type { ActionState } from "@/features/auth/schema";
import { SHARED_DEVICE_COOKIE, isLastVerifiedFactor } from "./policy";

/**
 * MFA and device-security actions.
 *
 * Every one of these runs on the server against the user's own session. Two
 * rules throughout:
 *   1. TOTP secrets and codes are NEVER written to an audit event or a log.
 *   2. Supabase does not issue recovery codes for TOTP. The supported backup is
 *      a SECOND enrolled factor — do not invent a parallel recovery scheme.
 */

export interface EnrollResult extends ActionState {
  factorId?: string;
  qrCode?: string;
  secret?: string;
}

export interface Factor {
  id: string;
  friendlyName: string;
  status: string;
  createdAt: string | null;
}

export async function listFactorsAction(): Promise<Factor[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return [];

  return (data.all ?? [])
    .filter((f) => f.factor_type === "totp")
    .map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? "Authenticator",
      status: f.status,
      createdAt: f.created_at ?? null,
    }));
}

/**
 * Begin enrolment. Returns the QR code and the manual secret.
 *
 * Supabase returns the QR as an SVG data URI, so no QR library is needed. The
 * manual secret is the fallback for authenticator apps that cannot scan, and
 * for enrolling a backup on a second device.
 */
export async function startEnrollAction(
  _prev: EnrollResult,
  formData: FormData,
): Promise<EnrollResult> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const raw = formData.get("friendlyName");
  const friendlyName =
    typeof raw === "string" && raw.trim().length > 0
      ? raw.trim().slice(0, 40)
      : `Authenticator ${new Date().toISOString().slice(0, 10)}`;

  // Clear any half-finished enrolment so a retry cannot hit the factor limit.
  const existing = await listFactorsAction();
  for (const f of existing) {
    if (f.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });

  if (error || !data) {
    return { ok: false, message: error?.message ?? "Could not start setup." };
  }

  return {
    ok: true,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/** Verify the first code, which is what marks the factor as usable. */
export async function verifyEnrollAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");

  if (!factorId) return { ok: false, message: "Setup expired. Start again." };
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, fieldErrors: { code: ["Enter the 6-digit code"] } };
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code,
  });

  if (error) {
    // Never echo the submitted code back, in an error or an audit event.
    return { ok: false, fieldErrors: { code: ["That code is not valid. Try the next one."] } };
  }

  await emitAudit({
    action: "security.mfa_enrolled",
    resourceType: "auth.factor",
    resourceId: factorId,
    actorId: user.id,
  });

  revalidatePath("/settings/security");
  return { ok: true, message: "Two-step verification is on." };
}

export async function removeFactorAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const factorId = String(formData.get("factorId") ?? "");

  /**
   * Removing a factor must itself require the second factor. Otherwise anyone
   * with a stolen password-only session could strip MFA off the account, which
   * defeats the point of having it.
   */
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    return {
      ok: false,
      message:
        "Verify with your authenticator first, then you can remove a factor.",
    };
  }

  const factors = await listFactorsAction();
  const wasLast = isLastVerifiedFactor(factors, factorId);

  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { ok: false, message: error.message };

  await emitAudit({
    action: "security.mfa_removed",
    resourceType: "auth.factor",
    resourceId: factorId,
    actorId: user.id,
    meta: { wasLastVerifiedFactor: wasLast },
  });

  revalidatePath("/settings/security");
  return {
    ok: true,
    message: wasLast
      ? "Removed. Your account is now protected by password only."
      : "Backup authenticator removed.",
  };
}

/** Complete the login challenge for an already-enrolled factor. */
export async function challengeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createSupabaseServerClient();
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");

  if (!/^\d{6}$/.test(code)) {
    return { ok: false, fieldErrors: { code: ["Enter the 6-digit code"] } };
  }

  const { data: factorData } = await supabase.auth.mfa.listFactors();
  const factor = (factorData?.totp ?? []).find((f) => f.status === "verified");

  if (!factor) return { ok: false, message: "No authenticator is set up." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });

  if (error) {
    await emitAudit({
      action: "security.mfa_challenge_failed",
      resourceType: "auth.factor",
      resourceId: factor.id,
    });
    return { ok: false, fieldErrors: { code: ["That code is not valid."] } };
  }

  await emitAudit({
    action: "security.mfa_challenge_passed",
    resourceType: "auth.factor",
    resourceId: factor.id,
  });

  redirect("/dashboard");
}

/**
 * Sign-out scopes:
 *   local  — this browser only
 *   others — every other session, keeping this one (use after losing a device)
 *   global — everywhere, including here
 */
export async function signOutScopedAction(formData: FormData): Promise<void> {
  const scope = String(formData.get("scope") ?? "local");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const actorId = data.user?.id ?? null;

  const action =
    scope === "global"
      ? ("security.signed_out_everywhere" as const)
      : scope === "others"
        ? ("security.signed_out_other_devices" as const)
        : ("auth.signed_out" as const);

  await emitAudit({ action, resourceType: "auth.session", actorId });

  if (scope === "others") {
    await supabase.auth.signOut({ scope: "others" });
    revalidatePath("/settings/security");
    return;
  }

  await supabase.auth.signOut({ scope: scope === "global" ? "global" : "local" });

  const cookieStore = await cookies();
  cookieStore.delete(SHARED_DEVICE_COOKIE);
  redirect("/login");
}

/** Re-verify the password to lift the idle lock. Does not create a new session. */
export async function unlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user?.email) {
    return { ok: false, message: "Session expired. Sign in again." };
  }

  const password = String(formData.get("password") ?? "");
  if (!password) {
    return { ok: false, fieldErrors: { password: ["Enter your password"] } };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: data.user.email,
    password,
  });

  if (error) {
    await emitAudit({
      action: "security.unlock_failed",
      resourceType: "auth.session",
      actorId: data.user.id,
    });
    return { ok: false, fieldErrors: { password: ["Incorrect password"] } };
  }

  await emitAudit({
    action: "security.unlocked",
    resourceType: "auth.session",
    actorId: data.user.id,
  });

  return { ok: true };
}
