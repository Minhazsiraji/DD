"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";

/**
 * Medicine library writes.
 *
 * WHAT THESE CAN DO: create, edit, favourite, archive and restore rows in the
 * CALLER'S OWN saved-medicine list, and record that they used one.
 *
 * WHAT THESE CANNOT DO, structurally rather than by convention:
 *
 *   - touch another doctor's library. No action takes a doctor id. The
 *     database derives it from the verified JWT via `current_doctor_id()`, and
 *     both the USING and WITH CHECK halves of `doctor_medicines_update` compare
 *     against it. A forged body cannot name a victim because there is no field
 *     in which to name one.
 *   - write the shared catalogue. 0043 revokes insert/update/delete on
 *     `medicine_references` from `authenticated` outright.
 *   - delete anything. DELETE is revoked; "remove" sets `is_active = false`.
 *   - reach a prescription. Nothing here imports prescription code, and
 *     `medicine-boundary.test.ts` fails if that ever changes.
 *
 * `requireLocationContext()` gates every action: signed in, with an active
 * clinic. It is not the authorisation — RLS is — but it stops an unauthenticated
 * or context-less call before it reaches the database.
 */

export interface MedicineActionResult {
  ok: boolean;
  message?: string;
  id?: string;
}

const GENERIC_ERROR = "That did not save. Please try again.";

/**
 * Text fields are trimmed, and empty becomes NULL rather than "".
 *
 * A stored empty string would print as a blank line on a future prescription
 * and read as "the doctor wrote nothing here on purpose". NULL means "not set".
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/**
 * Bounds mirror the CHECK constraints in `schema.ts`. Both exist on purpose: a
 * limit that lives only in Zod is a limit the database does not have, and these
 * tables are writable directly by `authenticated` under RLS.
 */
const defaultsSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  genericName: optionalText(200),
  brandName: optionalText(200),
  strengthText: optionalText(100),
  dosageForm: optionalText(100),
  route: optionalText(100),
  defaultDoseText: optionalText(100),
  defaultScheduleText: optionalText(100),
  defaultDurationText: optionalText(100),
  defaultQuantityText: optionalText(100),
  defaultFoodRelation: optionalText(100),
  defaultInstructions: optionalText(1000),
  defaultIsPrn: z.boolean().default(false),
  medicineReferenceId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
});

const idSchema = z.string().uuid();

function columns(v: z.infer<typeof defaultsSchema>) {
  return {
    display_name: v.displayName,
    generic_name: v.genericName,
    brand_name: v.brandName,
    strength_text: v.strengthText,
    dosage_form: v.dosageForm,
    route: v.route,
    default_dose_text: v.defaultDoseText,
    default_schedule_text: v.defaultScheduleText,
    default_duration_text: v.defaultDurationText,
    default_quantity_text: v.defaultQuantityText,
    default_food_relation: v.defaultFoodRelation,
    default_instructions: v.defaultInstructions,
    default_is_prn: v.defaultIsPrn,
  };
}

/**
 * Add a medicine to the caller's library.
 *
 * `doctor_profile_id` is set from `current_doctor_id()` by the database, not
 * from this payload — the insert policy's WITH CHECK requires it to equal the
 * caller's own id, so we read it once and let the policy verify it. A caller
 * who is not a doctor gets NULL and the insert is refused.
 */
export async function addDoctorMedicine(
  input: unknown,
): Promise<MedicineActionResult> {
  await requireLocationContext();

  const parsed = defaultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the medicine details." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: doctorId, error: idError } = await supabase.rpc("current_doctor_id");
  if (idError || !doctorId) {
    return { ok: false, message: "Only a doctor can save medicines." };
  }

  const { data, error } = await supabase
    .from("doctor_medicines")
    .insert({
      doctor_profile_id: doctorId as string,
      medicine_reference_id: parsed.data.medicineReferenceId,
      ...columns(parsed.data),
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation: this doctor already has this name+strength.
    // Said plainly, because "it failed" would send them to add it a third time.
    if (error.code === "23505") {
      return { ok: false, message: "That medicine is already in My Medicines." };
    }
    console.error("[medicines] add failed", error.message);
    return { ok: false, message: GENERIC_ERROR };
  }

  // The medicine NAME is deliberately absent: audit_events is readable by roles
  // that must never learn what a doctor prescribes.
  await emitAudit({
    action: "doctor_medicine.added",
    resourceType: "doctor_medicine",
    resourceId: data.id,
  });

  revalidatePath("/medicines");
  return { ok: true, id: data.id };
}

/** Edit the saved defaults on one of the caller's own rows. */
export async function updateDoctorMedicine(
  id: unknown,
  input: unknown,
): Promise<MedicineActionResult> {
  await requireLocationContext();

  const parsedId = idSchema.safeParse(id);
  const parsed = defaultsSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) {
    return { ok: false, message: "Please check the medicine details." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("doctor_medicines")
    .update({ ...columns(parsed.data), updated_at: new Date().toISOString() })
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Another saved medicine already uses that name and strength." };
    }
    console.error("[medicines] update failed", error.message);
    return { ok: false, message: GENERIC_ERROR };
  }

  /**
   * No row came back. Under RLS that means the row is not the caller's — or
   * does not exist. ONE answer for both, because a distinguishable error would
   * let a caller probe for the existence of another doctor's saved medicines.
   */
  if (!data) return { ok: false, message: "That medicine is not in your library." };

  await emitAudit({
    action: "doctor_medicine.defaults_updated",
    resourceType: "doctor_medicine",
    resourceId: parsedId.data,
  });

  revalidatePath("/medicines");
  return { ok: true, id: parsedId.data };
}

/**
 * Archive or restore. NOT a delete.
 *
 * Archiving changes one boolean on one personal row. It does not, and cannot,
 * alter a prescription: `prescription_items` keeps its own copy of every
 * printed field and holds no foreign key to this table. A prescription
 * finalised last year reads exactly the same afterwards.
 */
export async function setDoctorMedicineArchived(
  id: unknown,
  archived: unknown,
): Promise<MedicineActionResult> {
  await requireLocationContext();

  const parsedId = idSchema.safeParse(id);
  const parsedFlag = z.boolean().safeParse(archived);
  if (!parsedId.success || !parsedFlag.success) {
    return { ok: false, message: GENERIC_ERROR };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("doctor_medicines")
    .update({ is_active: !parsedFlag.data, updated_at: new Date().toISOString() })
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[medicines] archive failed", error.message);
    return { ok: false, message: GENERIC_ERROR };
  }
  if (!data) return { ok: false, message: "That medicine is not in your library." };

  await emitAudit({
    action: parsedFlag.data ? "doctor_medicine.archived" : "doctor_medicine.restored",
    resourceType: "doctor_medicine",
    resourceId: parsedId.data,
  });

  revalidatePath("/medicines");
  return { ok: true, id: parsedId.data };
}

/** Star or unstar. Favourites sort first; nothing else changes. */
export async function setDoctorMedicineFavorite(
  id: unknown,
  favorite: unknown,
): Promise<MedicineActionResult> {
  await requireLocationContext();

  const parsedId = idSchema.safeParse(id);
  const parsedFlag = z.boolean().safeParse(favorite);
  if (!parsedId.success || !parsedFlag.success) {
    return { ok: false, message: GENERIC_ERROR };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("doctor_medicines")
    .update({ is_favorite: parsedFlag.data, updated_at: new Date().toISOString() })
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[medicines] favorite failed", error.message);
    return { ok: false, message: GENERIC_ERROR };
  }
  if (!data) return { ok: false, message: "That medicine is not in your library." };

  revalidatePath("/medicines");
  return { ok: true, id: parsedId.data };
}
