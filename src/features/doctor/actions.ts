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
import { BMDC_TAKEN_MESSAGE, isBmdcCollision } from "./identity";

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

  /**
   * ONE transaction. This was previously two writes — `profiles` then
   * `doctor_profiles` — so a failure on the second left the doctor's NAME
   * changed while their qualifications and BMDC number did not. That is a split
   * professional identity, and it prints on prescriptions.
   */
  const { data, error } = await supabase
    .rpc("update_doctor_identity", {
      p_full_name: v.fullName,
      p_phone: empty(formData.get("phone")),
      p_qualification: empty(formData.get("qualification")),
      p_specialization: empty(formData.get("specialization")),
      p_designation: empty(formData.get("designation")),
      p_bmdc_registration_no: empty(formData.get("bmdcRegistrationNo")),
      p_patient_number_prefix: v.patientNumberPrefix,
    })
    .single();

  const result = data as
    | { doctor_id: string; created: boolean; prefix_changed: boolean }
    | null;

  if (error || !result?.doctor_id) {
    /**
     * A registration number already held by someone else is an ordinary,
     * correctable mistake — not an outage. Without this the doctor was shown
     * the raw Postgres text, which names an index and explains nothing.
     */
    if (isBmdcCollision(error)) {
      return { ok: false, fieldErrors: { bmdcRegistrationNo: [BMDC_TAKEN_MESSAGE] } };
    }
    return {
      ok: false,
      message: `Could not save your details: ${error?.message ?? "unknown error"}`,
    };
  }

  await emitAudit({
    action: result.created ? "doctor_profile.created" : "doctor_profile.updated",
    resourceType: "doctor_profile",
    resourceId: result.doctor_id,
    actorId: user.id,
    // Field names only.
    meta: { fields: ["identity"], prefixChanged: result.prefix_changed },
  });

  revalidatePath("/settings/profile");
  revalidatePath("/settings/prescription");
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: result.prefix_changed
      ? "Saved. The new patient-number prefix applies to patients you register from now on — existing numbers are unchanged."
      : "Saved.",
  };
}

const ALLOWED_SIGNATURE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

type StorageClient = Awaited<ReturnType<typeof createSupabaseServerClient>>["storage"];

/**
 * Delete a stored object and say what ACTUALLY happened.
 *
 * `remove()` cannot be trusted on its own: a delete blocked by RLS removes
 * nothing and returns an empty list with no error, so "no error" is not "gone".
 * When nothing came back we look the object up to tell the two cases apart —
 * still there (refuse) versus already absent (a stale reference we may clear).
 */
async function deleteStoredObject(
  storage: StorageClient,
  path: string,
): Promise<{ outcome: "deleted" | "already-absent" | "still-present"; reason?: string }> {
  const bucket = storage.from(SIGNATURE_BUCKET);
  const { data: removed, error } = await bucket.remove([path]);

  if (!error && removed && removed.length > 0) return { outcome: "deleted" };

  const slash = path.lastIndexOf("/");
  const folder = slash === -1 ? "" : path.slice(0, slash);
  const filename = path.slice(slash + 1);

  const { data: found, error: listError } = await bucket.list(folder, {
    search: filename,
    limit: 100,
  });

  if (listError) {
    // Cannot prove it is gone, so treat it as present. Wrongly claiming a
    // signature was destroyed is the failure that matters.
    return { outcome: "still-present", reason: error?.message ?? listError.message };
  }

  const exists = (found ?? []).some((o) => o.name === filename);
  if (exists) return { outcome: "still-present", reason: error?.message };

  return { outcome: "already-absent" };
}

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

  /**
   * The replaced image is now unreferenced. Deleting it is best-effort — the new
   * signature is already saved and correct, so failing the upload here would be
   * wrong — but it is NOT silent: an old signature left in storage is a
   * reusable authorisation mark nobody is tracking.
   */
  const previous = doctor.signature_url as string | null;
  if (previous && previous !== path) {
    const { outcome, reason } = await deleteStoredObject(supabase.storage, previous);
    if (outcome === "still-present") {
      console.error(
        "[doctor] replaced signature NOT deleted, still in storage",
        previous,
        reason ?? "",
      );
    }
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

/**
 * Remove the signature.
 *
 * Order matters and so does reporting. Deleting the STORED OBJECT first means
 * the database reference is cleared only once the image is actually gone — the
 * reverse order can leave an orphaned signature image with nothing pointing at
 * it, which for a reusable authorisation mark is the worse failure.
 *
 * Both steps are checked and surfaced. This previously returned void and
 * ignored every error, so the UI could report success while the signature still
 * existed.
 */
// Takes no arguments: useActionState still passes (prevState, formData), and
// this action needs neither — the target is whatever signature the caller owns.
export async function removeSignatureAction(): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data: doctor, error: readError } = await supabase
    .from("doctor_profiles")
    .select("id, signature_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (readError) {
    return { ok: false, message: `Could not check your signature: ${readError.message}` };
  }
  if (!doctor) {
    return { ok: false, message: "No doctor profile found." };
  }

  const path = doctor.signature_url as string | null;
  if (!path) {
    return { ok: true, message: "There was no signature to remove." };
  }

  const { outcome, reason } = await deleteStoredObject(supabase.storage, path);

  if (outcome === "still-present") {
    return {
      ok: false,
      message:
        "Your signature image could NOT be deleted" +
        (reason ? ` (${reason})` : "") +
        ", so it is still stored and still in use. Nothing was changed — please try again.",
    };
  }

  /**
   * `already-absent` is the recovery path, not an error.
   *
   * If a previous attempt deleted the image but failed to clear this column,
   * the profile is left pointing at nothing. Refusing to clear a reference just
   * because the object is missing would strand the doctor permanently: the
   * image can never come back, so the retry could never succeed.
   */

  const { error: clearError } = await supabase
    .from("doctor_profiles")
    .update({ signature_url: null, updated_at: new Date().toISOString() })
    .eq("id", doctor.id);

  if (clearError) {
    return {
      ok: false,
      message:
        `The image was deleted but your profile still refers to it (${clearError.message}). ` +
        "Your prescriptions may show a missing signature until you press Remove again.",
    };
  }

  await emitAudit({
    action: "doctor_profile.signature_removed",
    resourceType: "doctor_profile",
    resourceId: doctor.id as string,
    actorId: user.id,
    meta: { staleReference: outcome === "already-absent" },
  });

  revalidatePath("/settings/profile");
  revalidatePath("/settings/prescription");
  return {
    ok: true,
    message:
      outcome === "already-absent"
        ? "That signature image was already gone, so the leftover reference has been cleared."
        : "Signature removed.",
  };
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

  /**
   * A location-scoped template requires an active DOCTOR role AT that location
   * — not merely some membership. Checking for any membership would let a
   * doctor who is only RECEPTIONIST at a hospital attach a prescription layout
   * carrying their name and BMDC number to a place they do not practise at as a
   * doctor. RLS re-checks this via may_scope_template_to(); the check here
   * exists to give a sentence instead of a policy error.
   */
  const locationId: string | null = rawLocation.length > 0 ? rawLocation : null;
  if (locationId) {
    const memberships = await getMemberships();
    const membership = memberships.find((m) => m.locationId === locationId);

    if (!membership) {
      return { ok: false, message: "You don't practise there." };
    }
    if (!membership.roles.includes("DOCTOR")) {
      return {
        ok: false,
        message:
          "You can only set up prescription paper for a place where you practise as a doctor.",
      };
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
