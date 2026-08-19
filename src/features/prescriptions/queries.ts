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
export interface FinalizedPrescription {
  finalizedAt: string | null;
  digest: string;
  bundle: ReviewBundle;
  /** For the "back to…" link, so the staff route needs no second read. */
  encounterId: string;
  /**
   * Whether the reader is the owning doctor, as the DATABASE sees it — not as
   * the session's role cookie claims. The screen uses it to decide which chrome
   * to show; it is never the reason anything is readable.
   */
  viewerIsOwner: boolean;
  /**
   * Owner-only, and NULL for staff because the RPC does not send it to them.
   * See `0022_prescription_handover.sql`: a correction reason is clinical
   * reasoning, and the front desk is authorised to hand over paperwork rather
   * than to read why it was rewritten.
   */
  replacementReason: string | null;
  replacesPrescriptionId: string | null;
}

export type FinalizedOutcome =
  | { ok: true; finalized: FinalizedPrescription }
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
      encounterId: row.encounterId as string,
      viewerIsOwner: row.viewerIsOwner === true,
      replacementReason: (row.replacementReason as string | null) ?? null,
      replacesPrescriptionId: (row.replacesPrescriptionId as string | null) ?? null,
    },
  };
}

/**
 * Correction lineage: what supersedes this prescription, and what it corrects.
 *
 * The reason is present only for the owning doctor — the RPC does not send it
 * to anyone else. Staff get the operational fact ("there is a newer sheet") so
 * they do not hand over a corrected dose, and an id to follow only when they
 * could actually open it.
 */
export interface LineageLink {
  /** Null when the reader may not open it — they still learn it exists. */
  id: string | null;
  status: "DRAFT" | "FINALIZED" | "VOIDED";
  finalizedAt: string | null;
}

export interface PrescriptionLineage {
  viewerIsOwner: boolean;
  replacedBy: (LineageLink & { reason: string | null }) | null;
  replaces: LineageLink | null;
  /** Why THIS prescription was written. Owner only; null for everyone else. */
  reason: string | null;
}

export type LineageOutcome =
  | { ok: true; lineage: PrescriptionLineage }
  | { ok: false; reason: "unavailable" };

export async function getPrescriptionLineage(
  prescriptionId: string,
  activeLocationId: string,
): Promise<LineageOutcome> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("prescription_lineage", {
    p_prescription_id: prescriptionId,
    p_practice_location_id: activeLocationId,
  });

  if (error || !data) {
    /**
     * Lineage is a banner, never a gate. If it cannot be read, the prescription
     * still renders and still prints — refusing to show an approved document
     * because a "replaced by" note failed would be the worse outcome. What must
     * not happen is silently claiming there is no replacement, so the caller
     * gets an explicit failure rather than an empty lineage.
     */
    if (error) console.error("[prescriptions] lineage read failed", error.message);
    return { ok: false, reason: "unavailable" };
  }

  const row = data as Record<string, unknown>;
  const link = (v: unknown): LineageLink | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    return {
      id: (o.id as string | null) ?? null,
      status: o.status as LineageLink["status"],
      finalizedAt: (o.finalizedAt as string | null) ?? null,
    };
  };

  const replacedBy = link(row.replacedBy);
  return {
    ok: true,
    lineage: {
      viewerIsOwner: row.viewerIsOwner === true,
      replacedBy:
        replacedBy ?
          {
            ...replacedBy,
            reason:
              ((row.replacedBy as Record<string, unknown>).reason as string | null) ?? null,
          }
        : null,
      replaces: link(row.replaces),
      reason: (row.reason as string | null) ?? null,
    },
  };
}

/**
 * Finalised prescriptions waiting to be handed over at ONE location.
 *
 * This is how the front desk ARRIVES at a prescription. Before Stage 7C-3C
 * there was no way: `finalized_prescriptions_at` existed in the database and
 * nothing in the app called it, so reception could only reach a prescription by
 * being sent a link — or by walking the doctor's own consultation route, which
 * they cannot open. A handover workflow with no way in is not a workflow.
 *
 * The location is the caller's ACTIVE one, never a parameter from the page.
 * The RPC re-checks membership anyway and answers "location not found" for a
 * clinic that is not theirs, exactly as it does for one that does not exist.
 */
export interface HandoverListItem {
  prescriptionId: string;
  patientId: string;
  patientName: string;
  patientNumber: string;
  finalizedAt: string | null;
  itemCount: number;
  /**
   * A correction exists for this sheet, so it is NOT the current one.
   *
   * V1 stays on the list — history must be complete, and the doctor may need
   * to find what was issued that day. But two rows for the same patient minutes
   * apart, with nothing to tell them apart, is how a superseded dose gets handed
   * over. `supersededBy` is an id only when the reader may open it.
   */
  isSuperseded: boolean;
  supersededBy: string | null;
}

export type HandoverListOutcome =
  | { ok: true; items: HandoverListItem[] }
  | { ok: false; reason: "unavailable" };

export async function getFinalizedPrescriptionsAt(
  activeLocationId: string,
): Promise<HandoverListOutcome> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("finalized_prescriptions_at", {
    p_practice_location_id: activeLocationId,
    p_patient_id: null,
  });

  if (error) {
    console.error("[prescriptions] handover list failed", error.message);
    return { ok: false, reason: "unavailable" };
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { ok: true, items: [] };

  /**
   * Names come from a SECOND, separately-authorised read.
   *
   * The RPC returns patient IDS on purpose — it is a prescription list, not a
   * patient directory. Resolving the names through the ordinary `patients`
   * policy means a caller who somehow held a prescription id they may see, for
   * a patient they may not, still gets no name out of it. A missing row is
   * shown as unnamed rather than dropped: hiding the row would hide a
   * prescription the patient is standing there waiting for.
   */
  const ids = [...new Set(rows.map((r) => r.patient_id as string))];
  const { data: patients } = await supabase
    .from("patients")
    .select("id, full_name, patient_number")
    .in("id", ids);

  const byId = new Map(
    (patients ?? []).map((p) => [
      p.id as string,
      { name: p.full_name as string, number: p.patient_number as string },
    ]),
  );

  return {
    ok: true,
    items: rows.map((r) => {
      const patient = byId.get(r.patient_id as string);
      return {
        prescriptionId: r.prescription_id as string,
        patientId: r.patient_id as string,
        patientName: patient?.name ?? "—",
        patientNumber: patient?.number ?? "",
        finalizedAt: (r.finalized_at as string | null) ?? null,
        itemCount: Number(r.item_count ?? 0),
        isSuperseded: r.is_superseded === true,
        supersededBy: (r.superseded_by as string | null) ?? null,
      };
    }),
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
