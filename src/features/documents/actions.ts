"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { classifyUpload, documentStoragePath, SNIFF_BYTES } from "./file-validation";
import { DOCUMENT_BUCKET } from "./queries";
import {
  archiveDocumentSchema,
  uploadDocumentSchema,
  type DocumentActionState,
} from "./schema";

/**
 * Document writes.
 *
 * Two systems, and only one of them can roll back. Postgres can; S3-compatible
 * storage cannot enlist in that rollback. So this is ordered to fail in the
 * direction that does least harm â€” the object is stored first and the metadata
 * row second, because a stored object with no row is invisible and recoverable,
 * while a row with no object is a document the record PROMISES and cannot
 * produce. The orphan is then cleaned up, and the cleanup is checked rather
 * than assumed.
 */

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

const GENERIC_REFUSAL =
  "That document could not be filed. Check the patient and try again.";

/**
 * Turn a database refusal into something a doctor can act on.
 *
 * The 42501s all say the same thing on purpose: "not your patient", "no such
 * patient" and "you do not practise there" must not be distinguishable, or the
 * form becomes a way to ask which patient ids exist.
 */
function messageForDbError(message: string): string {
  if (message.includes("DOCUMENT_MIME_REJECTED"))
    return "Only PDF, JPG and PNG files can be stored here.";
  if (message.includes("DOCUMENT_TOO_LARGE"))
    return "That file is over 10 MB. Use a smaller scan or photo.";
  if (message.includes("DOCUMENT_TITLE_INVALID")) return "Give the document a title.";
  if (message.includes("DOCUMENT_NOTES_INVALID"))
    return "Keep notes under 2000 characters.";
  if (message.includes("DOCUMENT_DATE_INVALID"))
    return "That document date is in the future. Check it.";
  if (message.includes("DOCUMENT_PATH_INVALID") || message.includes("DOCUMENT_FILENAME_INVALID"))
    return "That file could not be accepted. Try uploading it again.";
  return GENERIC_REFUSAL;
}

export async function uploadDocumentAction(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = uploadDocumentSchema.safeParse({
    patientId: formData.get("patientId") ?? "",
    documentType: formData.get("documentType") ?? "OTHER",
    title: formData.get("title") ?? "",
    documentDate: formData.get("documentDate") ?? "",
    notes: formData.get("notes") ?? "",
    encounterId: formData.get("encounterId") ?? "",
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  }
  const input = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, fieldErrors: { file: ["Choose the file you want to store."] } };
  }

  /**
   * THE BYTES DECIDE, NOT THE NAME AND NOT THE BROWSER.
   *
   * Only the first few bytes are read for the decision; the whole file is read
   * once, here, because it has to be uploaded anyway and reading a stream twice
   * is what turns "validated" into "validated something else".
   */
  const bytes = new Uint8Array(await file.arrayBuffer());
  const verdict = classifyUpload({
    sizeBytes: bytes.byteLength,
    leadingBytes: bytes.subarray(0, SNIFF_BYTES),
    claimedType: file.type,
  });

  if (!verdict.ok) {
    return { ok: false, fieldErrors: { file: [verdict.message] } };
  }

  const { locationId } = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  /**
   * A fresh random object name, never the uploaded filename. The filename is
   * attacker-controlled text and is kept only as a label the doctor recognises.
   */
  const { data: uploadContext, error: contextError } = await supabase.rpc("get_patient_document_upload_context", {
    p_patient_id: input.patientId,
    p_practice_location_id: locationId,
  });
  if (contextError || !uploadContext) return { ok: false, message: GENERIC_REFUSAL };
  const ownerUserId = String((uploadContext as { owner_user_id?: string }).owner_user_id ?? "");
  if (!ownerUserId) return { ok: false, message: GENERIC_REFUSAL };

  const storagePath = documentStoragePath({
    ownerUserId,
    patientId: input.patientId,
    locationId,
    objectId: crypto.randomUUID(),
    extension: verdict.extension,
  });

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, bytes, {
      contentType: verdict.mimeType,
      // Never overwrite. The name is random, so a collision means something is
      // wrong, and silently replacing a clinical asset is not a recovery.
      upsert: false,
    });

  if (uploadError) {
    console.error("[documents] upload failed", uploadError.message);
    return {
      ok: false,
      fieldErrors: { file: ["That file could not be stored. Try again."] },
    };
  }

  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data, error } = await supabase.rpc("create_patient_document", {
    p_patient_id: input.patientId,
    p_practice_location_id: locationId,
    p_encounter_id: input.encounterId,
    p_document_type: input.documentType,
    p_title: input.title,
    p_document_date: input.documentDate,
    p_notes: input.notes,
    p_storage_path: storagePath,
    p_mime_type: verdict.mimeType,
    p_size_bytes: bytes.byteLength,
    p_sha256: sha256,
    p_original_filename: file.name,
  });

  if (error) {
    /**
     * The row did not land, so the object is an orphan â€” invisible to every
     * reader, and it must not be left behind. There is no DELETE policy on this
     * bucket, so this WILL fail, and that is deliberate: an orphan nobody can
     * reach is a smaller problem than a delete path that exists. It is logged
     * loudly rather than silently, because a Supabase delete blocked by RLS
     * removes nothing and raises nothing â€” an empty list with no error.
     */
    const { data: removed, error: removeError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([storagePath]);

    if (removeError || (removed ?? []).length === 0) {
      console.error(
        "[documents] ORPHANED OBJECT â€” metadata write failed and the file is still stored",
        storagePath,
        removeError?.message ?? "delete removed nothing",
      );
    }

    console.error("[documents] create failed", error.message);
    return { ok: false, message: messageForDbError(error.message) };
  }

  const documentId = data as unknown as string;

  revalidatePath("/documents");
  revalidatePath(`/patients/${input.patientId}`);

  return { ok: true, message: "Document filed.", documentId };
}

export async function archiveDocumentAction(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const parsed = archiveDocumentSchema.safeParse({
    documentId: formData.get("documentId") ?? "",
    reason: formData.get("reason") ?? "",
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("archive_patient_document", {
    p_document_id: parsed.data.documentId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    if (error.message.includes("DOCUMENT_ALREADY_ARCHIVED")) {
      // Already in the state the doctor asked for. Say so; do not call it a failure.
      revalidatePath("/documents");
      return { ok: true, message: "That document was already removed." };
    }
    console.error("[documents] archive failed", error.message);
    return { ok: false, message: "That document could not be removed. Try again." };
  }

  revalidatePath("/documents");
  return { ok: true, message: "Document removed from the working record." };
}

export async function restoreDocumentAction(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const documentId = String(formData.get("documentId") ?? "");
  if (!z.uuid().safeParse(documentId).success) {
    return { ok: false, message: "That document could not be restored." };
  }

  await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("restore_patient_document", {
    p_document_id: documentId,
  });

  if (error) {
    if (error.message.includes("DOCUMENT_NOT_ARCHIVED")) {
      revalidatePath("/documents");
      return { ok: true, message: "That document was already in the record." };
    }
    console.error("[documents] restore failed", error.message);
    return { ok: false, message: "That document could not be restored. Try again." };
  }

  revalidatePath("/documents");
  return { ok: true, message: "Document restored." };
}

/**
 * Record that a document was opened.
 *
 * `emitAudit`, NOT a transactional log, and that is the correct choice here:
 * viewing a record must never block care (ADR 0007). Metadata writes are the
 * fail-closed path; a read is not.
 */
export type DocumentAccessKind = "viewed" | "downloaded" | "printed";

/** Fail closed: no document bytes are released unless the access audit lands. */
export async function logDocumentAccessAction(
  documentId: string,
  kind: DocumentAccessKind,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const h = await headers();
  const { error } = await supabase.rpc("log_patient_document_access", {
    p_document_id: documentId,
    p_action: `document.${kind}`,
    p_ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    p_user_agent: h.get("user-agent"),
  });
  if (error) {
    console.error("[documents] access audit failed", kind, error.message);
    return false;
  }
  return true;
}
