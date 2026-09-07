import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * PLATFORM OWNER AUTHORITY — resolved on the server, by the database.
 *
 * Owner identity is still decided only by `is_platform_owner()`. PRE-LAUNCH-
 * SEC-01B adds a second, independent requirement for owner routes: the current
 * authenticated session must be AAL2. Database owner decision RPCs enforce the
 * same AAL2 condition independently in 0045.
 */
export const isPlatformOwner = cache(async function isPlatformOwner(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("is_platform_owner");

  if (error) return false;
  return data === true;
});

/**
 * Owner route boundary.
 *
 * Owner identity is checked BEFORE MFA routing so a non-owner probing /owner
 * still receives notFound() rather than learning that the surface exists.
 * A real owner at AAL1 is then sent to the Auth-only enrollment/challenge flow.
 */
export async function requirePlatformOwner(): Promise<void> {
  const owner = await isPlatformOwner();
  if (!owner) {
    const { notFound } = await import("next/navigation");
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    const { redirect } = await import("next/navigation");
    redirect(aal?.nextLevel === "aal2" ? "/mfa" : "/mfa/enroll");
  }
}
