"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, requireLocationContext } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import type { ActionState } from "@/features/auth/schema";
import { patientFormSchema, splitList } from "./schema";
import { normalizeName, normalizePhone, computeAge } from "./identity";
import { clinicToday, findPossibleDuplicates, getCurrentDoctorId } from "./queries";
import type { DuplicateMatch } from "./identity";

/**
 * Patient writes.
 *
 * Ownership is never taken from the form. `owner_doctor_id` comes from the
 * session's own doctor profile, and RLS re-checks it — a client cannot create a
 * patient inside somebody else's repository even by forging the payload.
 */

export interface PatientActionState extends ActionState {
  duplicates?: DuplicateMatch[];
  patientId?: string;
  /**
   * Everything the doctor typed, echoed back.
   *
   * React resets an uncontrolled form once its action completes, so without
   * this a duplicate warning or a validation error would wipe the whole form
   * and make the doctor retype it — worst of all in the duplicate flow, which
   * is precisely where they need to compare what they entered against an
   * existing record.
   */
  values?: Record<string, string>;
}

/** Raw submitted values, minus anything not worth echoing back. */
function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  }
  return out;
}

const empty = (v: string | undefined | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

function parseForm(formData: FormData) {
  return patientFormSchema.safeParse({
    fullName: formData.get("fullName"),
    ageMode: formData.get("ageMode") ?? "AGE",
    dob: formData.get("dob") ?? "",
    approxAgeYears: formData.get("approxAgeYears") || undefined,
    sex: formData.get("sex") ?? "UNKNOWN",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    address: formData.get("address") ?? "",
    district: formData.get("district") ?? "",
    bloodGroup: formData.get("bloodGroup") ?? "UNKNOWN",
    weightKg: formData.get("weightKg") || undefined,
    heightCm: formData.get("heightCm") || undefined,
    emergencyContactName: formData.get("emergencyContactName") ?? "",
    emergencyContactPhone: formData.get("emergencyContactPhone") ?? "",
    emergencyContactRelationship: formData.get("emergencyContactRelationship") ?? "",
    allergies: formData.get("allergies") ?? "",
    conditions: formData.get("conditions") ?? "",
    medications: formData.get("medications") ?? "",
    alerts: formData.get("alerts") ?? "",
    notes: formData.get("notes") ?? "",
    confirmedNotDuplicate: formData.get("confirmedNotDuplicate") === "on",
  });
}

export async function createPatientAction(
  _prev: PatientActionState,
  formData: FormData,
): Promise<PatientActionState> {
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      values: echo(formData),
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }
  const v = parsed.data;

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const doctorId = await getCurrentDoctorId();

  if (!doctorId) {
    return {
      ok: false,
      values: echo(formData),
      message: "Only a doctor can register patients. Complete your doctor profile first.",
    };
  }

  const today = clinicToday();
  const isDob = v.ageMode === "DOB";
  const ageYears = computeAge(
    {
      dob: isDob ? v.dob : null,
      dobPrecision: isDob ? "DAY" : "AGE_ONLY",
      approxAgeYears: isDob ? null : (v.approxAgeYears ?? null),
      ageRecordedOn: today,
    },
    today,
  ).years;

  /**
   * Warn once, then respect the doctor's judgement. Two different people
   * genuinely share a name and a household phone, so this must never block or
   * auto-merge — it surfaces the candidates and lets a human decide.
   */
  if (!v.confirmedNotDuplicate) {
    const duplicates = await findPossibleDuplicates({
      fullName: v.fullName,
      phone: v.phone,
      ageYears,
    });
    if (duplicates.length > 0) {
      return {
        ok: false,
        duplicates,
        values: echo(formData),
        message: "This may already be one of your patients. Check before continuing.",
      };
    }
  }

  const supabase = await createSupabaseServerClient();

  // Atomic — a read-then-write would issue duplicate numbers under concurrency.
  const { data: numberData, error: numberError } = await supabase.rpc(
    "next_patient_number",
    { target_doctor: doctorId },
  );
  if (numberError || !numberData) {
    return { ok: false, values: echo(formData), message: `Could not allocate a patient number: ${numberError?.message ?? "unknown"}` };
  }

  const { data: patient, error } = await supabase
    .from("patients")
    .insert({
      owner_doctor_id: doctorId,
      patient_number: numberData as string,
      full_name: v.fullName,
      name_normalized: normalizeName(v.fullName),
      dob: isDob ? v.dob : null,
      dob_precision: isDob ? "DAY" : "AGE_ONLY",
      approx_age_years: isDob ? null : (v.approxAgeYears ?? null),
      age_recorded_on: isDob ? null : today,
      sex: v.sex,
      phone: empty(v.phone),
      phone_normalized: normalizePhone(v.phone),
      email: empty(v.email),
      address: empty(v.address),
      district: empty(v.district),
      blood_group: v.bloodGroup,
      weight_kg: v.weightKg ?? null,
      height_cm: v.heightCm ?? null,
      notes: empty(v.notes),
      created_by: user.id,
    })
    .select("id, patient_number, full_name")
    .single();

  if (error || !patient) {
    return { ok: false, values: echo(formData), message: `Could not save the patient: ${error?.message ?? "unknown"}` };
  }

  // Link to the location the doctor is currently working from. This is what
  // scopes staff access without exposing a private chamber.
  await supabase.from("patient_location_links").insert({
    patient_id: patient.id,
    practice_location_id: ctx.locationId,
  });

  const allergies = splitList(v.allergies);
  const conditions = splitList(v.conditions);
  const medications = splitList(v.medications);
  const alerts = splitList(v.alerts);

  if (allergies.length) {
    await supabase.from("patient_allergies").insert(
      allergies.map((substance) => ({
        patient_id: patient.id,
        substance,
        recorded_by: user.id,
      })),
    );
  }
  if (conditions.length) {
    await supabase
      .from("patient_conditions")
      .insert(conditions.map((condition) => ({ patient_id: patient.id, condition })));
  }
  if (medications.length) {
    await supabase.from("patient_medications").insert(
      medications.map((name) => ({ patient_id: patient.id, name, source: "REPORTED" })),
    );
  }
  if (alerts.length) {
    await supabase.from("patient_alerts").insert(
      alerts.map((message) => ({
        patient_id: patient.id,
        message,
        created_by: user.id,
      })),
    );
  }

  if (empty(v.emergencyContactName)) {
    await supabase.from("patient_contacts").insert({
      patient_id: patient.id,
      type: "EMERGENCY",
      name: v.emergencyContactName as string,
      phone: empty(v.emergencyContactPhone),
      relationship: empty(v.emergencyContactRelationship),
      is_primary: true,
    });
  }

  // Counts only — never the clinical values themselves.
  await emitAudit({
    action: "patient.created",
    resourceType: "patient",
    resourceId: patient.id,
    locationId: ctx.locationId,
    actorId: user.id,
    meta: {
      allergies: allergies.length,
      conditions: conditions.length,
      medications: medications.length,
      alerts: alerts.length,
      overrodeDuplicateWarning: Boolean(v.confirmedNotDuplicate),
    },
  });

  revalidatePath("/patients");
  redirect(`/patients/${patient.id}`);
}

export async function updatePatientAction(
  _prev: PatientActionState,
  formData: FormData,
): Promise<PatientActionState> {
  const id = String(formData.get("patientId") ?? "");
  if (!id) return { ok: false, message: "Missing patient." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      values: echo(formData),
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }
  const v = parsed.data;

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const today = clinicToday();
  const isDob = v.ageMode === "DOB";

  const { error } = await supabase
    .from("patients")
    .update({
      full_name: v.fullName,
      name_normalized: normalizeName(v.fullName),
      dob: isDob ? v.dob : null,
      dob_precision: isDob ? "DAY" : "AGE_ONLY",
      approx_age_years: isDob ? null : (v.approxAgeYears ?? null),
      age_recorded_on: isDob ? null : today,
      sex: v.sex,
      phone: empty(v.phone),
      phone_normalized: normalizePhone(v.phone),
      email: empty(v.email),
      address: empty(v.address),
      district: empty(v.district),
      blood_group: v.bloodGroup,
      weight_kg: v.weightKg ?? null,
      height_cm: v.heightCm ?? null,
      notes: empty(v.notes),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return { ok: false, values: echo(formData), message: `Could not update the patient: ${error.message}` };
  }

  await emitAudit({
    action: "patient.updated",
    resourceType: "patient",
    resourceId: id,
    locationId: ctx.locationId,
    actorId: user.id,
    // Field NAMES only — never the values.
    meta: { fields: ["demographics"] },
  });

  revalidatePath(`/patients/${id}`);
  revalidatePath("/patients");
  return { ok: true, message: "Patient updated.", patientId: id };
}

/** Records that a patient record was opened. Required for a clinical audit trail. */
export async function recordPatientViewAction(patientId: string): Promise<void> {
  const user = await requireUser();
  const ctx = await requireLocationContext();
  await emitAudit({
    action: "patient.viewed",
    resourceType: "patient",
    resourceId: patientId,
    locationId: ctx.locationId,
    actorId: user.id,
  });
}

