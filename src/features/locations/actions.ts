"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, ACTIVE_LOCATION_COOKIE } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import type { ActionState } from "@/features/auth/schema";
import { addLocationSchema } from "./schema";

/**
 * Adding another place the doctor practises.
 *
 * A doctor commonly works across their own chamber plus one or more locations.
 * Each is a separate `locations` row, and the doctor joins it as both DOCTOR and
 * LOCATION_ADMIN (they set it up, so they administer it).
 *
 * Patient identity does NOT split across these — patients belong to the doctor.
 * Only the clinical events are location-scoped. See docs/architecture.md §2.
 */

// NOTE: this file is "use server" — it may export ONLY async functions.
// addLocationSchema lives in ./schema.ts for that reason. See schema.ts.

const optional = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

export async function addLocationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = addLocationSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    address: formData.get("address") ?? "",
    district: formData.get("district") ?? "",
    phone: formData.get("phone") ?? "",
    makeActive: formData.get("makeActive") === "on",
  });

  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data: location, error } = await supabase
    .from("practice_locations")
    .insert({
      name: parsed.data.name,
      type: parsed.data.type,
      address: optional(formData.get("address")),
      district: optional(formData.get("district")),
      phone: optional(formData.get("phone")),
      created_by: user.id,
    })
    .select("id, name")
    .single();

  if (error || !location) {
    return {
      ok: false,
      message: `Could not add it: ${error?.message ?? "unknown error"}`,
    };
  }

  // Both roles — you practise here and you administer it.
  const { error: memberError } = await supabase.from("practice_location_members").insert([
    { practice_location_id: location.id, user_id: user.id, role: "DOCTOR", status: "ACTIVE" },
    { practice_location_id: location.id, user_id: user.id, role: "LOCATION_ADMIN", status: "ACTIVE" },
  ]);

  if (memberError) {
    return { ok: false, message: `Could not set up access: ${memberError.message}` };
  }

  await emitAudit({
    action: "location.created",
    resourceType: "practice_location",
    resourceId: location.id,
    locationId: location.id,
    actorId: user.id,
    meta: { type: parsed.data.type },
  });

  if (parsed.data.makeActive) {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_LOCATION_COOKIE, location.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");

  return { ok: true, message: `${location.name} added.` };
}





