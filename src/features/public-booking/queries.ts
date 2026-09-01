import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safePublicPhotoUrl } from "./public-photo";

export interface PublicSession {
  weekday: number;
  startsAt: string;
  endsAt: string;
}

export interface PublicChamber {
  chamberId: string;
  locationId: string;
  name: string;
  address: string | null;
  district: string | null;
  publicNote: string | null;
  bookingEnabled: boolean;
  bookingMode: "TOKEN" | "TIME_SLOT" | null;
  consultationFee: number | string | null;
  currency: string;
  sessions: PublicSession[];
}

export interface PublicDoctor {
  fullName: string;
  qualification: string | null;
  designation: string | null;
  specialization: string | null;
  bmdc: string | null;
  slug: string;
  /** Only a short-lived signed HTTPS URL. The raw storage object key is never public data. */
  photoUrl?: string | null;
  chambers: PublicChamber[];
}

export interface PublicSlot {
  localTime: string;
  label: string;
}

export interface PublicBookingConfirmation {
  bookingRef: string;
  serial: number;
  doctorName: string;
  chamberName: string;
  date: string;
  localTime: string;
  status: string;
}

export async function getPublicDoctor(slug: string): Promise<PublicDoctor | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_doctor_profile", { p_slug: slug });
  if (error || !data) return null;
  return data as unknown as PublicDoctor;
}

/**
 * Resolve the public portrait without ever receiving a storage path in this app.
 * The Edge Function accepts only the public slug, re-checks PUBLIC visibility,
 * derives the doctor's own fixed portrait path server-side, and returns one
 * short-lived signed HTTPS URL. Failure is non-fatal: the initials fallback is
 * the safe presentation state.
 */
export async function getPublicDoctorPhotoUrl(slug: string): Promise<string | null> {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(normalized)) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.functions.invoke("public-doctor-photo", {
    body: { slug: normalized },
  });
  if (error || !data || typeof data !== "object") return null;

  // The last gate before this is rendered as an <img> on an anonymous page.
  return safePublicPhotoUrl((data as { photoUrl?: unknown }).photoUrl);
}

export async function getPublicSlots(
  slug: string,
  locationId: string,
  date: string,
): Promise<PublicSlot[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_booking_slots", {
    p_slug: slug,
    p_location_id: locationId,
    p_date: date,
  });
  if (error || !Array.isArray(data)) return [];
  return data as unknown as PublicSlot[];
}

export async function getPublicBookingConfirmation(
  slug: string,
  bookingRef: string,
): Promise<PublicBookingConfirmation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingRef)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_booking_confirmation", {
    p_slug: slug,
    p_booking_ref: bookingRef,
  });
  if (error || !data) return null;
  const value = data as unknown as PublicBookingConfirmation;
  if (!Number.isInteger(value.serial) || value.serial < 1) return null;
  return value;
}
