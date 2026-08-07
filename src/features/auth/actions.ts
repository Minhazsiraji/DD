"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { emitAudit } from "@/lib/audit/emit";
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type ActionState,
} from "./schema";

/**
 * Auth Server Actions.
 *
 * Two rules applied throughout:
 *   1. Validate on the server with Zod before touching Supabase.
 *   2. Never reveal whether an email address is registered. "Invalid email or
 *      password" and a always-succeeds password-reset response are deliberate —
 *      distinguishing them turns the login form into an account enumerator.
 */

function fieldErrors(error: z.ZodError): ActionState {
  return {
    ok: false,
    fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
  };
}

/** Only allow same-origin relative paths, so ?next= cannot become an open redirect. */
function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=/onboarding`,
    },
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  await emitAudit({
    action: "auth.signed_up",
    resourceType: "auth.user",
    resourceId: data.user?.id ?? null,
    actorId: data.user?.id ?? null,
  });

  // With email confirmation on, there is no session yet.
  if (!data.session) {
    return {
      ok: true,
      message:
        "Check your email to confirm your address, then sign in to continue.",
    };
  }

  redirect("/onboarding");
}

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    await emitAudit({
      action: "auth.sign_in_failed",
      resourceType: "auth.user",
      // Log that an attempt failed, never which address was tried.
      meta: { reason: error.message },
    });
    // Intentionally generic — see the enumeration note above.
    return { ok: false, message: "Invalid email or password." };
  }

  await emitAudit({
    action: "auth.signed_in",
    resourceType: "auth.user",
    resourceId: data.user.id,
    actorId: data.user.id,
  });

  redirect(safeNext(parsed.data.next));
}

export async function forgotPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`,
  });

  await emitAudit({
    action: "auth.password_reset_requested",
    resourceType: "auth.user",
  });

  // Always the same answer, whether or not the account exists.
  return {
    ok: true,
    message:
      "If an account exists for that address, a reset link is on its way.",
  };
}

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return {
      ok: false,
      message: "That reset link has expired. Request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { ok: false, message: error.message };

  await emitAudit({
    action: "auth.password_changed",
    resourceType: "auth.user",
    resourceId: userData.user.id,
    actorId: userData.user.id,
  });

  redirect("/dashboard");
}

export async function signOutAction(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (data.user) {
    await emitAudit({
      action: "auth.signed_out",
      resourceType: "auth.user",
      resourceId: data.user.id,
      actorId: data.user.id,
    });
  }

  await supabase.auth.signOut();
  redirect("/login");
}
