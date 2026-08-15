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

  /**
   * ONE transaction, and retry-safe.
   *
   * This was five separate writes. A failure partway through left an orphan
   * practice location or a doctor with no membership, and retrying created a
   * SECOND location. The function upserts the profiles and only creates a
   * location when the doctor has none, so a retry converges instead of
   * duplicating.
   *
   * A solo doctor joins as BOTH roles: running your own chamber means
   * practising in it and administering it.
   */
  const { data: locationId, error } = await supabase.rpc("complete_onboarding", {
    p_full_name: fullName,
    p_qualification: optional(formData.get("qualification")),
    p_specialization: optional(formData.get("specialization")),
    p_bmdc: optional(formData.get("bmdcRegistrationNo")),
    p_number_prefix: derivePrefix(fullName),
    p_location_name: parsed.data.locationName,
    p_location_type: parsed.data.locationType,
    p_address: optional(formData.get("address")),
    p_district: optional(formData.get("district")),
    p_phone: optional(formData.get("phone")),
  });

  if (error || !locationId) {
    return {
      ok: false,
      message: `Could not finish setting up your practice: ${error?.message ?? "unknown error"}`,
    };
  }

  const location = { id: locationId as string };

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



