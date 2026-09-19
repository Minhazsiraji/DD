import "server-only";
import { createClient, type User } from "@supabase/supabase-js";
import { publicEnv, serviceRoleKey } from "@/lib/env";

/**
 * Narrow Staff Management privileged adapter.
 *
 * It never leaves the server and never exports the service-role client. The
 * only privileged capabilities exposed are exact-email identity lookup, a
 * Supabase Auth invitation, and the reviewed 0053 linking RPC. No caller gets
 * arbitrary `.from()` access.
 */
let cached: ReturnType<typeof createClient> | null = null;

function staffPrivilegedClient() {
  if (typeof window !== "undefined") {
    throw new Error("STAFF_SERVICE_SERVER_ONLY");
  }
  cached ??= createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Exact-email lookup. Pagination is bounded and fails closed instead of guessing. */
export async function serviceFindAuthUserByEmail(email: string): Promise<User | null> {
  const target = normalizedEmail(email);
  const client = staffPrivilegedClient();
  const perPage = 1000;
  const maxPages = 100;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error("STAFF_AUTH_LOOKUP_FAILED");
    const match = data.users.find((user) => normalizedEmail(user.email ?? "") === target);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }

  throw new Error("STAFF_AUTH_LOOKUP_LIMIT_EXCEEDED");
}

export async function serviceInviteStaffByEmail(input: {
  email: string;
  redirectTo?: string;
}): Promise<User> {
  const client = staffPrivilegedClient();
  const { data, error } = await client.auth.admin.inviteUserByEmail(normalizedEmail(input.email), {
    redirectTo: input.redirectTo,
  });
  if (error || !data.user) throw new Error("STAFF_AUTH_INVITE_FAILED");
  return data.user;
}

export async function serviceLinkStaffInvitation(input: {
  invitationId: string;
  staffUserId: string;
}): Promise<string> {
  const client = staffPrivilegedClient();
  const rpc = client.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  const { data, error } = await rpc("service_link_doctor_staff_invitation", {
    target_invitation_id: input.invitationId,
    target_staff_user_id: input.staffUserId,
  });
  if (error || typeof data !== "string") throw new Error("STAFF_LINK_FAILED");
  return data;
}
