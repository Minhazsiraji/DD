"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { photoPathFor } from "./profile";

/**
 * Professional-profile writes.
 *
 * Every one goes through an RPC that resolves the doctor from `auth.uid()`.
 * NOTHING HERE ACCEPTS A DOCTOR ID — a caller-supplied identity on a write is
 * how one doctor edits another, and the database already knows who is asking.
 *
 * These touch presentation only. No clinical table, no prescription, no
 * signature, no audit boundary.
 */

export type ProfileResult = { ok: true } | { ok: false; message: string };

const profileSchema = z.object({
  qualification: z.string().trim().max(200).optional().or(z.literal("")),
  specialization: z.string().trim().max(200).optional().or(z.literal("")),
  designation: z.string().trim().max(200).optional().or(z.literal("")),
  bmdc: z.string().trim().max(60).optional().or(z.literal("")),
  showBmdc: z.boolean(),
  slug: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function saveProfessionalProfileAction(input: unknown): Promise<ProfileResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those details could not be saved." };

  await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const v = parsed.data;

  const { error } = await supabase.rpc("save_professional_profile", {
    p_qualification: v.qualification ?? "",
    p_specialization: v.specialization ?? "",
    p_designation: v.designation ?? "",
    p_bmdc: v.bmdc ?? "",
    p_show_bmdc: v.showBmdc,
    p_slug: v.slug ?? "",
  });

  if (error) return { ok: false, message: profileError(error.message) };

  revalidatePath("/settings/professional");
  revalidatePath("/settings/professional/preview");
  return { ok: true };
}

/**
 * The same uniqueness the onboarding path answers to.
 *
 * A BMDC number identifies a clinician, so two accounts holding one is two
 * accounts claiming to be the same person. The unique index is the boundary and
 * this write goes through the very column it guards — there is no second path
 * that could quietly bypass it. All this does is turn `23505` into a sentence.
 */
function profileError(message: string): string {
  if (/doctor_profiles_bmdc_unique/i.test(message)) {
    return "That BMDC registration number is already registered to another account.";
  }
  if (/doctor_profiles_slug_unique/i.test(message)) {
    return "That profile link is already taken. Try another.";
  }
  if (/SLUG_RESERVED/.test(message)) return "That profile link is reserved. Choose another.";
  if (/SLUG_INVALID/.test(message)) {
    return "A profile link uses lowercase letters, numbers and hyphens, 3–40 characters.";
  }
  if (/only a doctor/i.test(message)) {
    return "Only a doctor account has a professional profile.";
  }
  console.error("[profile] save failed", message);
  return "Those details could not be saved just now.";
}

const sessionSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/),
});

const scheduleSchema = z.object({
  practiceLocationId: z.uuid(),
  publicNote: z.string().trim().max(120).optional().or(z.literal("")),
  sessions: z.array(sessionSchema).max(21),
});

/**
 * Replace a chamber's visiting hours.
 *
 * The location is checked IN THE DATABASE against active membership — a doctor
 * cannot publish hours for a hospital they do not practise at, whatever id the
 * browser sends. That check is in the RPC, not here.
 */
export async function saveChamberScheduleAction(input: unknown): Promise<ProfileResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That schedule could not be saved." };

  await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const v = parsed.data;

  // A session that ends before it starts is refused by a CHECK too; this is the
  // friendly half of the same rule.
  for (const s of v.sessions) {
    if (s.startsAt >= s.endsAt) {
      return { ok: false, message: "A visiting session must end after it starts." };
    }
  }

  const { error } = await supabase.rpc("save_chamber_schedule", {
    p_practice_location_id: v.practiceLocationId,
    p_public_note: v.publicNote ?? "",
    p_sessions: v.sessions,
  });

  if (error) {
    if (/not a chamber you practise at/i.test(error.message)) {
      return { ok: false, message: "You are not an active member of that chamber." };
    }
    console.error("[profile] schedule save failed", error.message);
    return { ok: false, message: "That schedule could not be saved just now." };
  }

  revalidatePath("/settings/professional");
  revalidatePath("/settings/professional/preview");
  return { ok: true };
}

/**
 * Upload or replace the professional photograph.
 *
 * THE PATH IS DERIVED FROM THE SESSION, never from the form. A browser that
 * could name the path could overwrite another doctor's object — the storage
 * policy would stop the write, but only because the policy checks the same
 * thing; relying on one of two checks is how the other one rots.
 *
 * `upsert: true` deliberately: replacing a portrait is ordinary. That is the
 * opposite of the signature freeze, which uses `upsert: false` because a frozen
 * signature must never be silently swapped — different asset, different rule.
 */
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function uploadProfilePhotoAction(form: FormData): Promise<ProfileResult> {
  await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an image to upload." };
  }
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
    return { ok: false, message: "Use a PNG, JPEG or WebP image." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, message: "That image is larger than 3 MB. Choose a smaller one." };
  }

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, message: "Sign in again to change your photo." };

  const { error: uploadError } = await supabase.storage
    .from("doctor-profile-photos")
    .upload(photoPathFor(user.id), file, { upsert: true, contentType: file.type });

  if (uploadError) {
    console.error("[profile] photo upload failed", uploadError.message);
    return { ok: false, message: "That photo could not be uploaded just now." };
  }

  const { error } = await supabase.rpc("set_professional_photo", { p_present: true });
  if (error) {
    console.error("[profile] photo record failed", error.message);
    return { ok: false, message: "The photo uploaded but could not be saved to your profile." };
  }

  revalidatePath("/settings/professional");
  revalidatePath("/settings/professional/preview");
  return { ok: true };
}

/**
 * Remove the photograph — object first, then the row that points at it.
 *
 * A Supabase delete blocked by RLS removes nothing and RAISES NOTHING:
 * `remove()` returns an empty list with `error === null`. So deletion is
 * confirmed from the RETURNED ROWS, never from the absence of an error. This
 * project has already once reported "removed" while the image was still there.
 */
export async function removeProfilePhotoAction(): Promise<ProfileResult> {
  await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, message: "Sign in again to change your photo." };

  const path = photoPathFor(user.id);
  const { data: removed, error: removeError } = await supabase.storage
    .from("doctor-profile-photos")
    .remove([path]);

  if (removeError) {
    console.error("[profile] photo remove failed", removeError.message);
    return { ok: false, message: "That photo could not be removed just now." };
  }

  const gone = (removed ?? []).some((o) => o.name === path);
  if (!gone) {
    /**
     * The object is still there. Clearing the row anyway would leave an
     * orphan the doctor believes is deleted — worse than an honest refusal.
     */
    console.error("[profile] photo remove returned no rows", path);
    return { ok: false, message: "That photo could not be removed. Try again in a moment." };
  }

  const { error } = await supabase.rpc("set_professional_photo", { p_present: false });
  if (error) {
    console.error("[profile] photo clear failed", error.message);
    return { ok: false, message: "The photo was removed but your profile still refers to it." };
  }

  revalidatePath("/settings/professional");
  revalidatePath("/settings/professional/preview");
  return { ok: true };
}
