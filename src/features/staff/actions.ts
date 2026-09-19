"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import {
  isStaffRole,
  isStaffStatus,
  normalizeStaffPermissions,
  type StaffPermission,
} from "./permissions";
import {
  serviceFindAuthUserByEmail,
  serviceInviteStaffByEmail,
  serviceLinkStaffInvitation,
} from "./service";

function values(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function requireDoctor() {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("doctor_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data?.id) throw new Error("TEAM_DOCTOR_ONLY");
  return { user, doctorId: data.id as string, supabase };
}

async function assertDoctorLocations(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  doctorId: string,
  locationIds: string[],
) {
  if (locationIds.length === 0 || new Set(locationIds).size !== locationIds.length) {
    throw new Error("TEAM_LOCATION_REQUIRED");
  }
  const { data, error } = await supabase
    .from("doctor_chambers")
    .select("practice_location_id")
    .eq("doctor_profile_id", doctorId)
    .in("practice_location_id", locationIds);
  if (error || data?.length !== locationIds.length) {
    throw new Error("TEAM_LOCATION_NOT_OWN_CHAMBER");
  }
}

export async function addStaffAction(formData: FormData): Promise<void> {
  const { user, doctorId, supabase } = await requireDoctor();
  const rawEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");
  const locationIds = values(formData, "locations");
  const requested = values(formData, "permissions");

  if (!rawEmail || rawEmail.length > 320 || !rawEmail.includes("@")) {
    throw new Error("TEAM_EMAIL_INVALID");
  }
  if (!isStaffRole(role)) throw new Error("TEAM_ROLE_INVALID");
  await assertDoctorLocations(supabase, doctorId, locationIds);

  const permissions = normalizeStaffPermissions(role, requested);
  if (permissions.length !== new Set(requested).size) {
    throw new Error("TEAM_PERMISSION_EXCEEDS_ROLE");
  }

  const { data: invitation, error: invitationError } = await supabase
    .from("doctor_staff_invitations")
    .insert({
      doctor_profile_id: doctorId,
      email: rawEmail,
      role,
      requested_location_ids: locationIds,
      requested_permissions: permissions,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (invitationError || !invitation?.id) throw new Error("TEAM_INVITATION_CREATE_FAILED");

  // The durable invitation itself grants nothing. Only after an exact Auth
  // identity is found/created does the server-only link RPC create the grant.
  let authUser = await serviceFindAuthUserByEmail(rawEmail);
  if (!authUser) authUser = await serviceInviteStaffByEmail({ email: rawEmail });

  await serviceLinkStaffInvitation({
    invitationId: invitation.id as string,
    staffUserId: authUser.id,
  });

  await supabase.from("audit_events").insert({
    practice_location_id: locationIds[0]!,
    actor_id: user.id,
    action: "STAFF_INVITATION_CREATED",
    resource_type: "doctor_staff_invitation",
    resource_id: invitation.id,
    meta: {
      doctor_profile_id: doctorId,
      staff_user_id: authUser.id,
      staff_role: role,
    },
  });

  revalidatePath("/settings/team");
}

export async function setStaffStatusAction(formData: FormData): Promise<void> {
  await requireDoctor();
  const grantId = String(formData.get("grantId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!grantId || !isStaffStatus(status)) throw new Error("TEAM_STATUS_INVALID");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("doctor_set_staff_status", {
    target_grant_id: grantId,
    target_status: status,
  });
  if (error) throw new Error("TEAM_STATUS_UPDATE_FAILED");
  revalidatePath("/settings/team");
}

export async function replaceStaffLocationsAction(formData: FormData): Promise<void> {
  const { doctorId, supabase } = await requireDoctor();
  const grantId = String(formData.get("grantId") ?? "");
  const locationIds = values(formData, "locations");
  if (!grantId) throw new Error("TEAM_GRANT_REQUIRED");
  await assertDoctorLocations(supabase, doctorId, locationIds);
  const { error } = await supabase.rpc("doctor_replace_staff_locations", {
    target_grant_id: grantId,
    target_location_ids: locationIds,
  });
  if (error) throw new Error("TEAM_LOCATION_UPDATE_FAILED");
  revalidatePath("/settings/team");
}

export async function replaceStaffPermissionsAction(formData: FormData): Promise<void> {
  const { supabase } = await requireDoctor();
  const grantId = String(formData.get("grantId") ?? "");
  const role = String(formData.get("role") ?? "");
  const requested = values(formData, "permissions");
  if (!grantId || !isStaffRole(role)) throw new Error("TEAM_GRANT_REQUIRED");
  const permissions = normalizeStaffPermissions(role, requested);
  if (permissions.length !== new Set(requested).size) {
    throw new Error("TEAM_PERMISSION_EXCEEDS_ROLE");
  }
  const { error } = await supabase.rpc("doctor_replace_staff_permissions", {
    target_grant_id: grantId,
    target_permissions: permissions as StaffPermission[],
  });
  if (error) throw new Error("TEAM_PERMISSION_UPDATE_FAILED");
  revalidatePath("/settings/team");
}
