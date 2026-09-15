"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  consumePublicBookingRateLimit,
  createPublicBookingPrivileged,
} from "@/features/public-booking/service";

const schema = z.object({
  locationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localTime: z.string().regex(/^\d{2}:\d{2}$/),
  patientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(24),
  sex: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  reason: z.string().trim().max(300).optional(),
});

/** Keep every server refusal on one public response shape to avoid a disclosure oracle. */
function publicBookingFailure(slug: string): never {
  redirect(`/dr/${encodeURIComponent(slug)}/book?error=unavailable`);
}

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

  const requestHeaders = await headers();
  const sourceIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (!sourceIp || !(await consumePublicBookingRateLimit(sourceIp))) {
    publicBookingFailure(slug);
  }

  const v = parsed.data;
  const data = await createPublicBookingPrivileged({
    slug,
    locationId: v.locationId,
    date: v.date,
    localTime: v.localTime,
    patientName: v.patientName,
    phone: v.phone,
    sex: v.sex,
    reason: v.reason ?? null,
  });

  if (!data) {
    publicBookingFailure(slug);
  }

  const ref = (data as { bookingRef?: string }).bookingRef;
  if (!ref) publicBookingFailure(slug);

  redirect(`/dr/${encodeURIComponent(slug)}/book/confirmed?ref=${encodeURIComponent(ref)}`);
}
