import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import {
  computeAge,
  findDuplicates,
  normalizeName,
  normalizePhone,
  type DuplicateCandidate,
  type DuplicateMatch,
} from "./identity";

/**
 * Patient reads.
 *
 * Every query goes through the user's RLS-scoped client, so ownership is
 * enforced by Postgres rather than by remembering to add a WHERE clause. The
 * owner filter is still written explicitly where it aids the query planner —
 * belt and braces, never braces alone.
 */

export interface PatientListItem {
  id: string;
  patientNumber: string;
  fullName: string;
  phone: string | null;
  sex: string;
  bloodGroup: string;
  /** Needed so a doctor-facing list can exclude a colleague's patients. */
  ownerDoctorId: string;
  ageYears: number | null;
  ageApproximate: boolean;
  lastSeenLocation: string | null;
  allergyCount: number;
  createdAt: string;
}

/** Today in the clinic's timezone — UTC would roll the date over six hours early. */
export function clinicToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(
    new Date(),
  );
}

/** The signed-in user's own doctor_profiles.id, or null if they are not a doctor. */
export async function getCurrentDoctorId(): Promise<string | null> {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("current_doctor_id");
  return (data as string | null) ?? null;
}

/**
 * Scalar columns shared by list and detail.
 *
 * Kept separate from the embeds on purpose: composing a detail select by
 * appending to a list select embeds the same relation twice, which PostgREST
 * rejects outright — and the resulting error is easy to swallow into a silent
 * "not found".
 */
const CORE_COLUMNS =
  "id, patient_number, full_name, phone, sex, blood_group, owner_doctor_id, dob, dob_precision," +
  " approx_age_years, age_recorded_on, created_at";

const LIST_COLUMNS =
  `${CORE_COLUMNS}, patient_allergies(id),` +
  " patient_location_links(practice_locations(id, name))";

const DETAIL_COLUMNS =
  `${CORE_COLUMNS}, email, address, district, weight_kg, height_cm,` +
  // Notes live in their own doctor-only table — RLS filters rows, not columns.
  " patient_private_notes(body)," +
  " patient_location_links(practice_locations(id, name))," +
  " patient_allergies(id, substance, severity, reaction, is_active)," +
  " patient_conditions(id, condition, status)," +
  " patient_medications(id, name, dose, source, stopped_on)," +
  " patient_alerts(id, severity, message, is_active)," +
  " patient_contacts(id, name, phone, relationship, type)";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toListItem(row: any, today: string): PatientListItem {
  const age = computeAge(
    {
      dob: row.dob,
      dobPrecision: row.dob_precision,
      approxAgeYears: row.approx_age_years,
      ageRecordedOn: row.age_recorded_on,
    },
    today,
  );

  const links = (row.patient_location_links ?? []) as any[];
  const lastSeen = links[0]?.practice_locations?.name ?? null;

  return {
    id: row.id,
    patientNumber: row.patient_number,
    fullName: row.full_name,
    phone: row.phone ?? null,
    sex: row.sex,
    bloodGroup: row.blood_group,
    ownerDoctorId: row.owner_doctor_id,
    ageYears: age.years,
    ageApproximate: age.isApproximate,
    lastSeenLocation: lastSeen,
    allergyCount: (row.patient_allergies ?? []).length,
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Search never "fails to empty".
 *
 * Returning [] on a database error tells the doctor "this patient is not
 * registered" — which is a different and dangerous statement from "search is
 * broken". They would go on to create a duplicate, or assume no history exists.
 */
export type SearchOutcome =
  | { ok: true; patients: PatientListItem[] }
  | { ok: false; reason: string };

/**
 * Search a doctor's own patients by number, phone or name.
 *
 * The query is normalised the same way the stored columns are, so "Md. Rahim"
 * finds "Rahim Hossain" and "+8801711000124" finds "01711000124". Backed by
 * trigram indexes, so the leading-wildcard ILIKE stays fast.
 */
export async function searchPatients(
  query: string,
  limit = 30,
  /**
   * Restrict to one doctor's repository, IN THE DATABASE.
   *
   * This has to be part of the query, not a filter applied to the result. RLS
   * legitimately shows a doctor their colleagues' patients at a shared location
   * (that is how reception works), so filtering after `limit` means six newer
   * colleague records can fill the page and hide every one of the doctor's own.
   */
  ownerDoctorId?: string | null,
): Promise<SearchOutcome> {
  const supabase = await createSupabaseServerClient();
  const today = clinicToday();
  const q = query.trim();

  let request = supabase
    .from("patients")
    .select(LIST_COLUMNS)
    .is("deleted_at", null);

  // Applied before ordering and limiting — it is part of WHERE, not a post-filter.
  if (ownerDoctorId) request = request.eq("owner_doctor_id", ownerDoctorId);

  request = request.order("created_at", { ascending: false }).limit(limit);

  if (q.length > 0) {
    const name = normalizeName(q);
    const phone = normalizePhone(q);
    const escaped = q.replace(/[%,()]/g, " ").trim();

    const clauses = [
      `patient_number.ilike.%${escaped}%`,
      `name_normalized.ilike.%${name || escaped}%`,
    ];
    if (phone) clauses.push(`phone_normalized.ilike.%${phone}%`);

    request = request.or(clauses.join(","));
  }

  const { data, error } = await request;
  if (error) {
    console.error("[patients] search failed", error.message);
    return { ok: false, reason: error.message };
  }
  return { ok: true, patients: (data ?? []).map((row) => toListItem(row, today)) };
}

/**
 * Recent patients for the dashboard.
 *
 * Returns the OUTCOME, not a bare array. Collapsing a failure to `[]` makes the
 * dashboard say "No patients yet — register your first patient", which is the
 * same lie as a zero count: an outage rendered as an empty repository.
 */
export async function getRecentPatients(
  limit = 20,
  ownerDoctorId?: string | null,
): Promise<SearchOutcome> {
  return searchPatients("", limit, ownerDoctorId);
}

export type CountOutcome = { ok: true; count: number } | { ok: false; reason: string };

/**
 * How many patients are in the repository.
 *
 * `count ?? 0` turned a failed query into "you have no patients". A genuine
 * zero and a broken query are different statements, and only one of them should
 * make a doctor think they have nothing on file.
 */
export async function getPatientCount(ownerDoctorId?: string | null): Promise<CountOutcome> {
  const supabase = await createSupabaseServerClient();

  let request = supabase
    .from("patients")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);

  if (ownerDoctorId) request = request.eq("owner_doctor_id", ownerDoctorId);

  const { count, error } = await request;

  if (error) {
    console.error("[patients] count failed", error.message);
    return { ok: false, reason: error.message };
  }
  // A successful query with no rows really is zero.
  return { ok: true, count: count ?? 0 };
}

/**
 * Possible duplicates for a patient about to be created.
 *
 * RLS confines candidates to the caller's own repository, so this can never
 * surface another doctor's patient — the check that ADR 0002 exists to protect.
 */
/**
 * Duplicate lookup FAILS CLOSED.
 *
 * If this query breaks and we return "no duplicates", the doctor is waved
 * through and a second record for the same person is created silently — the
 * exact outcome duplicate detection exists to prevent. Callers must block
 * creation when `ok` is false.
 */
export type DuplicateOutcome =
  | { ok: true; matches: DuplicateMatch[] }
  | { ok: false; reason: string };

export async function findPossibleDuplicates(input: {
  fullName: string;
  phone?: string | null;
  ageYears?: number | null;
  todayISO?: string;
}): Promise<DuplicateOutcome> {
  const supabase = await createSupabaseServerClient();
  const today = input.todayISO ?? clinicToday();

  const nameNormalized = normalizeName(input.fullName);
  const phoneNormalized = normalizePhone(input.phone);
  if (!nameNormalized && !phoneNormalized) return { ok: true, matches: [] };

  const firstToken = nameNormalized.split(" ")[0] ?? "";
  const clauses: string[] = [];
  if (phoneNormalized) clauses.push(`phone_normalized.eq.${phoneNormalized}`);
  if (firstToken.length >= 2) clauses.push(`name_normalized.ilike.%${firstToken}%`);
  if (clauses.length === 0) return { ok: true, matches: [] };

  const { data, error } = await supabase
    .from("patients")
    .select(
      "id, patient_number, full_name, name_normalized, phone_normalized," +
        " dob, dob_precision, approx_age_years, age_recorded_on",
    )
    .is("deleted_at", null)
    .or(clauses.join(","))
    .limit(40);

  if (error) {
    console.error("[patients] duplicate lookup failed", error.message);
    return { ok: false, reason: error.message };
  }
  if (!data) return { ok: false, reason: "no response" };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // PostgREST cannot infer a hand-written select string, so the row shape is
  // asserted here rather than fighting the generated types.
  const candidates: DuplicateCandidate[] = (data as unknown as any[]).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    nameNormalized: row.name_normalized,
    phoneNormalized: row.phone_normalized ?? null,
    patientNumber: row.patient_number,
    ageYears: computeAge(
      {
        dob: row.dob,
        dobPrecision: row.dob_precision,
        approxAgeYears: row.approx_age_years,
        ageRecordedOn: row.age_recorded_on,
      },
      today,
    ).years,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    ok: true,
    matches: findDuplicates(
      { nameNormalized, phoneNormalized, ageYears: input.ageYears ?? null },
      candidates,
    ),
  };
}

export interface PatientDetail extends PatientListItem {
  email: string | null;
  address: string | null;
  district: string | null;
  weightKg: string | null;
  heightCm: string | null;
  notes: string | null;
  dob: string | null;
  dobPrecision: string;
  allergies: { id: string; substance: string; severity: string; reaction: string | null }[];
  conditions: { id: string; condition: string; status: string }[];
  medications: { id: string; name: string; dose: string | null; source: string }[];
  alerts: { id: string; severity: string; message: string }[];
  contacts: { id: string; name: string; phone: string | null; relationship: string | null; type: string }[];
  locations: { id: string; name: string }[];
}

/** Full profile. Returns null when the patient is not the caller's — never a 404 vs 403 distinction. */
export async function getPatient(id: string): Promise<PatientDetail | null> {
  const supabase = await createSupabaseServerClient();
  const today = clinicToday();

  const { data, error } = await supabase
    .from("patients")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    // A malformed select or a policy change must not present as "not found" —
    // that is indistinguishable from a patient legitimately owned by someone
    // else, and it hid a real bug once already.
    console.error("[patients] getPatient failed", id, error.message);
    return null;
  }
  if (!data) return null;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const row = data as any;
  const base = toListItem(row, today);

  return {
    ...base,
    email: row.email ?? null,
    address: row.address ?? null,
    district: row.district ?? null,
    weightKg: row.weight_kg ?? null,
    heightCm: row.height_cm ?? null,
    notes: (row.patient_private_notes ?? [])[0]?.body ?? null,
    dob: row.dob ?? null,
    dobPrecision: row.dob_precision,
    allergies: (row.patient_allergies ?? [])
      .filter((a: any) => a.is_active !== false)
      .map((a: any) => ({
        id: a.id, substance: a.substance, severity: a.severity, reaction: a.reaction ?? null,
      })),
    conditions: (row.patient_conditions ?? []).map((c: any) => ({
      id: c.id, condition: c.condition, status: c.status,
    })),
    medications: (row.patient_medications ?? [])
      .filter((m: any) => !m.stopped_on)
      .map((m: any) => ({ id: m.id, name: m.name, dose: m.dose ?? null, source: m.source })),
    alerts: (row.patient_alerts ?? [])
      .filter((a: any) => a.is_active !== false)
      .map((a: any) => ({ id: a.id, severity: a.severity, message: a.message })),
    contacts: (row.patient_contacts ?? []).map((c: any) => ({
      id: c.id, name: c.name, phone: c.phone ?? null,
      relationship: c.relationship ?? null, type: c.type,
    })),
    locations: (row.patient_location_links ?? [])
      .map((l: any) => l.practice_locations)
      .filter(Boolean)
      .map((l: any) => ({ id: l.id ?? l.name, name: l.name })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

