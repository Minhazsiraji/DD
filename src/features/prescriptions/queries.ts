import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPatient, type PatientDetail } from "@/features/patients/queries";
import { parseReview, type ReviewBundle, type ReviewEnvelope } from "./review-bundle";
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
 * The canonical review bundle.
 *
 * The ONLY source the review screen may render from. It is built entirely from
 * authoritative rows inside `prescription_review_bundle` — the caller supplies
 * a template id at most, and even that is checked for ownership and location
 * scope inside the resolver. Nothing here reassembles a prescription from
 * today's doctor, patient, location or template rows: the doctor must read
 * exactly the content whose digest they will later approve.
 */
export type ReviewOutcome =
  | { ok: true; review: ReviewEnvelope }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "template-unavailable" }
  /** The layout asks to print something the bundle cannot attest. */
  | { ok: false; reason: "logo-unsupported" }
  /** A bundle shape this build does not know. Refused, never guessed at. */
  | { ok: false; reason: "unsupported-schema"; found: number }
  | { ok: false; reason: "unavailable" };

export async function getReviewBundle(
  prescriptionId: string,
  activeLocationId: string,
  templateId: string | null,
): Promise<ReviewOutcome> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("prescription_review_bundle", {
    p_prescription_id: prescriptionId,
    p_practice_location_id: activeLocationId,
    p_template_id: templateId,
  });

  if (error) {
    if (/TEMPLATE_LOGO_UNSUPPORTED/i.test(error.message)) {
      return { ok: false, reason: "logo-unsupported" };
    }
    if (/TEMPLATE_NOT_AVAILABLE/i.test(error.message)) {
      return { ok: false, reason: "template-unavailable" };
    }
    // Missing, not yours and elsewhere answer identically, on purpose.
    if (/prescription not found/i.test(error.message)) return { ok: false, reason: "not-found" };
    console.error("[prescriptions] review bundle failed", prescriptionId, error.message);
    return { ok: false, reason: "unavailable" };
  }
  if (!data) return { ok: false, reason: "not-found" };

  const parsed = parseReview(data);
  if (!parsed.ok) {
    if (parsed.reason === "unsupported-schema") {
      console.error("[prescriptions] unsupported bundle schema", parsed.found);
      return { ok: false, reason: "unsupported-schema", found: parsed.found };
    }
    console.error("[prescriptions] review bundle did not match the expected shape");
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, review: parsed.review };
}

/**
 * A finalised prescription, read only from what was approved.
 *
 * Goes through `finalized_prescription_detail`, which serves the immutable
 * `review_bundle_snapshot` and refuses anything still DRAFT. Nothing here can
 * reach today's doctor, patient, location or template rows — that is the whole
 * reason it is a separate function from `prescription_detail`.
 */
export type FinalizedOutcome =
  | { ok: true; finalized: { finalizedAt: string | null; digest: string; bundle: ReviewBundle } }
  | { ok: false; reason: "not-finalized" }
  | { ok: false; reason: "unsupported-schema"; found: number }
  | { ok: false; reason: "unavailable" };

export async function getFinalizedPrescription(
  prescriptionId: string,
  activeLocationId: string,
): Promise<FinalizedOutcome> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("finalized_prescription_detail", {
    p_prescription_id: prescriptionId,
    p_practice_location_id: activeLocationId,
  });

  if (error) {
    // Missing, not-yours, elsewhere and still-DRAFT answer identically.
    if (/not found/i.test(error.message)) return { ok: false, reason: "not-finalized" };
    console.error("[prescriptions] finalized read failed", prescriptionId, error.message);
    return { ok: false, reason: "unavailable" };
  }
  if (!data) return { ok: false, reason: "not-finalized" };

  const row = data as Record<string, unknown>;

  /**
   * The stored bundle is parsed with the same rules as a live one. A snapshot
   * written by a newer build must fail closed here too — rendering it with
   * older rules would drop whatever that version added, on a permanent record.
   */
  const parsed = parseReview({
    bundle: row.bundle,
    digest: (row.reviewDigest as string) ?? "",
    expectedSignaturePath: (row.signatureAssetPath as string) ?? "",
    version: 1,
  });

  if (!parsed.ok) {
    if (parsed.reason === "unsupported-schema") {
      return { ok: false, reason: "unsupported-schema", found: parsed.found };
    }
    console.error("[prescriptions] finalized snapshot did not match the expected shape");
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    finalized: {
      finalizedAt: (row.finalizedAt as string | null) ?? null,
      digest: parsed.review.digest,
      bundle: parsed.review.bundle,
    },
  };
}

/**
 * The layouts this doctor may choose for this prescription.
 *
 * Presentation only. `resolve_prescription_template` re-checks ownership and
 * location scope on every bundle build and again inside finalisation, so a
 * template that should not appear here still cannot be used if it does.
 */
export async function getSelectableTemplates(activeLocationId: string) {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("prescription_templates")
    .select("id, name, practice_location_id, is_default, paper_size")
    .or(`practice_location_id.is.null,practice_location_id.eq.${activeLocationId}`)
    .order("name");

  if (error) {
    console.error("[prescriptions] template list failed", error.message);
    return [];
  }

  return (data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    scope: (t.practice_location_id === null ? "global" : "location") as "global" | "location",
    isDefault: Boolean(t.is_default),
    paperSize: t.paper_size as "A4" | "A5",
  }));
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
