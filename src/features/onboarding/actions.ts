"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, ACTIVE_LOCATION_COOKIE } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import { onboardingSchema, type ActionState } from "@/features/auth/schema";

/**
 * First-run setup: profile → doctor profile → location → membership.
 *
 * Runs through the user's own RLS-scoped client, so every step is subject to
 * the same policies as any other request. The bootstrap branch of
 * practice_location_members_insert is what allows the creator to seed their own rows.
 */

/** Initials, uppercased — "Dr. Ayesha Rahman" -> "AR". Used for patient numbers. */
function derivePrefix(fullName: string): string {
  const parts = fullName
    .replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const letters = parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  return letters.length >= 2 ? letters : (letters + "PT").slice(0, 2);
}

const optional = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

export async function completeOnboardingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = onboardingSchema.safeParse({
    qualification: formData.get("qualification") ?? "",
    specialization: formData.get("specialization") ?? "",
    bmdcRegistrationNo: formData.get("bmdcRegistrationNo") ?? "",
    locationName: formData.get("locationName"),
    locationType: formData.get("locationType"),
    address: formData.get("address") ?? "",
    district: formData.get("district") ?? "",
    phone: formData.get("phone") ?? "",
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

  const { data: authUser } = await supabase.auth.getUser();
  const fullName =
    (authUser.user?.user_metadata?.full_name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "Doctor";

  // 1. Profile (idempotent — onboarding may be retried after a failure).
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: user.id, full_name: fullName }, { onConflict: "id" });

  if (profileError) {
    return { ok: false, message: `Could not save your profile: ${profileError.message}` };
  }

  // 2. Doctor profile — the identity that will own patients in Phase 3.
  const { error: doctorError } = await supabase.from("doctor_profiles").upsert(
    {
      user_id: user.id,
      qualification: optional(formData.get("qualification")),
      specialization: optional(formData.get("specialization")),
      bmdc_registration_no: optional(formData.get("bmdcRegistrationNo")),
      patient_number_prefix: derivePrefix(fullName),
    },
    { onConflict: "user_id" },
  );

  if (doctorError) {
    return { ok: false, message: `Could not save your details: ${doctorError.message}` };
  }

  // 3. Location.
  const { data: location, error: locationError } = await supabase
    .from("practice_locations")
    .insert({
      name: parsed.data.locationName,
      type: parsed.data.locationType,
      address: optional(formData.get("address")),
      district: optional(formData.get("district")),
      phone: optional(formData.get("phone")),
      created_by: user.id,
    })
    .select("id, name")
    .single();

  if (locationError || !location) {
    return {
      ok: false,
      message: `Could not create the location: ${locationError?.message ?? "unknown error"}`,
    };
  }

  /**
   * 4. Membership — BOTH roles.
   *
   * Running your own chamber means practising in it and administering it. A
   * single role would leave the doctor unable to do one half of the job.
   */
  const { error: memberError } = await supabase.from("practice_location_members").insert([
    { practice_location_id: location.id, user_id: user.id, role: "DOCTOR", status: "ACTIVE" },
    { practice_location_id: location.id, user_id: user.id, role: "LOCATION_ADMIN", status: "ACTIVE" },
  ]);

  if (memberError) {
    return {
      ok: false,
      message: `Could not set up your access: ${memberError.message}`,
    };
  }

  await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id);

  await emitAudit({
    action: "location.created",
    resourceType: "practice_location",
    resourceId: location.id,
    locationId: location.id,
    actorId: user.id,
    meta: { type: parsed.data.locationType },
  });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LOCATION_COOKIE, location.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/dashboard");
}



