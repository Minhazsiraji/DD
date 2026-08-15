"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, requireLocationContext, getMemberships } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import type { ActionState } from "@/features/auth/schema";
import {
  doctorProfileSchema,
  locationDetailsSchema,
  templateSchema,
  type TemplateActionState,
} from "./schema";
import { SIGNATURE_BUCKET } from "./queries";

/**
 * Doctor identity, chamber details and prescription-template writes.
 *
 * NOTE: "use server" files may export only async functions — the Zod schemas
 * live in ./schema.ts for that reason.
 */

const empty = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

const on = (v: FormDataEntryValue | null) => v === "on" || v === "true";

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export async function updateDoctorProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = doctorProfileSchema.safeParse({
    fullName: formData.get("fullName"),
    qualification: formData.get("qualification") ?? "",
    specialization: formData.get("specialization") ?? "",
    designation: formData.get("designation") ?? "",
    bmdcRegistrationNo: formData.get("bmdcRegistrationNo") ?? "",
    phone: formData.get("phone") ?? "",
    patientNumberPrefix: formData.get("patientNumberPrefix") ?? "PT",
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: v.fullName, phone: empty(formData.get("phone")), updated_at: now })
    .eq("id", user.id);

  if (profileError) {
    return { ok: false, message: `Could not save your name: ${profileError.message}` };
  }

  /**
   * The doctor row may not exist yet (a receptionist-only account has none), so
   * this upserts on user_id rather than assuming a row. `patient_number_seq` is
   * deliberately NOT written here — it is owned by the numbering function and
   * overwriting it would re-issue numbers that already exist on paper.
   */
  const { data: existing } = await supabase
    .from("doctor_profiles")
    .select("id, patient_number_prefix")
    .eq("user_id", user.id)
    .maybeSingle();

  const fields = {
    qualification: empty(formData.get("qualification")),
    specialization: empty(formData.get("specialization")),
    designation: empty(formData.get("designation")),
    bmdc_registration_no: empty(formData.get("bmdcRegistrationNo")),
    patient_number_prefix: v.patientNumberPrefix,
    updated_at: now,
  };

  const { error: doctorError } = existing
    ? await supabase.from("doctor_profiles").update(fields).eq("id", existing.id)
    : await supabase.from("doctor_profiles").insert({ user_id: user.id, ...fields });

  if (doctorError) {
    return { ok: false, message: `Could not save your details: ${doctorError.message}` };
  }

  await emitAudit({
    action: existing ? "doctor_profile.updated" : "doctor_profile.created",
    resourceType: "doctor_profile",
    resourceId: existing?.id ?? null,
    actorId: user.id,
    // Field names only.
    meta: {
      fields: ["identity"],
      prefixChanged: Boolean(existing) && existing?.patient_number_prefix !== v.patientNumberPrefix,
    },
  });

  revalidatePath("/settings/profile");
  revalidatePath("/settings/prescription");
  revalidatePath("/dashboard");

  return {
    ok: true,
    message:
      Boolean(existing) && existing?.patient_number_prefix !== v.patientNumberPrefix
        ? "Saved. The new patient-number prefix applies to patients you register from now on — existing numbers are unchanged."
        : "Saved.",
  };
}

const ALLOWED_SIGNATURE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

export async function uploadSignatureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const file = formData.get("signature");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an image of your signature first." };
  }
  if (!ALLOWED_SIGNATURE_TYPES.includes(file.type)) {
    return { ok: false, message: "Use a PNG, JPG or WebP image." };
  }
  if (file.size > MAX_SIGNATURE_BYTES) {
    return { ok: false, message: "That image is over 2 MB. Use a smaller one." };
  }

  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data: doctor } = await supabase
    .from("doctor_profiles")
    .select("id, signature_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!doctor) {
    return { ok: false, message: "Save your doctor details first, then add a signature." };
  }

  /**
   * A fresh path each time rather than overwriting. Overwriting leaves stale
   * copies cached against the old URL, and a signature that renders as the
   * previous one is worse than no signature at all.
   *
   * The first path segment MUST be the user id — that is what storage RLS
   * checks. See supabase/policies/0005.
   */
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/signature-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { ok: false, message: `Could not upload it: ${uploadError.message}` };
  }

  const { error: linkError } = await supabase
    .from("doctor_profiles")
    .update({ signature_url: path, updated_at: new Date().toISOString() })
    .eq("id", doctor.id);

  if (linkError) {
    // Don't leave an orphan behind if we could not point at it.
    await supabase.storage.from(SIGNATURE_BUCKET).remove([path]);
    return { ok: false, message: `Could not save it: ${linkError.message}` };
  }

  const previous = doctor.signature_url as string | null;
  if (previous && previous !== path) {
    await supabase.storage.from(SIGNATURE_BUCKET).remove([previous]);
  }

  await emitAudit({
    action: "doctor_profile.signature_set",
    resourceType: "doctor_profile",
    resourceId: doctor.id as string,
    actorId: user.id,
    meta: { replaced: Boolean(previous) },
  });

  revalidatePath("/settings/profile");
  revalidatePath("/settings/prescription");
  return { ok: true, message: "Signature saved." };
}

export async function removeSignatureAction(): Promise<void> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data: doctor } = await supabase
    .from("doctor_profiles")
    .select("id, signature_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!doctor?.signature_url) return;

  await supabase
    .from("doctor_profiles")
    .update({ signature_url: null, updated_at: new Date().toISOString() })
    .eq("id", doctor.id);

  await supabase.storage.from(SIGNATURE_BUCKET).remove([doctor.signature_url as string]);

  await emitAudit({
    action: "doctor_profile.signature_removed",
    resourceType: "doctor_profile",
    resourceId: doctor.id as string,
    actorId: user.id,
  });

  revalidatePath("/settings/profile");
  revalidatePath("/settings/prescription");
}

// ---------------------------------------------------------------------------
// Chamber / contact details
// ---------------------------------------------------------------------------

export async function updateLocationDetailsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = locationDetailsSchema.safeParse({
    locationId: formData.get("locationId"),
    name: formData.get("name"),
    type: formData.get("type"),
    address: formData.get("address") ?? "",
    district: formData.get("district") ?? "",
    phone: formData.get("phone") ?? "",
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const user = await requireUser();

  /**
   * Check membership before writing. RLS would reject it anyway, but a plain
   * "you don't administer this place" beats a Postgres policy error, and it
   * stops a forged locationId from even reaching the database.
   */
  const memberships = await getMemberships();
  const membership = memberships.find((m) => m.locationId === v.locationId);

  if (!membership) return { ok: false, message: "You don't practise there." };
  if (!membership.roles.includes("LOCATION_ADMIN")) {
    return { ok: false, message: "Only an administrator of this place can change its details." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("practice_locations")
    .update({
      name: v.name,
      type: v.type,
      address: empty(formData.get("address")),
      district: empty(formData.get("district")),
      phone: empty(formData.get("phone")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", v.locationId);

  if (error) return { ok: false, message: `Could not save it: ${error.message}` };

  await emitAudit({
    action: "location.updated",
    resourceType: "practice_location",
    resourceId: v.locationId,
    locationId: v.locationId,
    actorId: user.id,
    meta: { fields: ["details"] },
  });

  revalidatePath("/settings/profile");
  revalidatePath("/settings");
  revalidatePath("/settings/prescription");
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Prescription templates (layout only — no prescription engine yet)
// ---------------------------------------------------------------------------

function templateRow(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    paper_size: String(formData.get("paperSize") ?? "A4"),
    margin_mm: Number(formData.get("marginMm") ?? 15),
    base_font_pt: Number(formData.get("baseFontPt") ?? 11),
    show_header: on(formData.get("showHeader")),
    show_clinic_logo: on(formData.get("showClinicLogo")),
    clinic_name_override: empty(formData.get("clinicNameOverride")),
    header_note: empty(formData.get("headerNote")),
    show_qualification: on(formData.get("showQualification")),
    show_specialization: on(formData.get("showSpecialization")),
    show_designation: on(formData.get("showDesignation")),
    show_bmdc: on(formData.get("showBmdc")),
    show_chamber_address: on(formData.get("showChamberAddress")),
    show_chamber_phone: on(formData.get("showChamberPhone")),
    show_footer: on(formData.get("showFooter")),
    footer_text: empty(formData.get("footerText")),
    show_signature: on(formData.get("showSignature")),
    updated_at: new Date().toISOString(),
  };
}

export async function saveTemplateAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const rawLocation = String(formData.get("practiceLocationId") ?? "");

  const parsed = templateSchema.safeParse({
    templateId: formData.get("templateId") || undefined,
    name: formData.get("name"),
    practiceLocationId: rawLocation,
    paperSize: formData.get("paperSize") ?? "A4",
    marginMm: formData.get("marginMm") ?? 15,
    baseFontPt: formData.get("baseFontPt") ?? 11,
    showHeader: on(formData.get("showHeader")),
    showClinicLogo: on(formData.get("showClinicLogo")),
    clinicNameOverride: formData.get("clinicNameOverride") ?? "",
    headerNote: formData.get("headerNote") ?? "",
    showQualification: on(formData.get("showQualification")),
    showSpecialization: on(formData.get("showSpecialization")),
    showDesignation: on(formData.get("showDesignation")),
    showBmdc: on(formData.get("showBmdc")),
    showChamberAddress: on(formData.get("showChamberAddress")),
    showChamberPhone: on(formData.get("showChamberPhone")),
    showFooter: on(formData.get("showFooter")),
    footerText: formData.get("footerText") ?? "",
    showSignature: on(formData.get("showSignature")),
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data: doctorId } = await supabase.rpc("current_doctor_id");
  if (!doctorId) {
    return { ok: false, message: "Complete your doctor details first, then set up a template." };
  }

  // A location-scoped template is only meaningful where the doctor practises.
  const locationId: string | null = rawLocation.length > 0 ? rawLocation : null;
  if (locationId) {
    const memberships = await getMemberships();
    if (!memberships.some((m) => m.locationId === locationId)) {
      return { ok: false, message: "You don't practise there." };
    }
  }

  const row = templateRow(formData);
  const existingId = String(formData.get("templateId") ?? "");

  if (existingId) {
    const { error } = await supabase
      .from("prescription_templates")
      .update({ ...row, practice_location_id: locationId })
      .eq("id", existingId);

    if (error) return { ok: false, message: `Could not save it: ${error.message}` };

    await emitAudit({
      action: "prescription_template.updated",
      resourceType: "prescription_template",
      resourceId: existingId,
      locationId,
      actorId: user.id,
    });

    revalidatePath("/settings/prescription");
    return { ok: true, message: "Template saved.", templateId: existingId };
  }

  /**
   * The doctor's very first template becomes the default, because a doctor who
   * sets one up and never notices a "make default" toggle should still get it
   * on their prescriptions.
   */
  const { count } = await supabase
    .from("prescription_templates")
    .select("id", { count: "exact", head: true });

  const { data: created, error } = await supabase
    .from("prescription_templates")
    .insert({
      ...row,
      owner_doctor_id: doctorId,
      practice_location_id: locationId,
      is_default: (count ?? 0) === 0,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, message: `Could not save it: ${error?.message ?? "unknown error"}` };
  }

  await emitAudit({
    action: "prescription_template.created",
    resourceType: "prescription_template",
    resourceId: created.id as string,
    locationId,
    actorId: user.id,
  });

  revalidatePath("/settings/prescription");
  return { ok: true, message: "Template saved.", templateId: created.id as string };
}

/**
 * Set-default and delete share one action, and therefore one message slot.
 *
 * Two separate `useActionState` hooks each remember their own last message
 * forever, so deleting a template still showed "Default updated." from an
 * earlier click — and a failed delete would have been hidden behind it.
 */
export async function templateListAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return formData.get("intent") === "delete"
    ? deleteTemplate(formData)
    : setDefaultTemplate(formData);
}

async function setDefaultTemplate(formData: FormData): Promise<ActionState> {
  const id = String(formData.get("templateId") ?? "");
  if (!id) return { ok: false, message: "Missing template." };

  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  /**
   * One RPC, one transaction. Clearing the old default and setting the new one
   * as two round trips can leave a doctor with no default at all if the second
   * fails — and the database enforces "at most one" with a partial unique index,
   * so the order matters.
   */
  const { error } = await supabase.rpc("set_default_template", { target_template: id });
  if (error) return { ok: false, message: `Could not set it: ${error.message}` };

  await emitAudit({
    action: "prescription_template.default_set",
    resourceType: "prescription_template",
    resourceId: id,
    actorId: user.id,
  });

  revalidatePath("/settings/prescription");
  return { ok: true, message: "Default updated." };
}

async function deleteTemplate(formData: FormData): Promise<ActionState> {
  const id = String(formData.get("templateId") ?? "");
  if (!id) return { ok: false, message: "Missing template." };

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  // Audit the id the database actually deleted, not the one that was submitted.
  const { data: removed, error } = await supabase
    .from("prescription_templates")
    .delete()
    .eq("id", id)
    .select("id, is_default")
    .maybeSingle();

  if (error) return { ok: false, message: `Could not delete it: ${error.message}` };
  if (!removed) return { ok: false, message: "That template no longer exists." };

  await emitAudit({
    action: "prescription_template.deleted",
    resourceType: "prescription_template",
    resourceId: removed.id as string,
    locationId: ctx.locationId,
    actorId: user.id,
    meta: { wasDefault: Boolean(removed.is_default) },
  });

  revalidatePath("/settings/prescription");
  return {
    ok: true,
    message: removed.is_default
      ? "Template deleted. Pick a new default."
      : "Template deleted.",
  };
}
