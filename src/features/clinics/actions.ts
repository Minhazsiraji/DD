"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, ACTIVE_CLINIC_COOKIE } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import type { ActionState } from "@/features/auth/schema";

/**
 * Adding another place the doctor practises.
 *
 * A doctor commonly works across their own chamber plus one or more clinics.
 * Each is a separate `clinics` row, and the doctor joins it as both DOCTOR and
 * CLINIC_ADMIN (they set it up, so they administer it).
 *
 * Patient identity does NOT split across these — patients belong to the doctor.
 * Only the clinical events are clinic-scoped. See docs/architecture.md §2.
 */

export const addClinicSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(160),
  type: z.enum(["OWN_CHAMBER", "CLINIC", "HOSPITAL", "TELEMEDICINE"]),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  district: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  makeActive: z.coerce.boolean().optional(),
});

const optional = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

export async function addClinicAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = addClinicSchema.safeParse({
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

  const { data: clinic, error } = await supabase
    .from("clinics")
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

  if (error || !clinic) {
    return {
      ok: false,
      message: `Could not add it: ${error?.message ?? "unknown error"}`,
    };
  }

  // Both roles — you practise here and you administer it.
  const { error: memberError } = await supabase.from("clinic_members").insert([
    { clinic_id: clinic.id, user_id: user.id, role: "DOCTOR", status: "ACTIVE" },
    { clinic_id: clinic.id, user_id: user.id, role: "CLINIC_ADMIN", status: "ACTIVE" },
  ]);

  if (memberError) {
    return { ok: false, message: `Could not set up access: ${memberError.message}` };
  }

  await emitAudit({
    action: "clinic.created",
    resourceType: "clinic",
    resourceId: clinic.id,
    clinicId: clinic.id,
    actorId: user.id,
    meta: { type: parsed.data.type },
  });

  if (parsed.data.makeActive) {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_CLINIC_COOKIE, clinic.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");

  return { ok: true, message: `${clinic.name} added.` };
}
