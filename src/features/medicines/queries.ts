import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DoctorMedicine, MedicineReference } from "./medicine";
import { isSearchable } from "./medicine";

/**
 * Medicine reads.
 *
 * Every query runs under the caller's own session, so RLS applies: the
 * catalogue is readable by any signed-in user, and `doctor_medicines` returns
 * only the caller's own rows because `doctor_medicines_select` compares against
 * `current_doctor_id()`. Nothing here supplies a doctor id — the database
 * derives it from the verified JWT, which is why a caller cannot ask for
 * someone else's library by changing a parameter.
 *
 * THIS IS ALSO THE REUSABLE CONTRACT the later prescription integration will
 * call. It returns data. It writes nothing, and it has no access to
 * prescriptions.
 */

/**
 * Search the shared catalogue.
 *
 * Literal matching only, in the database (`search_medicines`). An empty result
 * is a real answer — the medicine is not in the catalogue and the doctor should
 * type it themselves. We never soften that into a near-miss suggestion.
 */
export async function searchMedicines(
  query: string,
  options: { country?: string | null; limit?: number } = {},
): Promise<MedicineReference[]> {
  if (!isSearchable(query)) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("search_medicines", {
    p_query: query,
    p_country: options.country ?? null,
    p_limit: options.limit ?? 25,
  });

  if (error || !Array.isArray(data)) return [];

  return (data as RawReference[]).map(toReference);
}

/**
 * The caller's own saved medicines.
 *
 * `includeArchived` exists because a doctor must be able to find and restore
 * what they archived. It changes what is LISTED, never what is permitted —
 * archived rows were always readable by their owner, and by nobody else.
 */
export async function listDoctorMedicines(
  options: { includeArchived?: boolean } = {},
): Promise<DoctorMedicine[]> {
  const supabase = await createSupabaseServerClient();

  let q = supabase
    .from("doctor_medicines")
    .select(
      "id, medicine_reference_id, display_name, generic_name, brand_name, " +
        "strength_text, dosage_form, route, default_dose_text, " +
        "default_schedule_text, default_duration_text, default_quantity_text, " +
        "default_food_relation, default_instructions, default_is_prn, " +
        "is_favorite, usage_count, last_used_at, is_active",
    );

  if (!options.includeArchived) q = q.eq("is_active", true);

  const { data, error } = await q
    .order("is_favorite", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("display_name", { ascending: true })
    .limit(500);

  if (error || !Array.isArray(data)) return [];

  /**
   * Through `unknown`: `doctor_medicines` is not in the generated Supabase
   * types yet (they are regenerated against a live database, which this branch
   * has not applied). The row shape is pinned by `RawDoctorMedicine` and by the
   * select list above, and the mapper below is the only thing that reads it.
   */
  return (data as unknown as RawDoctorMedicine[]).map(toDoctorMedicine);
}

/** Row shapes as PostgREST returns them: snake_case, unknown until mapped. */
interface RawReference {
  id: string;
  generic_name: string;
  brand_name: string | null;
  strength_text: string | null;
  dosage_form: string | null;
  manufacturer: string | null;
  country_code: string;
  regulator_name: string | null;
  source_kind: MedicineReference["sourceKind"];
  last_verified_at: string | null;
}

interface RawDoctorMedicine {
  id: string;
  medicine_reference_id: string | null;
  display_name: string;
  generic_name: string | null;
  brand_name: string | null;
  strength_text: string | null;
  dosage_form: string | null;
  route: string | null;
  default_dose_text: string | null;
  default_schedule_text: string | null;
  default_duration_text: string | null;
  default_quantity_text: string | null;
  default_food_relation: string | null;
  default_instructions: string | null;
  default_is_prn: boolean;
  is_favorite: boolean;
  usage_count: number;
  last_used_at: string | null;
  is_active: boolean;
}

function toReference(r: RawReference): MedicineReference {
  return {
    id: r.id,
    genericName: r.generic_name,
    brandName: r.brand_name,
    strengthText: r.strength_text,
    dosageForm: r.dosage_form,
    manufacturer: r.manufacturer,
    countryCode: r.country_code,
    regulatorName: r.regulator_name,
    sourceKind: r.source_kind,
    lastVerifiedAt: r.last_verified_at,
  };
}

function toDoctorMedicine(r: RawDoctorMedicine): DoctorMedicine {
  return {
    id: r.id,
    medicineReferenceId: r.medicine_reference_id,
    displayName: r.display_name,
    genericName: r.generic_name,
    brandName: r.brand_name,
    strengthText: r.strength_text,
    dosageForm: r.dosage_form,
    route: r.route,
    defaultDoseText: r.default_dose_text,
    defaultScheduleText: r.default_schedule_text,
    defaultDurationText: r.default_duration_text,
    defaultQuantityText: r.default_quantity_text,
    defaultFoodRelation: r.default_food_relation,
    defaultInstructions: r.default_instructions,
    defaultIsPrn: r.default_is_prn,
    isFavorite: r.is_favorite,
    usageCount: r.usage_count,
    lastUsedAt: r.last_used_at,
    isActive: r.is_active,
  };
}
