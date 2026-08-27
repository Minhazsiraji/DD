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
    /**
     * ONE generic code for every server-side refusal, deliberately.
     *
     * The database refuses a booking for several distinct reasons and names
     * each one, as it should — a doctor reading logs needs the difference. But
     * this endpoint is anonymous, so passing that difference to the caller
     * hands a stranger an oracle: a refusal that means "this number already has
     * a booking" confirms that person is seeing this doctor on this date. That
     * is a clinical disclosure made by an error message.
     *
     * `error.message` is deliberately not read here, and a test asserts it
     * stays that way. The cost is real and accepted: a patient who genuinely
     * double-books is told "not available" rather than why. Their booking still
     * exists, and the chamber can tell them. Leaking one patient's attendance
     * to strangers is the worse trade.
     */
    redirect(`/dr/${encodeURIComponent(slug)}/book?error=unavailable`);
  }

  // Same generic code: a response without a reference is a server-side outcome
  // too, and a distinct message here would restore the oracle by the back door.
  const ref = (data as { bookingRef?: string }).bookingRef;
  if (!ref) redirect(`/dr/${encodeURIComponent(slug)}/book?error=unavailable`);

  redirect(`/dr/${encodeURIComponent(slug)}/book/confirmed?ref=${encodeURIComponent(ref)}`);
}
