"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

/**
 * These bounds mirror the CHECK constraints and the RPC's own validation. All
 * three exist on purpose: this one gives the doctor a usable message, the RPC is
 * the authority, and the constraint is the floor nothing gets under. The client
 * copy is never the control.
 */
const settingsSchema = z.object({
  chamberId: z.string().uuid(),
  enabled: z.coerce.boolean(),
  mode: z.enum(["TOKEN", "TIME_SLOT"]),
  slotMinutes: z.coerce.number().int().min(5).max(180),
  maxPatients: z.coerce.number().int().min(1).max(500),
  windowDays: z.coerce.number().int().min(1).max(180),
  leadMinutes: z.coerce.number().int().min(0).max(10080),
  fee: z.union([z.coerce.number().min(0).max(1_000_000), z.literal("")]).optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default("BDT"),
});

const closedDateSchema = z.object({
  chamberId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(120).optional(),
});

/** The doctor's own screen, so refusals name the actual problem. */
const MESSAGES: Record<string, string> = {
  CHAMBER_NOT_FOUND: "chamber-not-found",
  NO_VISITING_HOURS: "no-visiting-hours",
  LOCATION_INACTIVE: "location-inactive",
  INVALID_MODE: "check-values",
  INVALID_SLOT_MINUTES: "check-values",
  INVALID_MAX_PATIENTS: "check-values",
  INVALID_WINDOW: "check-values",
  INVALID_LEAD: "check-values",
  INVALID_FEE: "check-values",
  INVALID_CURRENCY: "check-values",
  DOCTOR_REQUIRED: "not-a-doctor",
};

function codeFor(message: string): string {
  const hit = Object.keys(MESSAGES).find((key) => message.includes(key));
  return hit ? MESSAGES[hit]! : "save-failed";
}

export async function saveBookingSettings(formData: FormData) {
  await requireUser();

  const parsed = settingsSchema.safeParse({
    chamberId: formData.get("chamberId"),
    enabled: formData.get("enabled") === "on",
    mode: formData.get("mode"),
    slotMinutes: formData.get("slotMinutes"),
    maxPatients: formData.get("maxPatients"),
    windowDays: formData.get("windowDays"),
    leadMinutes: formData.get("leadMinutes"),
    fee: formData.get("fee") ?? "",
    currency: formData.get("currency") || "BDT",
  });
  if (!parsed.success) redirect("/settings/booking?error=check-values");

  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_doctor_booking_settings", {
    p_chamber_id: v.chamberId,
    p_enabled: v.enabled,
    p_mode: v.mode,
    p_slot_minutes: v.slotMinutes,
    p_max_patients: v.maxPatients,
    p_window_days: v.windowDays,
    p_lead_minutes: v.leadMinutes,
    p_fee: v.fee === "" || v.fee === undefined ? null : v.fee,
    p_currency: v.currency,
  });

  if (error) redirect(`/settings/booking?error=${codeFor(error.message)}`);

  revalidatePath("/settings/booking");
  redirect("/settings/booking?saved=1");
}

export async function addClosedDate(formData: FormData) {
  await requireUser();

  const parsed = closedDateSchema.safeParse({
    chamberId: formData.get("chamberId"),
    date: formData.get("date"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) redirect("/settings/booking?error=check-date");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_doctor_booking_closed_date", {
    p_chamber_id: parsed.data.chamberId,
    p_date: parsed.data.date,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) redirect(`/settings/booking?error=${codeFor(error.message)}`);

  revalidatePath("/settings/booking");
  redirect("/settings/booking?closed=1");
}

export async function removeClosedDate(formData: FormData) {
  await requireUser();

  const parsed = closedDateSchema
    .omit({ reason: true })
    .safeParse({ chamberId: formData.get("chamberId"), date: formData.get("date") });
  if (!parsed.success) redirect("/settings/booking?error=check-date");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_doctor_booking_closed_date", {
    p_chamber_id: parsed.data.chamberId,
    p_date: parsed.data.date,
  });

  if (error) redirect(`/settings/booking?error=${codeFor(error.message)}`);

  revalidatePath("/settings/booking");
  redirect("/settings/booking?reopened=1");
}
