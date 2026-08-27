import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ChamberSession {
  weekday: number;
  startsAt: string;
  endsAt: string;
}

export interface ClosedDate {
  closedOn: string;
  reason: string | null;
}

export interface ChamberBookingConfig {
  chamberId: string;
  locationId: string;
  locationName: string;
  district: string | null;
  timezone: string;
  isActive: boolean;
  position: number;
  bookingEnabled: boolean;
  bookingMode: "TOKEN" | "TIME_SLOT";
  slotMinutes: number;
  maxPatients: number;
  bookingWindowDays: number;
  minLeadMinutes: number;
  consultationFee: number | string | null;
  currency: string;
  /** False until the doctor has saved once — the values above are then defaults. */
  configured: boolean;
  sessions: ChamberSession[];
  closedDates: ClosedDate[];
}

/**
 * The doctor's own booking configuration.
 *
 * Reads through the RPC rather than the table: `doctor_booking_settings` has all
 * its grants revoked, so there is no direct SELECT to fall back on. The RPC
 * resolves the doctor from the session — no id is passed from here, because a
 * value this layer could supply is a value a caller could forge.
 */
export async function getBookingConfig(): Promise<ChamberBookingConfig[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("doctor_booking_config");
  if (error || !Array.isArray(data)) return [];
  return data as unknown as ChamberBookingConfig[];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? `Day ${weekday}`;
}

/** "60" → "1 hour", so a doctor reads notice periods rather than decoding them. */
export function describeLead(minutes: number): string {
  if (minutes === 0) return "no minimum";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
