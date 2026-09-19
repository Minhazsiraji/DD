import "server-only";
import { forbidden } from "@/lib/errors";
import { requireLocationContext, type LocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { STAFF_PERMISSIONS, type StaffPermission } from "./permissions";

export interface StaffAuthorizationContext extends LocationContext {
  doctorId: string;
  staffPermission: StaffPermission;
}

/**
 * Doctor-scoped delegated authorization.
 *
 * `requireLocationContext()` first proves the caller's ACTIVE broad location
 * membership and validates the active-location cookie. PostgreSQL then proves
 * the ACTIVE Doctor-staff grant, Doctor-specific location assignment, role
 * ceiling and explicit permission. Both checks are mandatory.
 */
export async function requireStaffPermission(
  doctorId: string,
  permission: StaffPermission,
): Promise<StaffAuthorizationContext> {
  if (!(STAFF_PERMISSIONS as readonly string[]).includes(permission)) {
    throw forbidden("unknown staff permission");
  }

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("has_doctor_staff_permission", {
    target_doctor_id: doctorId,
    target_location_id: ctx.locationId,
    target_permission: permission,
  });

  if (error || data !== true) {
    throw forbidden("delegated staff permission denied");
  }

  return { ...ctx, doctorId, staffPermission: permission };
}
