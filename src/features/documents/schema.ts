import { z } from "zod";
import { DOCUMENT_TYPES } from "./types";

/**
 * Upload metadata, validated before a single byte is stored.
 *
 * "use server" files may export only async functions, so the schemas live here
 * — the same reason the doctor and prescription modules split theirs out.
 *
 * These bounds are restated in `create_patient_document()`. That is not
 * belt-and-braces for its own sake: this layer produces a good message for a
 * doctor who mistyped, and the database refuses the same thing for a caller who
 * never rendered the form.
 */

const trimmedOptional = z
  .string()
  .trim()
  .transform((v) => (v.length > 0 ? v : null))
  .nullable();

export const uploadDocumentSchema = z.object({
  patientId: z.uuid("Choose the patient this document belongs to."),
  documentType: z.enum(DOCUMENT_TYPES),
  title: z
    .string()
    .trim()
    .min(1, "Give the document a title.")
    .max(200, "Keep the title under 200 characters."),
  /**
   * An empty date input posts "", which is not a date and is not an error
   * either — it means "not recorded". Coerced here so the action never has to
   * decide what "" meant.
   */
  documentDate: z
    .string()
    .trim()
    .transform((v) => (v.length > 0 ? v : null))
    .nullable()
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date."),
  notes: trimmedOptional.refine(
    (v) => v === null || v.length <= 2000,
    "Keep notes under 2000 characters.",
  ),
  /** Optional clinical anchor; "" means none. */
  encounterId: trimmedOptional.refine(
    (v) => v === null || z.uuid().safeParse(v).success,
    "That consultation is not valid.",
  ),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const archiveDocumentSchema = z.object({
  documentId: z.uuid(),
  /**
   * REQUIRED, and it is the point of the whole design. Removing a clinical
   * document without saying why leaves the record unable to answer the only
   * question anyone will later ask about it.
   */
  reason: z
    .string()
    .trim()
    .min(3, "Say briefly why this document is being removed.")
    .max(500, "Keep the reason under 500 characters."),
});

export interface DocumentActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set on a successful upload so the form can send the doctor somewhere useful. */
  documentId?: string;
}

export const emptyDocumentState: DocumentActionState = { ok: false };
