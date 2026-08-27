import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * PLATFORM OWNER AUTHORITY — resolved on the server, by the database.
 *
 * The answer comes from `is_platform_owner()`, a SECURITY DEFINER function that
 * reads `auth.uid()` and nothing else. No user id crosses this boundary in
 * either direction, so there is no value a caller could tamper with: not a
 * cookie, not a prop, not a profile field they can edit.
 *
 * This is authority to run the PLATFORM. It confers no clinical access, here or
 * in the database — see `supabase/policies/0033_platform_owner_authority.sql`.
 */
export const isPlatformOwner = cache(async function isPlatformOwner(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("is_platform_owner");

  /**
   * FAIL CLOSED. A failed check is not permission — if the call errors, or
   * returns anything other than a literal `true`, the caller is not an owner.
   * `!!data` would be enough today; the strict comparison keeps it correct if
   * the RPC ever returns a row or an object instead of a bare boolean.
   */
  if (error) return false;
  return data === true;
});

/**
 * The route boundary.
 *
 * NOT FOUND, NOT FORBIDDEN. A 403 confirms the surface exists, which tells an
 * unauthorised prober exactly where to keep knocking. To anyone who is not an
 * owner — signed out or signed in — `/owner` simply is not a page.
 *
 * Callers must `await` this before rendering anything: it throws Next's
 * not-found signal, so it can only protect what runs after it.
 */
export async function requirePlatformOwner(): Promise<void> {
  const owner = await isPlatformOwner();
  if (!owner) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
}
