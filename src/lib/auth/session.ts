import "server-only";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  canAny,
  type Action,
  type LocationRole,
  type Resource,
} from "@/lib/rbac/permissions";
import { forbidden, noActiveLocation, unauthenticated } from "@/lib/errors";

export const ACTIVE_LOCATION_COOKIE = "dd_active_location";

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface Membership {
  locationId: string;
  locationName: string;
  /** A user may hold several roles at one clinic — permission is the union. */
  roles: LocationRole[];
}

export interface LocationContext {
  user: SessionUser;
  locationId: string;
  locationName: string;
  roles: LocationRole[];
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

/** Every ACTIVE practice-location membership for the current user. */
export async function getMemberships(): Promise<Membership[]> {
  const supabase = await createSupabaseServerClient();

  // RLS restricts this to the caller's own rows.
  const { data, error } = await supabase
    .from("practice_location_members")
    .select("practice_location_id, role, practice_locations(name)")
    .eq("status", "ACTIVE");

  if (error || !data) return [];

  // One row per (location, role) — collapse to one membership per location.
  const byLocation = new Map<string, Membership>();

  for (const row of data) {
    // PostgREST returns an embedded relation as an object or a single-element
    // array depending on the inferred cardinality; handle both.
    const rel = row.practice_locations as unknown;
    const name = Array.isArray(rel)
      ? (rel[0] as { name?: string })?.name
      : (rel as { name?: string } | null)?.name;
    if (!name) continue;

    const locationId = row.practice_location_id as string;
    const existing = byLocation.get(locationId);

    if (existing) {
      existing.roles.push(row.role as LocationRole);
    } else {
      byLocation.set(locationId, {
        locationId,
        locationName: name,
        roles: [row.role as LocationRole],
      });
    }
  }

  return [...byLocation.values()];
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
export async function requireLocationContext(): Promise<LocationContext> {
  const user = await requireUser();
  const memberships = await getMemberships();

  if (memberships.length === 0) {
    throw noActiveLocation("user has no active clinic membership");
  }

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value;

  const active =
    memberships.find((m) => m.locationId === requested) ?? memberships[0]!;

  return {
    user,
    locationId: active.locationId,
    locationName: active.locationName,
    roles: active.roles,
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
): Promise<LocationContext> {
  const ctx = await requireLocationContext();

  if (!canAny(ctx.roles, action, resource)) {
    throw forbidden(`${ctx.roles.join("+")} may not ${action} ${resource}`);
  }
  return ctx;
}

/** Assert a row belongs to the caller's active clinic before touching it. */
export function assertSameLocation(ctx: LocationContext, rowLocationId: string): void {
  if (rowLocationId !== ctx.locationId) {
    throw forbidden("cross-location access attempt");
  }
}



