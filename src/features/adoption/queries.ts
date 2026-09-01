import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMemberships } from "@/lib/auth/session";
import { getBookingConfigResult } from "@/features/booking-settings/queries";
import { deriveSetupProgress, type SetupSnapshot, type SetupProgress } from "./progress";

/**
 * Assembling the setup snapshot from things that are already true.
 *
 * EVERY READ IS THE CALLER'S OWN. No id is passed anywhere — `doctor_profiles`
 * is filtered on the session's user, `doctor_booking_config()` resolves the
 * doctor inside the database from `current_doctor_id()`, and the two counts run
 * under RLS that scopes them to the caller's repository. There is no parameter
 * here that could be pointed at another doctor.
 *
 * A FAILED READ IS `null`, NEVER `false`. That distinction is the whole point:
 * `false` tells a doctor they have not done something, and if the read simply
 * failed that is a lie the checklist would tell confidently.
 */
export async function getSetupSnapshot(): Promise<SetupSnapshot | null> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return null;

  const [{ data: profileRow }, { data: doctorRow }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("doctor_profiles")
      .select(
        "id, qualification, specialization, designation, " +
          "professional_photo_path, profile_visibility, profile_slug",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  /*
   * No doctor profile means this is a reception or admin account. They have no
   * professional setup to complete, and showing them a doctor's checklist would
   * be asking them to do work that is not theirs.
   */
  if (!doctorRow) return null;
  const d = doctorRow as unknown as Record<string, unknown>;

  const [booking, memberships, hasPatients, hasCompletedConsultation] = await Promise.all([
    getBookingConfigResult().catch(() => ({ ok: false, chambers: [] })),
    getMemberships().catch(() => null),
    hasAny(supabase, "patients"),
    hasCompletedEncounter(supabase),
  ]);

  return {
    profileExists: true,
    fullName: text((profileRow as { full_name?: unknown } | null)?.full_name),
    qualification: text(d.qualification),
    specialization: text(d.specialization),
    designation: text(d.designation),
    hasPhoto: text(d.professional_photo_path) !== null,
    visibility: (d.profile_visibility as "PUBLIC" | "PRIVATE" | null) ?? null,
    slug: text(d.profile_slug),
    /*
     * `doctor_booking_config()` is already the one reader for this shape — it
     * resolves the doctor in the database, merges saved settings with their
     * defaults, and tells `configured` apart from `enabled`. Reading the tables
     * again here would be a second definition of "a chamber", free to disagree
     * with the booking screen the doctor is about to open.
     */
    chambers: booking.ok
      ? booking.chambers.map((c) => ({
          id: c.chamberId,
          name: c.locationName,
          hasSchedule: c.sessions.length > 0,
          bookingEnabled: c.bookingEnabled === true,
          /*
           * A fee of zero is a fee — some doctors do not charge, and "free" is
           * a decision they made. Only an unset fee counts as unset.
           */
          hasFee:
            c.consultationFee !== null &&
            c.consultationFee !== undefined &&
            c.consultationFee !== "",
        }))
      : null,
    /*
     * A place you work is not yet a chamber on your profile. Someone who added
     * a clinic during sign-up but has never described it should read "started",
     * not "not done" — and not "nothing here", which hides the work they did.
     */
    placeCount: memberships === null ? null : memberships.length,
    hasPatients,
    hasCompletedConsultation,
  };
}

export async function getSetupProgress(): Promise<SetupProgress | null> {
  const snapshot = await getSetupSnapshot();
  return snapshot ? deriveSetupProgress(snapshot) : null;
}

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Does the caller have at least one patient?
 *
 * `head: true` with an exact count asks the database for a number and no rows.
 * The checklist needs to know THAT a patient exists; it has no business
 * receiving one, and a query that cannot return a name cannot leak one.
 */
async function hasAny(supabase: Client, table: "patients"): Promise<boolean | null> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) return null;
  return (count ?? 0) > 0;
}

/** Same shape, and the one filter that makes it "completed" rather than "started". */
async function hasCompletedEncounter(supabase: Client): Promise<boolean | null> {
  const { count, error } = await supabase
    .from("encounters")
    .select("id", { count: "exact", head: true })
    .eq("status", "COMPLETED");
  if (error) return null;
  return (count ?? 0) > 0;
}

function text(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}
