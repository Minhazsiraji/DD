import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emptyMedicine, type MedicineRow } from "./schema";
import { getFinalizedPrescription, getPrescription } from "./queries";
import type {
  PrescriptionReuseItem,
  PrescriptionReuseSource,
  PrescriptionReuseSourceDetail,
  SignedHistoryMode,
  SignedMedicineSuggestion,
} from "./m3-history";
import type { BundleItem } from "./review-bundle";

function nullable(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type SignedHistoryOutcome =
  | { ok: true; items: SignedMedicineSuggestion[] }
  | { ok: false; message: string };

/**
 * Signed medicine history comes only from the immutable finalized-snapshot RPC.
 * A database failure must not collapse into an empty history state.
 */
export async function getSignedMedicineHistory(
  order: SignedHistoryMode,
  query: string | null,
  limit = 8,
): Promise<SignedHistoryOutcome> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("prescription_signed_medicine_history", {
    p_order: order,
    p_query: query?.trim() ? query.trim() : null,
    p_limit: Math.max(1, Math.min(25, limit)),
  });

  if (error) {
    console.error("[prescriptions] signed medicine history failed", error.message);
    return { ok: false, message: "Signed medicine history is unavailable right now." };
  }

  return {
    ok: true,
    items: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      ...emptyMedicine(),
      displayName: nullable(row.display_name),
      brandName: nullable(row.brand_name),
      genericName: nullable(row.generic_name),
      strengthText: nullable(row.strength_text),
      doseText: nullable(row.dose_text),
      dosageForm: nullable(row.dosage_form),
      route: nullable(row.route),
      scheduleText: nullable(row.schedule_text),
      durationText: nullable(row.duration_text),
      quantityText: nullable(row.quantity_text),
      foodRelation: nullable(row.food_relation),
      instructions: nullable(row.instructions),
      isPrn: row.is_prn === true,
      substitutionAllowed: row.substitution_allowed !== false,
      lastUsed: typeof row.last_used === "string" ? row.last_used : null,
      timesUsed: Number(row.times_used ?? 0),
    })),
  };
}

/**
 * Eligible sources are discovered from the target patient's own finalized
 * longitudinal history. The authoritative reuse RPC re-proves every condition.
 */
export async function getPrescriptionReuseSources(
  targetPrescriptionId: string,
  activeLocationId: string,
  limit = 8,
): Promise<{ ok: true; sources: PrescriptionReuseSource[] } | { ok: false; message: string }> {
  const target = await getPrescription(targetPrescriptionId, activeLocationId);
  if (!target.ok || target.prescription.status !== "DRAFT") {
    return { ok: false, message: "This prescription is not available for historical reuse." };
  }
  if (target.prescription.replacesPrescriptionId) {
    return {
      ok: false,
      message: "A corrected prescription starts blank. Historical reuse is not available on this correction.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("patient_prescription_history", {
    p_patient_id: target.prescription.patientId,
    p_practice_location_id: null,
  });
  if (error) {
    console.error("[prescriptions] reuse source history failed", error.message);
    return { ok: false, message: "Previous prescriptions could not be loaded just now." };
  }

  const sources = ((data ?? []) as Record<string, unknown>[])
    .filter(
      (row) =>
        row.prescription_id !== targetPrescriptionId &&
        typeof row.prescription_id === "string" &&
        typeof row.finalized_at === "string" &&
        typeof row.location_id === "string",
    )
    .slice(0, Math.max(1, Math.min(12, limit)))
    .map((row) => ({
      prescriptionId: row.prescription_id as string,
      finalizedAt: row.finalized_at as string,
      locationId: row.location_id as string,
      locationName: (row.location_name as string | null) ?? null,
      itemCount: Number(row.item_count ?? 0),
      isSuperseded: Boolean(row.superseded_by),
      isCorrection: Boolean(row.replaces_id),
    }));

  return { ok: true, sources };
}

const bundleKey: (keyof Omit<BundleItem, "position">)[] = [
  "display_name",
  "brand_name",
  "generic_name",
  "strength_text",
  "dose_text",
  "dosage_form",
  "route",
  "schedule_text",
  "duration_text",
  "quantity_text",
  "food_relation",
  "is_prn",
  "instructions",
  "substitution_allowed",
];

function sameSignedItem(row: MedicineRow, signed: BundleItem): boolean {
  if (row.position !== signed.position) return false;
  return bundleKey.every((key) => {
    const live = row[key as keyof MedicineRow];
    const frozen = signed[key];
    return (live ?? null) === (frozen ?? null);
  });
}

function reuseItem(row: MedicineRow, signed: BundleItem): PrescriptionReuseItem {
  return {
    itemId: row.id,
    position: signed.position,
    displayName: signed.display_name,
    brandName: signed.brand_name,
    genericName: signed.generic_name,
    strengthText: signed.strength_text,
    doseText: signed.dose_text,
    dosageForm: signed.dosage_form,
    route: signed.route,
    scheduleText: signed.schedule_text,
    durationText: signed.duration_text,
    quantityText: signed.quantity_text,
    foodRelation: signed.food_relation,
    isPrn: signed.is_prn,
    instructions: signed.instructions,
    substitutionAllowed: signed.substitution_allowed,
  };
}

/**
 * Selectable row ids are paired with immutable signed wording. Any privileged
 * drift between live finalized rows and the frozen bundle fails closed.
 */
export async function getPrescriptionReuseSourceDetail(
  targetPrescriptionId: string,
  sourcePrescriptionId: string,
  activeLocationId: string,
): Promise<{ ok: true; source: PrescriptionReuseSourceDetail } | { ok: false; message: string }> {
  const [target, sources] = await Promise.all([
    getPrescription(targetPrescriptionId, activeLocationId),
    getPrescriptionReuseSources(targetPrescriptionId, activeLocationId, 12),
  ]);
  if (!target.ok || target.prescription.status !== "DRAFT") {
    return { ok: false, message: "This prescription is no longer available for reuse." };
  }
  if (!sources.ok) return sources;

  const sourceMeta = sources.sources.find((source) => source.prescriptionId === sourcePrescriptionId);
  if (!sourceMeta) return { ok: false, message: "That previous prescription is not eligible for reuse." };

  const [live, frozen] = await Promise.all([
    getPrescription(sourcePrescriptionId, sourceMeta.locationId),
    getFinalizedPrescription(sourcePrescriptionId, sourceMeta.locationId),
  ]);
  if (!live.ok || live.prescription.status !== "FINALIZED" || !frozen.ok) {
    return { ok: false, message: "That previous prescription could not be verified for reuse." };
  }
  if (live.prescription.patientId !== target.prescription.patientId) {
    console.error("[prescriptions] reuse source patient mismatch", sourcePrescriptionId, targetPrescriptionId);
    return { ok: false, message: "That previous prescription is not eligible for this patient." };
  }

  const signedItems = frozen.finalized.bundle.items.slice().sort((a, b) => a.position - b.position);
  const liveItems = live.prescription.items.slice().sort((a, b) => a.position - b.position);
  if (
    signedItems.length !== liveItems.length ||
    signedItems.some((signed, index) => !sameSignedItem(liveItems[index]!, signed))
  ) {
    console.error("[prescriptions] reuse source live/signed item mismatch", sourcePrescriptionId);
    return { ok: false, message: "That previous prescription could not be verified for safe reuse." };
  }

  return {
    ok: true,
    source: {
      ...sourceMeta,
      items: signedItems.map((signed, index) => reuseItem(liveItems[index]!, signed)),
    },
  };
}
