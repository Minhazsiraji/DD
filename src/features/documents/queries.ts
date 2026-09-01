import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDocumentType, type PatientDocumentSummary, type DocumentType } from "./types";

/**
 * Document reads.
 *
 * Every one runs on the caller's own RLS-scoped client, and
 * `patient_documents_select` is a single branch — `owner_doctor_id =
 * current_doctor_id()`. There is no owner filter to remember here because
 * Postgres applies it, and no query in this file can widen it.
 *
 * That is also why staff see an empty Documents section on a patient they can
 * otherwise read: zero rows, no count, no "2 documents you may not open". A
 * count is a disclosure.
 */

export const DOCUMENT_BUCKET = "patient-documents";

/** How long a view link lives. Long enough to open, short enough to be useless if it leaks. */
export const DOCUMENT_URL_TTL_SECONDS = 60;

const COLUMNS =
  "id, patient_id, document_type, title, document_date, notes, mime_type," +
  " size_bytes, original_filename, encounter_id, archived_at, archive_reason, created_at," +
  " patients(full_name, patient_number), practice_locations(name)";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSummary(row: any): PatientDocumentSummary {
  const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
  const location = Array.isArray(row.practice_locations)
    ? row.practice_locations[0]
    : row.practice_locations;

  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: patient?.full_name ?? "Unknown patient",
    patientNumber: patient?.patient_number ?? "",
    documentType: isDocumentType(row.document_type)
      ? (row.document_type as DocumentType)
      : "OTHER",
    title: row.title,
    documentDate: row.document_date ?? null,
    notes: row.notes ?? null,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    originalFilename: row.original_filename,
    encounterId: row.encounter_id ?? null,
    locationName: location?.name ?? null,
    archivedAt: row.archived_at ?? null,
    archiveReason: row.archive_reason ?? null,
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface DocumentFilter {
  /** Matches the title or the original filename. */
  q?: string;
  patientId?: string;
  type?: DocumentType | "all";
  /** Inclusive, on the document's own clinical date. */
  from?: string;
  to?: string;
  /** Archived documents are out of the working list unless asked for. */
  archived?: boolean;
}

/**
 * The list, and whether it could be read at all.
 *
 * A bare array cannot tell "this patient has no documents" from "the query
 * failed", and on a clinical screen those mean opposite things — the first is a
 * fact about the patient, the second is a fact about the network. The same
 * lesson as the patient timeline, applied before it can be relearned.
 */
export interface DocumentListResult {
  ok: boolean;
  documents: PatientDocumentSummary[];
}

export async function listDocuments(
  filter: DocumentFilter = {},
  limit = 100,
): Promise<DocumentListResult> {
  const supabase = await createSupabaseServerClient();

  let request = supabase.from("patient_documents").select(COLUMNS);

  request = filter.archived
    ? request.not("archived_at", "is", null)
    : request.is("archived_at", null);

  if (filter.patientId) request = request.eq("patient_id", filter.patientId);
  if (filter.type && filter.type !== "all") request = request.eq("document_type", filter.type);
  if (filter.from) request = request.gte("document_date", filter.from);
  if (filter.to) request = request.lte("document_date", filter.to);

  const q = filter.q?.trim() ?? "";
  if (q) {
    // PostgREST reads these characters structurally; they are separators here.
    const escaped = q.replace(/[%,().]/g, " ").trim();
    if (escaped) {
      request = request.or(`title.ilike.%${escaped}%,original_filename.ilike.%${escaped}%`);
    }
  }

  /**
   * Ordered by the CLINICAL date first, then by when it was filed.
   *
   * `created_at` alone puts a report from March, uploaded today, above one from
   * last week — which reads as the newest result and is the oldest. `nullsFirst:
   * false` keeps documents with no clinical date from displacing dated ones.
   */
  const { data, error } = await request
    .order("document_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[documents] list failed", error.message);
    return { ok: false, documents: [] };
  }

  return { ok: true, documents: (data ?? []).map(toSummary) };
}

/** One patient's documents, chronologically. The reader the patient record uses. */
export async function getPatientDocuments(
  patientId: string,
  options: { includeArchived?: boolean; limit?: number } = {},
): Promise<DocumentListResult> {
  return listDocuments(
    { patientId, archived: options.includeArchived === true },
    options.limit ?? 50,
  );
}

/** One document, or null when the caller may not read it. Missing and not-yours are the same answer. */
export async function getDocument(id: string): Promise<PatientDocumentSummary | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("patient_documents")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return toSummary(data);
}

/**
 * A short-lived signed URL for a document.
 *
 * Signed with the CALLER'S OWN client, never a service-role one. Supabase
 * requires SELECT on the object before it will sign, so storage RLS is the wall
 * here too — a link cannot be minted for an object the caller could not read,
 * even if they somehow learned its path.
 *
 * The storage path is read here and never returned. A path is not a secret, but
 * handing one to a browser invites code that treats it as an address.
 */
export async function createDocumentUrl(
  id: string,
  options: { download?: boolean } = {},
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  const { data: row, error } = await supabase
    .from("patient_documents")
    .select("storage_path, original_filename")
    .eq("id", id)
    .maybeSingle();

  if (error || !row) return null;

  const storagePath = (row as { storage_path: string }).storage_path;
  const filename = (row as { original_filename: string }).original_filename;

  const { data, error: signError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, DOCUMENT_URL_TTL_SECONDS, {
      // Supabase sets Content-Disposition from this. Viewing keeps the browser's
      // own renderer, which is what a doctor wants for a one-page lab slip.
      download: options.download ? filename : undefined,
    });

  if (signError || !data?.signedUrl) {
    console.error("[documents] signing failed", signError?.message ?? "no url");
    return null;
  }
  return data.signedUrl;
}

export interface EncounterOption {
  id: string;
  startedAt: string;
  locationName: string | null;
}

/**
 * The consultations a document may be attached to.
 *
 * Read straight from `encounters`, whose SELECT policy is already the rule this
 * needs. Scoped to the one patient, so the picker cannot become a way to browse
 * a doctor's consultation history from the upload form.
 */
export async function listEncountersForPatient(
  patientId: string,
  limit = 20,
): Promise<EncounterOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("encounters")
    .select("id, started_at, practice_locations(name)")
    .eq("patient_id", patientId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[documents] encounter options failed", error.message);
    return [];
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((row: any) => {
    const location = Array.isArray(row.practice_locations)
      ? row.practice_locations[0]
      : row.practice_locations;
    return {
      id: row.id,
      startedAt: row.started_at,
      locationName: location?.name ?? null,
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
