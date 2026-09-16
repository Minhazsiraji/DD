"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PublicationResult =
  | { ok: true; visibility: "PRIVATE" | "PUBLIC"; slug: string }
  | { ok: false; message: string };

const visibilitySchema = z.enum(["PRIVATE", "PUBLIC"]);

export async function setProfileVisibilityAction(input: unknown): Promise<PublicationResult> {
  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That publication state is invalid." };

  await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, message: "Sign in again to change profile publication." };

  const { data: ownProfile, error: readError } = await supabase
    .from("doctor_profiles")
    .select("profile_slug")
    .eq("user_id", user.id)
    .maybeSingle();

  if (readError || !ownProfile) {
    return { ok: false, message: "Only a doctor account can publish a professional profile." };
  }

  const slug = String((ownProfile as { profile_slug: string | null }).profile_slug ?? "").trim();
  if (!slug) return { ok: false, message: "Choose and save your public profile link before publishing." };

  const { data: updated, error } = await supabase
    .from("doctor_profiles")
    .update({ profile_visibility: parsed.data })
    .eq("user_id", user.id)
    .select("profile_slug")
    .maybeSingle();

  if (error || !updated) {
    console.error("[profile] publication state update failed");
    return { ok: false, message: "Your publication state could not be changed just now." };
  }

  revalidatePath("/settings/professional");
  revalidatePath("/settings/professional/preview");
  revalidatePath(`/dr/${slug}`);
  return { ok: true, visibility: parsed.data, slug };
}
