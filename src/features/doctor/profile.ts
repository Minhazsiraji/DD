import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The doctor's professional profile, as a patient would eventually read it.
 *
 * WHAT MAY BE IN HERE IS A CLOSED LIST, and this type is the enforcement point.
 * A profile is the one object in this product designed to leave the clinic, so
 * the rule is not "remember to leave patients out" — it is that there is
 * nowhere in the shape to put them.
 *
 * Never: patient rows, patient counts, consultations, diagnoses, prescriptions,
 * medicine history, audit events, internal roles, internal ids beyond the
 * chamber keys the page needs to render, the account email, the doctor's
 * private phone, or the signature. The signature especially — it is a clinical
 * artefact attested inside prescription digests, and it is NOT a portrait.
 */

export interface ProfileSession {
  weekday: number;
  startsAt: string;
  endsAt: string;
}

export interface ProfileChamber {
  locationId: string;
  name: string;
  /** Street plus district, as one line. The chamber's, never the doctor's home. */
  addressLine: string | null;
  district: string | null;
  publicNote: string | null;
  sessions: ProfileSession[];
}

export interface DoctorProfile {
  fullName: string;
  qualification: string | null;
  designation: string | null;
  specialization: string | null;
  /** Present ONLY when the doctor chose to show it. Self-asserted (ADR 0003). */
  bmdc: string | null;
  /** Short-lived signed URL for the private photo, or null. Never a stored URL. */
  photoUrl: string | null;
  chambers: ProfileChamber[];
  visibility: "PRIVATE" | "PUBLIC";
  slug: string | null;
}

/** Where a photo lives, given the owner. Derived — never taken from a caller. */
export function photoPathFor(userId: string): string {
  return `${userId}/photo`;
}

/**
 * The signed-in doctor's own profile.
 *
 * Everything is read under the caller's session, so RLS is what scopes it:
 * `doctor_chambers` is `doctor_profile_id = current_doctor_id()`, and the photo
 * is signed from a bucket whose policies key on the owner's folder. Nobody's
 * profile but their own is reachable through this function, and it takes no
 * doctor id that could make it otherwise.
 */
export async function getOwnProfile(): Promise<DoctorProfile | null> {
  const supabase = await createSupabaseServerClient();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return null;

  const [{ data: profileRow }, { data: doctorRow }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("doctor_profiles")
      .select(
        "id, qualification, specialization, designation, bmdc_registration_no, " +
          "show_bmdc_on_profile, professional_photo_path, profile_visibility, profile_slug",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!doctorRow) return null;
  const d = doctorRow as unknown as Record<string, unknown>;

  const [chambers, photoUrl] = await Promise.all([
    readChambers(supabase),
    signPhoto(supabase, d.professional_photo_path as string | null),
  ]);

  return {
    fullName: ((profileRow as { full_name: string } | null)?.full_name ?? "").trim() || "Doctor",
    qualification: text(d.qualification),
    designation: text(d.designation),
    specialization: text(d.specialization),
    /**
     * The switch is honoured HERE, not in the template. A field that reaches
     * the page and is hidden by CSS has still left the building.
     */
    bmdc: d.show_bmdc_on_profile ? text(d.bmdc_registration_no) : null,
    photoUrl,
    chambers,
    visibility: (d.profile_visibility as DoctorProfile["visibility"]) ?? "PRIVATE",
    slug: text(d.profile_slug),
  };
}

function text(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * The doctor's chambers, with their hours.
 *
 * A chamber only appears once the doctor has given it something to say — a row
 * in `doctor_chambers` exists because they saved a schedule or a note for it.
 * Membership alone does not put a hospital on a public page.
 */
async function readChambers(supabase: Client): Promise<ProfileChamber[]> {
  const { data, error } = await supabase
    .from("doctor_chambers")
    .select(
      "id, position, public_note, practice_location_id, " +
        "practice_locations(name, address, district), " +
        "doctor_chamber_hours(weekday, starts_at, ends_at)",
    )
    .order("position");

  if (error || !data) return [];

  return (data as unknown as Record<string, unknown>[]).map((row) => {
    const loc = row.practice_locations as {
      name: string;
      address: string | null;
      district: string | null;
    } | null;
    const hours = (row.doctor_chamber_hours ?? []) as {
      weekday: number;
      starts_at: string;
      ends_at: string;
    }[];

    return {
      locationId: row.practice_location_id as string,
      name: loc?.name ?? "Chamber",
      addressLine: [loc?.address, loc?.district].filter(Boolean).join(", ") || null,
      district: loc?.district ?? null,
      publicNote: text(row.public_note),
      sessions: hours
        .map((h) => ({ weekday: h.weekday, startsAt: h.starts_at, endsAt: h.ends_at }))
        .sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt)),
    };
  });
}

/**
 * A SHORT-LIVED signed URL, generated per request.
 *
 * The bucket is private and stays private. Making it public would be the easy
 * way to render a portrait and the wrong one — it would put every doctor's
 * photo behind a guessable path forever, including doctors whose profile is
 * PRIVATE. Ninety seconds is enough to load a page.
 */
async function signPhoto(supabase: Client, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from("doctor-profile-photos")
    .createSignedUrl(path, 90);
  return error ? null : (data?.signedUrl ?? null);
}
