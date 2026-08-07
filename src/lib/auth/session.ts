import "server-only";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, type Action, type ClinicRole, type Resource } from "@/lib/rbac/permissions";
import { forbidden, noActiveClinic, unauthenticated } from "@/lib/errors";

export const ACTIVE_CLINIC_COOKIE = "dd_active_clinic";

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface Membership {
  clinicId: string;
  clinicName: string;
  role: ClinicRole;
}

export interface ClinicContext {
  user: SessionUser;
  clinicId: string;
  clinicName: string;
  role: ClinicRole;
  memberships: Membership[];
}

/**
 * Resolve the signed-in user, or throw.
 *
 * Always uses `getUser()`, never `getSession()` — getSession reads the cookie
 * without verifying it against the auth server, so it can be forged. getUser
 * revalidates the JWT.
 */
export async function requireUser(): Promise<SessionUser> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw unauthenticated(error?.message);
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Null instead of throwing — for layouts that render differently when signed out. */
export async function getUser(): Promise<SessionUser | null> {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}

/** Every ACTIVE clinic membership for the current user. */
export async function getMemberships(): Promise<Membership[]> {
  const supabase = await createSupabaseServerClient();

  // RLS restricts this to the caller's own rows.
  const { data, error } = await supabase
    .from("clinic_members")
    .select("clinic_id, role, clinics(name)")
    .eq("status", "ACTIVE");

  if (error || !data) return [];

  return data.flatMap((row) => {
    const rel = row.clinics as unknown;
    const name =
      Array.isArray(rel) ? (rel[0] as { name?: string })?.name
      : (rel as { name?: string } | null)?.name;
    if (!name) return [];
    return [
      {
        clinicId: row.clinic_id as string,
        clinicName: name,
        role: row.role as ClinicRole,
      },
    ];
  });
}

/**
 * The authorization context every Server Action must start from.
 *
 * Establishes BOTH halves of the check:
 *   1. who the user is (verified JWT)
 *   2. which clinic they are acting in, and their role there
 *
 * The active clinic comes from a cookie but is never trusted — it is only
 * honoured if the user actually holds an active membership for it.
 */
export async function requireClinicContext(): Promise<ClinicContext> {
  const user = await requireUser();
  const memberships = await getMemberships();

  if (memberships.length === 0) {
    throw noActiveClinic("user has no active clinic membership");
  }

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_CLINIC_COOKIE)?.value;

  const active =
    memberships.find((m) => m.clinicId === requested) ?? memberships[0]!;

  return {
    user,
    clinicId: active.clinicId,
    clinicName: active.clinicName,
    role: active.role,
    memberships,
  };
}

/**
 * Role check on top of clinic context. Both are required:
 * the role says *what* you may do, the clinic context says *where*.
 */
export async function requirePermission(
  action: Action,
  resource: Resource,
): Promise<ClinicContext> {
  const ctx = await requireClinicContext();

  if (!can(ctx.role, action, resource)) {
    throw forbidden(`${ctx.role} may not ${action} ${resource}`);
  }
  return ctx;
}

/** Assert a row belongs to the caller's active clinic before touching it. */
export function assertSameClinic(ctx: ClinicContext, rowClinicId: string): void {
  if (rowClinicId !== ctx.clinicId) {
    throw forbidden("cross-clinic access attempt");
  }
}
