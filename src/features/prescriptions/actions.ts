"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canFreezeSignatures } from "@/lib/supabase/service";
import { requireLocationContext, requireUser } from "@/lib/auth/session";
import { acceptVersion } from "@/features/encounters/version-contract";
import { freezeSignature, signatureNeed, type FreezeOutcome } from "./freeze";
import { supabaseSignatureStore } from "./freeze-store";
import {
  getMedicineSuggestions,
  getPrescription,
  getReviewBundle,
  type ReviewOutcome,
} from "./queries";
import {
  GENERIC_RX_ERROR,
  RX_ADVANCED_MESSAGE,
  RX_CONFLICT_UNLOADABLE_MESSAGE,
  RX_FINALIZE_ALREADY_MESSAGE,
  RX_FINALIZE_REJECTED_MESSAGE,
  RX_FINALIZE_STALE_MESSAGE,
  RX_FINALIZE_UNCONFIRMED_MESSAGE,
  RX_UNCONFIRMED_MESSAGE,
  translateRxError,
} from "./errors";
import {
  classifyFinalize,
  classifyRefusal,
  resolveAfterRecovery,
  type AuthoritativeStatus,
  type FinalizeKind,
} from "./finalize-outcome";
import { classifyWrite } from "./recovery";
import { medicineInputSchema, type MedicineRow, type Suggestion } from "./schema";

/**
 * Prescription writes.
 *
 * Every one is a Stage 7A RPC. Direct writes are revoked, so nothing here
 * decides authorisation — this file validates input, calls the function, and
 * turns a refusal into a sentence. Nothing here can finalise: Stage 7B is a
 * DRAFT workflow and `finalize_prescription` is not called from anywhere in it.
 */

function safe(action: string, message: string) {
  const t = translateRxError(message);
  if (t.unexpected) {
    // Server-side only — the detail we deliberately do not render.
    console.error(`[prescriptions] ${action} failed`, message);
  }
  return t;
}

/**
 * What became of one write.
 *
 * `ok: true` means BOTH that the write committed AND that the screen is now in
 * step with the record — it is the only outcome that may carry on writing. Every
 * other kind answers a different question, and the caller must treat them
 * differently:
 *
 *   conflict             refused, and here is what the record now holds
 *   conflict-unloadable  refused, and we could not load what it holds
 *   write-confirmed-advanced   COMMITTED, then somebody else moved the record
 *   unconfirmed          we cannot tell whether it committed
 *   error                refused for a reason the doctor can act on
 *
 * The two "refused" kinds preserve the doctor's typed text, because it is their
 * only copy. The two kinds where the write may or did land close the form,
 * because resubmitting is how a medicine gets onto a prescription twice.
 */
export type RxResult =
  | { ok: true; version: number; items: MedicineRow[] }
  | { ok: false; kind: "conflict"; message: string; version: number; items: MedicineRow[] }
  /** Definitely refused. Nothing to adopt — preserve the screen exactly. */
  | { ok: false; kind: "conflict-unloadable"; message: string }
  /** Definitely committed, and the record moved again before we read it back. */
  | {
      ok: false;
      kind: "write-confirmed-advanced";
      message: string;
      version: number;
      items: MedicineRow[];
    }
  /** The write may have landed and we could not find out. Never a plain error. */
  | { ok: false; kind: "unconfirmed"; message: string }
  | { ok: false; kind: "error"; message: string };

/**
 * Re-read after a mutation.
 *
 * The RPCs return a version, not rows, and positions shift when something is
 * removed — so the list is re-read rather than patched locally. A screen that
 * guesses at the new order disagrees with the record about what the doctor
 * wrote down.
 */
async function reread(prescriptionId: string, locationId: string) {
  const outcome = await getPrescription(prescriptionId, locationId);
  return outcome.ok ? outcome.prescription : null;
}

/**
 * Turn one RPC answer into an outcome the screen can act on.
 *
 * The decision itself is `classifyWrite` — pure, tabulated and tested away from
 * a database. This function's only job is to gather the three facts it needs
 * and attach the right sentence, so the classification cannot drift into
 * branches nobody can see all of at once.
 */
async function finish(
  action: string,
  prescriptionId: string,
  locationId: string,
  error: { message: string } | null,
  earnedVersion: number | null,
): Promise<RxResult> {
  // An ordinary refusal: nothing was written and there is nothing to recover.
  const translated = error ? safe(action, error.message) : null;
  if (translated && translated.kind !== "conflict") {
    return { ok: false, kind: "error", message: translated.message };
  }
  const refused = translated !== null;

  if (!refused && earnedVersion === null) {
    console.error(`[prescriptions] ${action} returned an unusable version`);
  }

  /**
   * Read back even when refused: knowing what the record now holds is the
   * difference between the doctor being able to settle the conflict here and
   * being sent away to reload.
   */
  const current = await reread(prescriptionId, locationId);
  const kind = classifyWrite({
    refused,
    earnedVersion,
    currentVersion: current?.version ?? null,
  });

  switch (kind) {
    case "ok":
      return { ok: true, version: current!.version, items: current!.items };

    case "conflict":
      return {
        ok: false,
        kind: "conflict",
        message: translated!.message,
        version: current!.version,
        items: current!.items,
      };

    case "conflict-unloadable":
      return { ok: false, kind: "conflict-unloadable", message: RX_CONFLICT_UNLOADABLE_MESSAGE };

    case "write-confirmed-advanced":
      return {
        ok: false,
        kind: "write-confirmed-advanced",
        message: RX_ADVANCED_MESSAGE,
        version: current!.version,
        items: current!.items,
      };

    default:
      if (current && earnedVersion !== null && current.version < earnedVersion) {
        console.error(
          `[prescriptions] ${action} earned v${earnedVersion} but the record reports v${current.version}`,
        );
      }
      return { ok: false, kind: "unconfirmed", message: RX_UNCONFIRMED_MESSAGE };
  }
}

export async function openPrescriptionAction(input: {
  encounterId: string;
  replacementReason?: string | null;
}): Promise<{ ok: true; prescriptionId: string } | { ok: false; message: string }> {
  const parsed = z
    .object({ encounterId: z.uuid(), replacementReason: z.string().trim().max(500).nullish() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "That consultation could not be opened." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("open_prescription", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_replacement_reason: parsed.data.replacementReason ?? null,
  });

  if (error) return { ok: false, message: safe("open_prescription", error.message).message };
  if (!data) {
    console.error("[prescriptions] open returned no id");
    return { ok: false, message: "The prescription could not be opened. Try again." };
  }

  revalidatePath(`/consultation/${parsed.data.encounterId}`);
  return { ok: true, prescriptionId: data as string };
}

export async function addMedicineAction(input: unknown): Promise<RxResult> {
  const parsed = medicineInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "error", message: "Give the medicine a name." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { prescriptionId, expectedVersion, patch } = parsed.data;

  const { error } = await supabase.rpc("add_prescription_item", {
    p_prescription_id: prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: expectedVersion,
    p_patch: patch,
  });

  // add returns the new row's id; the version it earns is expectedVersion + 1
  // (ADR 0011 §6c, asserted by db:verify:encounters and db:verify:prescriptions).
  return finish("add_prescription_item", prescriptionId, ctx.locationId, error, expectedVersion + 1);
}

export async function updateMedicineAction(input: unknown): Promise<RxResult> {
  const parsed = medicineInputSchema.extend({ itemId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, kind: "error", message: "That change could not be saved." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { prescriptionId, expectedVersion, itemId, patch } = parsed.data;

  if (Object.keys(patch).length === 0) {
    return { ok: false, kind: "error", message: "Nothing has changed." };
  }

  const { data, error } = await supabase.rpc("update_prescription_item", {
    p_prescription_id: prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: expectedVersion,
    p_item_id: itemId,
    p_patch: patch,
  });

  return finish(
    "update_prescription_item",
    prescriptionId,
    ctx.locationId,
    error,
    acceptVersion(data, expectedVersion),
  );
}

export async function removeMedicineAction(input: {
  prescriptionId: string;
  expectedVersion: number;
  itemId: string;
}): Promise<RxResult> {
  const parsed = z
    .object({ prescriptionId: z.uuid(), expectedVersion: z.number().int().positive(), itemId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, kind: "error", message: "That medicine could not be removed." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("remove_prescription_item", {
    p_prescription_id: parsed.data.prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_item_id: parsed.data.itemId,
  });

  return finish(
    "remove_prescription_item",
    parsed.data.prescriptionId,
    ctx.locationId,
    error,
    acceptVersion(data, parsed.data.expectedVersion),
  );
}

export async function moveMedicineAction(input: {
  prescriptionId: string;
  expectedVersion: number;
  itemId: string;
  toPosition: number;
}): Promise<RxResult> {
  const parsed = z
    .object({
      prescriptionId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      itemId: z.uuid(),
      toPosition: z.number().int().positive(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, kind: "error", message: "That medicine could not be moved." };

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("move_prescription_item", {
    p_prescription_id: parsed.data.prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_item_id: parsed.data.itemId,
    p_to_position: parsed.data.toPosition,
  });

  return finish(
    "move_prescription_item",
    parsed.data.prescriptionId,
    ctx.locationId,
    error,
    acceptVersion(data, parsed.data.expectedVersion),
  );
}

/** Recover from "we do not know what the prescription holds". */
export async function refreshPrescriptionAction(
  prescriptionId: string,
): Promise<{ ok: true; version: number; items: MedicineRow[] } | { ok: false }> {
  const ctx = await requireLocationContext();
  const current = await reread(prescriptionId, ctx.locationId);
  if (!current) return { ok: false };
  return { ok: true, version: current.version, items: current.items };
}

/**
 * Rebuild the canonical review bundle, usually because the layout changed.
 *
 * Returns the SERVER's bundle verbatim. The client never assembles one, never
 * edits one, and never sends one back — Stage 7A dropped the overload that
 * accepted browser-supplied snapshot JSON, and nothing in 7C may reintroduce
 * the shape of that mistake.
 *
 * Note what this does NOT do: it cannot finalise. Stage 7C-1 has no path to
 * `finalize_prescription` from anywhere in the application.
 */
export async function refreshReviewAction(input: {
  prescriptionId: string;
  templateId: string | null;
}): Promise<{ ok: true; review: unknown } | { ok: false; message: string }> {
  const parsed = z
    .object({ prescriptionId: z.uuid(), templateId: z.uuid().nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "That prescription could not be reviewed." };

  const ctx = await requireLocationContext();
  const outcome = await getReviewBundle(
    parsed.data.prescriptionId,
    ctx.locationId,
    parsed.data.templateId,
  );

  if (outcome.ok) return { ok: true, review: outcome.review };

  switch (outcome.reason) {
    case "logo-unsupported":
      return { ok: false, message: translateRxError("TEMPLATE_LOGO_UNSUPPORTED").message };
    case "template-unavailable":
      return { ok: false, message: "That layout is not available for this prescription." };
    case "not-found":
      return {
        ok: false,
        message: "This prescription is no longer available at your current location.",
      };
    case "unsupported-schema":
      return {
        ok: false,
        message: "This prescription needs a newer version of the app to display safely.",
      };
    default:
      return { ok: false, message: "The prescription could not be loaded. Try again in a moment." };
  }
}

/**
 * Prepare a prescription for its final review.
 *
 * Stage 7C-2A. This FREEZES the signature and returns a fresh canonical
 * bundle; it does not approve anything and it cannot finalise — there is no
 * call to `finalize_prescription` anywhere in this build.
 *
 * The order is the point (ADR 0012). The frozen object's identity is inside
 * the bundle and the digest covers it, so freezing CHANGES the digest. Freeze
 * first, then rebuild, then let the doctor read the result. A flow that
 * approved a `signature: null` bundle and froze afterwards would have the
 * doctor approving one document while a different one became permanent.
 *
 * Every input is derived server-side. The browser sends a prescription id and
 * at most a template id; it never names a location, a doctor, a source or a
 * destination path.
 */
export async function prepareForReviewAction(input: {
  prescriptionId: string;
  templateId: string | null;
}): Promise<PrepareResult> {
  const parsed = z
    .object({ prescriptionId: z.uuid(), templateId: z.uuid().nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, kind: "error", message: "That could not be prepared." };

  const { prescriptionId, templateId } = parsed.data;
  const ctx = await requireLocationContext();

  /**
   * The bundle IS the authorisation check. `prescription_review_bundle` refuses
   * unless the caller is the owning doctor, at this active location, and the
   * template is one they may use — identically for missing, not-yours and
   * elsewhere. Nothing below re-derives that from caller input.
   */
  const before = await getReviewBundle(prescriptionId, ctx.locationId, templateId);
  if (!before.ok) return failedReview(before);

  // Still a draft? A finalised prescription's signature is already fixed.
  const detail = await getPrescription(prescriptionId, ctx.locationId);
  if (!detail.ok) {
    return { ok: false, kind: "error", message: "This prescription could not be read." };
  }
  if (detail.prescription.status !== "DRAFT") {
    return { ok: false, kind: "error", message: translateRxError("PRESCRIPTION_NOT_DRAFT").message };
  }

  const need = signatureNeed({
    showSignature: before.review.bundle.template.showSignature,
    sourcePath: await currentSignaturePath(),
  });

  if (need.kind === "unavailable") {
    /**
     * The layout says a signature prints and the doctor has none on file. We do
     * not invent a blank one: a prescription that looks signed and is not is
     * worse than one that plainly says it cannot be prepared yet.
     */
    return {
      ok: false,
      kind: "signature-unavailable",
      message:
        "This layout prints a signature, but you have not added one yet. Add your signature in Settings → Your profile, or use a layout without a signature.",
    };
  }

  if (need.kind === "required") {
    if (!canFreezeSignatures()) {
      // Configuration, not a clinical problem — and it must not read like one.
      console.error("[prescriptions] SUPABASE_SERVICE_ROLE_KEY is not configured");
      return {
        ok: false,
        kind: "error",
        message:
          "Prescriptions cannot be prepared on this deployment yet because signature storage is not configured.",
      };
    }

    const frozen = await freezeSignature(supabaseSignatureStore(), {
      prescriptionId,
      sourcePath: need.sourcePath,
      // Derived by the database from the OWNING doctor and this prescription.
      // The browser never supplies it and never sees it before this point.
      destinationPath: before.review.expectedSignaturePath,
    });

    if (!frozen.ok) return failedFreeze(frozen);
  }

  /**
   * A FRESH bundle, because the one we validated against no longer describes
   * the prescription — it was built before the signature existed. This is the
   * bundle the doctor reads and, in 7C-2B, approves.
   */
  const after = await getReviewBundle(prescriptionId, ctx.locationId, templateId);
  if (!after.ok) {
    /**
     * The freeze succeeded and the re-read did not. Nothing is lost and nothing
     * is wrong — the object is idempotent and the next attempt will verify it —
     * but we must not claim the prescription is ready when we cannot show it.
     */
    return {
      ok: false,
      kind: "unverified",
      message:
        "The signature was added, but the prescription could not be reloaded. Try preparing it again — nothing will be duplicated.",
    };
  }

  return { ok: true, review: after.review, signatureRequired: need.kind === "required" };
}

export type PrepareResult =
  | { ok: true; review: unknown; signatureRequired: boolean }
  /** The layout wants a signature the doctor does not have. */
  | { ok: false; kind: "signature-unavailable"; message: string }
  /** Something else is already at the frozen path. Never overwritten. */
  | { ok: false; kind: "mismatch"; message: string }
  /** It may be frozen; we could not confirm. Retrying is safe. */
  | { ok: false; kind: "unverified"; message: string }
  | { ok: false; kind: "error"; message: string };

/** The doctor's own current profile signature, read under their own RLS. */
async function currentSignaturePath(): Promise<string | null> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("doctor_profiles")
    .select("signature_url")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data?.signature_url as string | null) ?? null;
}

function failedReview(outcome: Extract<ReviewOutcome, { ok: false }>): PrepareResult {
  switch (outcome.reason) {
    case "logo-unsupported":
      return {
        ok: false,
        kind: "error",
        message: translateRxError("TEMPLATE_LOGO_UNSUPPORTED").message,
      };
    case "template-unavailable":
      return { ok: false, kind: "error", message: "That layout is not available here." };
    case "unsupported-schema":
      return {
        ok: false,
        kind: "error",
        message: "This prescription needs a newer version of the app to prepare safely.",
      };
    case "not-found":
      return {
        ok: false,
        kind: "error",
        message: "This prescription is no longer available at your current location.",
      };
    default:
      return { ok: false, kind: "error", message: "The prescription could not be loaded." };
  }
}

function failedFreeze(outcome: Extract<FreezeOutcome, { ok: false }>): PrepareResult {
  switch (outcome.kind) {
    case "source-missing":
      return {
        ok: false,
        kind: "signature-unavailable",
        message:
          "Your signature image could not be found. Re-upload it in Settings → Your profile, then prepare this prescription again.",
      };

    /**
     * We wrote and read back different bytes than we sent. Storage disagreed
     * with itself; nothing about the prescription is wrong.
     */
    case "mismatch":
      console.error(
        "[prescriptions] FROZEN SIGNATURE WRITE MISMATCH — manual review required",
        outcome.path,
        `expected ${outcome.expected}`,
        `found ${outcome.found}`,
      );
      return {
        ok: false,
        kind: "mismatch",
        message:
          "The signature could not be stored correctly. Nothing has been changed — try again, and tell support if it keeps happening.",
      };

    /**
     * Something is at this prescription's signature path that trusted code did
     * not put there, or our own object no longer hashes to what we recorded.
     * The bucket is append-only, so there is no repair — only a refusal and an
     * alert. NOT the same as "the doctor changed their profile signature",
     * which is handled by reusing the frozen object.
     */
    case "untrusted":
      console.error(
        "[prescriptions] UNTRUSTED OBJECT AT FROZEN SIGNATURE PATH — manual review required",
        outcome.path,
        outcome.reason,
      );
      return {
        ok: false,
        kind: "mismatch",
        message:
          "This prescription's signature could not be verified, so it cannot be prepared. Write a new prescription for this patient, and tell support about this one.",
      };

    case "corrupt":
      console.error(
        "[prescriptions] FROZEN SIGNATURE FAILED ITS OWN CHECKSUM — manual review required",
        outcome.path,
        `expected ${outcome.expected}`,
        `found ${outcome.found}`,
      );
      return {
        ok: false,
        kind: "mismatch",
        message:
          "This prescription's signature no longer matches what was stored with it, so it cannot be prepared. Write a new prescription for this patient, and tell support about this one.",
      };

    case "unverifiable":
      return {
        ok: false,
        kind: "unverified",
        message:
          "The signature may have been added, but we could not read it back to check it. Try preparing this prescription again — nothing will be duplicated.",
      };

    default:
      console.error("[prescriptions] freeze failed", outcome.message);
      return {
        ok: false,
        kind: "error",
        message: "The signature could not be added just now. Try again in a moment.",
      };
  }
}

export type FinalizeResult = { kind: FinalizeKind; message: string; version?: number };

/**
 * Approve a prescription. The irreversible write.
 *
 * The browser sends four things and nothing else: which prescription, which
 * layout, the version it believes, and the digest it read. Never a snapshot,
 * never a signature path, never a location — `finalize_prescription` rebuilds
 * the whole document from authoritative rows and refuses if the digest moved,
 * so a modified client cannot approve content the doctor never saw.
 *
 * Every branch below answers one question before anything else: DID IT COMMIT?
 * The classification is pure and tabulated in `finalize-outcome.ts` precisely
 * so it cannot drift into conditionals nobody can see all of at once — which is
 * how the same defect reached review twice already.
 */
export async function finalizePrescriptionAction(input: {
  prescriptionId: string;
  templateId: string | null;
  expectedVersion: number;
  reviewedDigest: string;
}): Promise<FinalizeResult> {
  const parsed = z
    .object({
      prescriptionId: z.uuid(),
      templateId: z.uuid().nullable(),
      expectedVersion: z.number().int().positive(),
      reviewedDigest: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .safeParse(input);

  if (!parsed.success) {
    return { kind: "error", message: "That approval could not be read. Reload and try again." };
  }

  const { prescriptionId, templateId, expectedVersion, reviewedDigest } = parsed.data;
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("finalize_prescription", {
    p_prescription_id: prescriptionId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: expectedVersion,
    p_template_id: templateId,
    p_review_digest: reviewedDigest,
  });

  const refusal = classifyRefusal(error ?? null);

  /**
   * A refusal we can PROVE our own function raised wrote nothing, so it needs
   * no status read — and reading would only add a way to fail.
   *
   * Everything else DOES get read, including errors we do not recognise. A
   * request can commit in Postgres and then lose its response; an unrecognised
   * error is not evidence of anything, and treating it as a proven failure
   * would put the Finalize button back in front of a doctor whose prescription
   * is already signed.
   */
  if (refusal === "refused") {
    const t = safe("finalize_prescription", error!.message);
    return { kind: "error", message: t.message };
  }

  if (refusal === "unknown") {
    console.error(
      "[prescriptions] finalisation failed in a way we cannot classify — treating the commit state as UNKNOWN",
      prescriptionId,
      error?.message ?? "(no message)",
    );
  }

  const status = await readStatus(prescriptionId, ctx.locationId);
  const kind = classifyFinalize({
    refusal,
    // The version a finalisation may claim is expectedVersion + 1, exactly.
    earnedVersion: refusal === "none" ? acceptVersion(data, expectedVersion) : null,
    status,
  });

  if (refusal === "none" && kind === "finalization-unconfirmed") {
    console.error(
      "[prescriptions] finalisation may have committed but could not be confirmed",
      prescriptionId,
      `status=${status ?? "unreadable"}`,
    );
  }

  if (kind === "finalized" || kind === "already-finalized") {
    revalidatePath(`/prescription/${prescriptionId}`);
  }

  return { kind, message: finalizeMessage(kind), version: acceptVersion(data, expectedVersion) ?? undefined };
}

/**
 * Recover from an uncertain or refused approval WITHOUT writing anything.
 *
 * Recovery never re-submits. It reads the authoritative status, and the read
 * decides — because the only safe way out of "it may have committed" is to
 * find out, not to try again.
 */
export async function finalizeRecoveryAction(input: {
  prescriptionId: string;
  wasCertainlyRejected: boolean;
}): Promise<FinalizeResult> {
  const parsed = z
    .object({ prescriptionId: z.uuid(), wasCertainlyRejected: z.boolean() })
    .safeParse(input);
  if (!parsed.success) {
    return { kind: "finalization-unconfirmed", message: RX_FINALIZE_UNCONFIRMED_MESSAGE };
  }

  const ctx = await requireLocationContext();
  const status = await readStatus(parsed.data.prescriptionId, ctx.locationId);
  const kind = resolveAfterRecovery({
    wasCertainlyRejected: parsed.data.wasCertainlyRejected,
    status,
  });

  if (kind === "already-finalized") revalidatePath(`/prescription/${parsed.data.prescriptionId}`);
  return { kind, message: finalizeMessage(kind) };
}

/** The prescription's authoritative status, or null when it cannot be read. */
async function readStatus(
  prescriptionId: string,
  locationId: string,
): Promise<AuthoritativeStatus> {
  const outcome = await getPrescription(prescriptionId, locationId);
  if (!outcome.ok) return null;
  return outcome.prescription.status as AuthoritativeStatus;
}

/** What the database refused with, before we decide what it means. */
function finalizeMessage(kind: FinalizeKind): string {
  switch (kind) {
    case "finalized":
      return "This prescription is approved and is now part of the patient's record.";
    case "already-finalized":
      return RX_FINALIZE_ALREADY_MESSAGE;
    case "review-stale":
      return RX_FINALIZE_STALE_MESSAGE;
    case "conflict-rejected":
      return RX_FINALIZE_REJECTED_MESSAGE;
    case "finalization-unconfirmed":
      return RX_FINALIZE_UNCONFIRMED_MESSAGE;
    default:
      return GENERIC_RX_ERROR;
  }
}

/**
 * A short-lived URL for the frozen signature image.
 *
 * Generated per request under the DOCTOR's own client, so `may_read_prescription_asset`
 * decides. NEVER stored: `signature_asset_path` holds the path, and a URL that
 * expires would turn a permanent record into a temporary one.
 */
export async function frozenSignatureUrlAction(
  prescriptionId: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  const parsed = z.uuid().safeParse(prescriptionId);
  if (!parsed.success) return { ok: false };

  const ctx = await requireLocationContext();
  const detail = await getReviewBundle(prescriptionId, ctx.locationId, null);
  if (!detail.ok || !detail.review.bundle.signature) return { ok: false };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("prescription-assets")
    .createSignedUrl(detail.review.bundle.signature.path, 120);

  if (error || !data?.signedUrl) return { ok: false };
  return { ok: true, url: data.signedUrl };
}

export async function medicineSuggestionsAction(query: string): Promise<Suggestion[]> {
  await requireLocationContext();
  return getMedicineSuggestions(query);
}
