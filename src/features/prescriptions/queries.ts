import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPatient, type PatientDetail } from "@/features/patients/queries";
import { emptyMedicine, type MedicineRow, type Suggestion } from "./schema";

/**
 * Prescription reads.
 *
 * Every one goes through the Stage 7A functions. `prescriptions` and
 * `prescription_items` have NO direct SELECT for `authenticated` — that is the
 * accepted boundary, and nothing here works around it for convenience.
 */

export interface PrescriptionDetail {
  id: string;
  status: "DRAFT" | "FINALIZED" | "VOIDED";
  version: number;
  encounterId: string;
  patientId: string;
  finalizedAt: string | null;
  replacesPrescriptionId: string | null;
  replacementReason: string | null;
  items: MedicineRow[];
  patient: PatientDetail;
  practiceLocationId: string;
}

/**
 * Three outcomes, kept apart.
 *
 * "Not found" and "the read failed" must never collapse into one: a doctor told
 * a prescription does not exist when the database is merely unreachable would
 * start a second one, and the patient leaves with two.
 */
export type PrescriptionOutcome =
  | { ok: true; prescription: PrescriptionDetail }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "unavailable" };

export async function getPrescription(
  prescriptionId: string,
  activeLocationId: string,
): Promise<PrescriptionOutcome> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("prescription_detail", {
    p_prescription_id: prescriptionId,
    p_practice_location_id: activeLocationId,
  });

  if (error) {
    /**
     * The RPC answers "not found" identically for missing, not-yours and
     * elsewhere — deliberately, so the id space cannot be probed. We cannot
     * distinguish them here either, and must not invent a distinction.
     */
    if (/not found/i.test(error.message)) return { ok: false, reason: "not-found" };
    console.error("[prescriptions] detail failed", prescriptionId, error.message);
    return { ok: false, reason: "unavailable" };
  }
  if (!data) return { ok: false, reason: "not-found" };

  const row = data as Record<string, unknown>;

  const patient = await getPatient(row.patientId as string);
  if (!patient) return { ok: false, reason: "unavailable" };

  return {
    ok: true,
    prescription: {
      id: row.id as string,
      status: row.status as PrescriptionDetail["status"],
      version: row.version as number,
      encounterId: row.encounterId as string,
      patientId: row.patientId as string,
      finalizedAt: (row.finalizedAt as string | null) ?? null,
      replacesPrescriptionId: (row.replacesPrescriptionId as string | null) ?? null,
      replacementReason: (row.replacementReason as string | null) ?? null,
      items: ((row.items ?? []) as MedicineRow[]).slice().sort((a, b) => a.position - b.position),
      patient,
      practiceLocationId: activeLocationId,
    },
  };
}

/**
 * What this doctor has written before.
 *
 * An ACCELERATOR, never a source of truth. Choosing one copies text into the
 * current draft; nothing is referenced, so a finalised prescription can never
 * change because a later one was worded differently.
 */
export async function getMedicineSuggestions(query: string): Promise<Suggestion[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("prescription_item_suggestions", {
    p_query: query.trim() === "" ? null : query.trim(),
    p_limit: 8,
  });

  if (error) {
    // Suggestions are a convenience: a failure must never block typing.
    console.error("[prescriptions] suggestions failed", error.message);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...emptyMedicine(),
    displayName: (r.display_name as string) ?? "",
    brandName: (r.brand_name as string) ?? "",
    genericName: (r.generic_name as string) ?? "",
    strengthText: (r.strength_text as string) ?? "",
    doseText: (r.dose_text as string) ?? "",
    dosageForm: (r.dosage_form as string) ?? "",
    route: (r.route as string) ?? "",
    scheduleText: (r.schedule_text as string) ?? "",
    durationText: (r.duration_text as string) ?? "",
    quantityText: (r.quantity_text as string) ?? "",
    foodRelation: (r.food_relation as string) ?? "",
    instructions: (r.instructions as string) ?? "",
    isPrn: Boolean(r.is_prn),
    substitutionAllowed: r.substitution_allowed !== false,
    timesUsed: Number(r.times_used ?? 0),
  }));
}
