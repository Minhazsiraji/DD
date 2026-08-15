import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, getMemberships } from "@/lib/auth/session";
import type { TemplateSettings } from "./schema";

/**
 * Reads for doctor identity, chamber details and prescription templates.
 *
 * Everything here is RLS-scoped to the caller: templates to the owning doctor,
 * signature objects to the owner's folder in a private bucket.
 */

export const SIGNATURE_BUCKET = "doctor-assets";

export interface DoctorIdentity {
  doctorId: string | null;
  userId: string;
  fullName: string;
  phone: string | null;
  qualification: string | null;
  specialization: string | null;
  designation: string | null;
  bmdcRegistrationNo: string | null;
  /** Storage PATH, not a URL. Render it via `getSignatureUrl`. */
  signaturePath: string | null;
  patientNumberPrefix: string;
  patientNumberSeq: number;
}

export async function getDoctorIdentity(): Promise<DoctorIdentity> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const [{ data: profile }, { data: doctor }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
    supabase
      .from("doctor_profiles")
      .select(
        "id, qualification, specialization, designation, bmdc_registration_no, signature_url, patient_number_prefix, patient_number_seq",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return {
    doctorId: (doctor?.id as string) ?? null,
    userId: user.id,
    fullName: (profile?.full_name as string) ?? "",
    phone: (profile?.phone as string | null) ?? null,
    qualification: (doctor?.qualification as string | null) ?? null,
    specialization: (doctor?.specialization as string | null) ?? null,
    designation: (doctor?.designation as string | null) ?? null,
    bmdcRegistrationNo: (doctor?.bmdc_registration_no as string | null) ?? null,
    signaturePath: (doctor?.signature_url as string | null) ?? null,
    patientNumberPrefix: (doctor?.patient_number_prefix as string) ?? "PT",
    patientNumberSeq: (doctor?.patient_number_seq as number) ?? 0,
  };
}

/**
 * A short-lived signed URL for the signature.
 *
 * The bucket is private, so there is no permanent URL to store — and that is
 * deliberate. A signature is a reusable authorisation mark; a link that never
 * expires is a link that eventually leaks.
 */
export async function getSignatureUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (error) {
    console.error("[doctor] signature signed url failed", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

export interface LocationDetails {
  id: string;
  name: string;
  type: "PERSONAL_CHAMBER" | "CLINIC" | "HOSPITAL" | "TELEMEDICINE" | "OTHER";
  address: string | null;
  district: string | null;
  phone: string | null;
  canEdit: boolean;
  /** Practises here AS A DOCTOR — required to scope a template to this place. */
  isDoctorHere: boolean;
}

/** Every place this doctor practises, with the chamber details that print. */
export async function getPracticeLocations(): Promise<LocationDetails[]> {
  const memberships = await getMemberships();
  if (memberships.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("practice_locations")
    .select("id, name, type, address, district, phone")
    .in(
      "id",
      memberships.map((m) => m.locationId),
    );

  return memberships.map((m) => {
    const row = data?.find((r) => r.id === m.locationId);
    return {
      id: m.locationId,
      name: (row?.name as string) ?? m.locationName,
      type: (row?.type as LocationDetails["type"]) ?? "CLINIC",
      address: (row?.address as string | null) ?? null,
      district: (row?.district as string | null) ?? null,
      phone: (row?.phone as string | null) ?? null,
      // Only a LOCATION_ADMIN may edit; RLS enforces the same rule.
      canEdit: m.roles.includes("LOCATION_ADMIN"),
      isDoctorHere: m.roles.includes("DOCTOR"),
    };
  });
}

const TEMPLATE_COLUMNS =
  "id, name, practice_location_id, is_default, paper_size, margin_mm, base_font_pt, " +
  "show_header, show_clinic_logo, clinic_name_override, header_note, " +
  "show_qualification, show_specialization, show_designation, show_bmdc, " +
  "show_chamber_address, show_chamber_phone, show_footer, footer_text, show_signature";

type TemplateRow = Record<string, unknown>;

function toSettings(row: TemplateRow): TemplateSettings {
  return {
    id: row.id as string,
    name: row.name as string,
    practiceLocationId: (row.practice_location_id as string | null) ?? null,
    isDefault: Boolean(row.is_default),
    paperSize: (row.paper_size as "A4" | "A5") ?? "A4",
    marginMm: (row.margin_mm as number) ?? 15,
    baseFontPt: (row.base_font_pt as number) ?? 11,
    showHeader: Boolean(row.show_header),
    showClinicLogo: Boolean(row.show_clinic_logo),
    clinicNameOverride: (row.clinic_name_override as string | null) ?? null,
    headerNote: (row.header_note as string | null) ?? null,
    showQualification: Boolean(row.show_qualification),
    showSpecialization: Boolean(row.show_specialization),
    showDesignation: Boolean(row.show_designation),
    showBmdc: Boolean(row.show_bmdc),
    showChamberAddress: Boolean(row.show_chamber_address),
    showChamberPhone: Boolean(row.show_chamber_phone),
    showFooter: Boolean(row.show_footer),
    footerText: (row.footer_text as string | null) ?? null,
    showSignature: Boolean(row.show_signature),
  };
}

/**
 * Fail-closed list. An empty array and a failed read are NOT the same thing —
 * showing "no templates yet" after a broken query would invite the doctor to
 * create a duplicate of one they already have.
 */
export type TemplateListOutcome =
  | { ok: true; templates: TemplateSettings[] }
  | { ok: false; reason: string };

export async function listTemplates(): Promise<TemplateListOutcome> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("prescription_templates")
    .select(TEMPLATE_COLUMNS)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("[doctor] listTemplates failed", error.message);
    return { ok: false, reason: error.message };
  }
  // The select list is built from a constant, so PostgREST's type inference
  // cannot see the shape — toSettings is the single place that reads it.
  const rows = (data ?? []) as unknown as TemplateRow[];
  return { ok: true, templates: rows.map(toSettings) };
}

export async function getTemplate(id: string): Promise<TemplateSettings | null> {
  await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("prescription_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[doctor] getTemplate failed", error.message);
    return null;
  }
  return data ? toSettings(data as unknown as TemplateRow) : null;
}
