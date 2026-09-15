"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser, getMemberships } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emitAudit } from "@/lib/audit/emit";
import type { ActionState } from "@/features/auth/schema";
import {
  removeUnlinkedClinicLogoObject,
  uploadClinicLogoObject,
} from "@/features/prescriptions/freeze-store";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

async function requireDoctorAtLocation(locationId: string) {
  const memberships = await getMemberships();
  return memberships.find((m) => m.locationId === locationId && m.roles.includes("DOCTOR")) ?? null;
}

export async function uploadClinicLogoAction(
  locationId: string,
  formData: FormData,
): Promise<ActionState> {
  if (!z.uuid().safeParse(locationId).success) return { ok: false, message: "Invalid clinic." };
  const file = formData.get("clinicLogo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a logo image first." };
  if (!ALLOWED_TYPES.includes(file.type)) return { ok: false, message: "Use a PNG, JPG or WebP image." };
  if (file.size > MAX_BYTES) return { ok: false, message: "That image is over 2 MB. Use a smaller one." };

  const user = await requireUser();
  const membership = await requireDoctorAtLocation(locationId);
  if (!membership) return { ok: false, message: "You can only set a logo for a place where you practise as a doctor." };
  if (!membership.roles.includes("LOCATION_ADMIN")) {
    return { ok: false, message: "Only a clinic/location administrator can change this clinic logo." };
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${locationId}/logo-${Date.now()}.${ext}`;
  const uploaded = await uploadClinicLogoObject(path, file, file.type);
  if (!uploaded.ok) return { ok: false, message: `Could not upload it: ${uploaded.message}` };

  const supabase = await createSupabaseServerClient();
  const { error: saveError } = await supabase
    .from("practice_locations")
    .update({ prescription_logo_path: path, updated_at: new Date().toISOString() })
    .eq("id", locationId);
  if (saveError) {
    await removeUnlinkedClinicLogoObject(path);
    return { ok: false, message: `Could not save it: ${saveError.message}` };
  }

  await emitAudit({
    action: "location.updated",
    resourceType: "practice_location",
    resourceId: locationId,
    locationId,
    actorId: user.id,
    meta: { fields: ["prescription_logo"], operation: "set", immutableAssetPath: true },
  });
  revalidatePath("/settings/prescription");
  return { ok: true, message: "Clinic logo saved." };
}

export async function removeClinicLogoAction(locationId: string): Promise<ActionState> {
  if (!z.uuid().safeParse(locationId).success) return { ok: false, message: "Invalid clinic." };
  const user = await requireUser();
  const membership = await requireDoctorAtLocation(locationId);
  if (!membership) return { ok: false, message: "You can only change a place where you practise as a doctor." };
  if (!membership.roles.includes("LOCATION_ADMIN")) {
    return { ok: false, message: "Only a clinic/location administrator can change this clinic logo." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("practice_locations")
    .update({ prescription_logo_path: null, updated_at: new Date().toISOString() })
    .eq("id", locationId);
  if (error) return { ok: false, message: `Could not remove it: ${error.message}` };

  // Deliberately do not delete old logo objects. Finalized prescriptions may
  // still attest those immutable paths and must remain printable forever.
  await emitAudit({
    action: "location.updated",
    resourceType: "practice_location",
    resourceId: locationId,
    locationId,
    actorId: user.id,
    meta: { fields: ["prescription_logo"], operation: "remove" },
  });
  revalidatePath("/settings/prescription");
  return { ok: true, message: "Clinic logo removed from future prescriptions." };
}
