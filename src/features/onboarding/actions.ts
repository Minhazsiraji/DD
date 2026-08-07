"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, ACTIVE_CLINIC_COOKIE } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import { onboardingSchema, type ActionState } from "@/features/auth/schema";

/**
 * First-run setup: profile → doctor profile → clinic → membership.
 *
 * Runs through the user's own RLS-scoped client, so every step is subject to
 * the same policies as any other request. The bootstrap branch of
 * clinic_members_insert is what allows the creator to seed their own rows.
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
    clinicName: formData.get("clinicName"),
    clinicType: formData.get("clinicType"),
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

  // 3. Clinic.
  const { data: clinic, error: clinicError } = await supabase
    .from("clinics")
    .insert({
      name: parsed.data.clinicName,
      type: parsed.data.clinicType,
      address: optional(formData.get("address")),
      district: optional(formData.get("district")),
      phone: optional(formData.get("phone")),
      created_by: user.id,
    })
    .select("id, name")
    .single();

  if (clinicError || !clinic) {
    return {
      ok: false,
      message: `Could not create the clinic: ${clinicError?.message ?? "unknown error"}`,
    };
  }

  /**
   * 4. Membership — BOTH roles.
   *
   * Running your own chamber means practising in it and administering it. A
   * single role would leave the doctor unable to do one half of the job.
   */
  const { error: memberError } = await supabase.from("clinic_members").insert([
    { clinic_id: clinic.id, user_id: user.id, role: "DOCTOR", status: "ACTIVE" },
    { clinic_id: clinic.id, user_id: user.id, role: "CLINIC_ADMIN", status: "ACTIVE" },
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
    action: "clinic.created",
    resourceType: "clinic",
    resourceId: clinic.id,
    clinicId: clinic.id,
    actorId: user.id,
    meta: { type: parsed.data.clinicType },
  });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLINIC_COOKIE, clinic.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/dashboard");
}
