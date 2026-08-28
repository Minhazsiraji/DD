import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  /**
   * Optional because the current public RPC deliberately does not expose the
   * private portrait path. A future hardened RPC may return only a short-lived
   * signed HTTPS URL under this key; the public avatar component validates it.
   */
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
