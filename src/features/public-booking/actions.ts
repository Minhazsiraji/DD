"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  locationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localTime: z.string().regex(/^\d{2}:\d{2}$/),
  patientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(24),
  sex: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  reason: z.string().trim().max(300).optional(),
});

export async function createPublicBooking(slug: string, formData: FormData) {
  const parsed = schema.safeParse({
    locationId: formData.get("locationId"),
    date: formData.get("date"),
    localTime: formData.get("localTime"),
    patientName: formData.get("patientName"),
    phone: formData.get("phone"),
    sex: formData.get("sex") || "UNKNOWN",
    reason: formData.get("reason") || undefined,
  });

  if (!parsed.success) {
    redirect(`/dr/${encodeURIComponent(slug)}/book?error=check-details`);
  }

  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_public_booking", {
    p_slug: slug,
    p_location_id: v.locationId,
    p_date: v.date,
    p_local_time: v.localTime,
    p_patient_name: v.patientName,
    p_phone: v.phone,
    p_sex: v.sex,
    p_reason: v.reason ?? null,
  });

  if (error || !data) {
    const message = (error?.message ?? "").toUpperCase();
    const code =
      message.includes("DUPLICATE_BOOKING") ? "already-booked" :
      message.includes("SLOT_TAKEN") || message.includes("SESSION_FULL") ? "slot-unavailable" :
      message.includes("TOO_SOON") || message.includes("DATE_NOT_AVAILABLE") ? "slot-unavailable" :
      "booking-failed";
    redirect(`/dr/${encodeURIComponent(slug)}/book?error=${code}`);
  }

  const ref = (data as { bookingRef?: string }).bookingRef;
  if (!ref) redirect(`/dr/${encodeURIComponent(slug)}/book?error=booking-failed`);

  redirect(`/dr/${encodeURIComponent(slug)}/book/confirmed?ref=${encodeURIComponent(ref)}`);
}
