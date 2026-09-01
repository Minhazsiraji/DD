/**
 * The document vocabulary — ONE catalog, shared by the form, the filters, the
 * list and the patient record.
 *
 * Deliberately not `server-only`: the upload form is a client component and
 * must render the same list the server validates against. A second hardcoded
 * list in a component is how a type ends up selectable and then rejected.
 *
 * ADDING A TYPE is `ALTER TYPE public.document_type ADD VALUE` plus one entry
 * here. No policy, no query and no component changes.
 */

export const DOCUMENT_TYPES = [
  "LAB_REPORT",
  "IMAGING_REPORT",
  "PREVIOUS_PRESCRIPTION",
  "DISCHARGE_SUMMARY",
  "REFERRAL",
  "MEDICAL_CERTIFICATE",
  "OTHER",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  LAB_REPORT: "Lab report",
  IMAGING_REPORT: "Imaging report",
  PREVIOUS_PRESCRIPTION: "Previous prescription",
  DISCHARGE_SUMMARY: "Discharge summary",
  REFERRAL: "Referral",
  MEDICAL_CERTIFICATE: "Medical certificate",
  OTHER: "Other",
};

export function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * What may be stored, and it is a short list on purpose.
 *
 * PDF and photographs cover a lab slip, a scan report and a phone picture of a
 * paper prescription, which is what a chamber actually receives. Office
 * documents and archives are not here: they carry active content, they cannot
 * be rendered inline, and "we accept everything" is how a document store
 * becomes a malware store.
 *
 * The same three values appear in the bucket's `allowed_mime_types`, in the
 * table's CHECK constraint and in the write function. Three walls, one list.
 */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** 10 MB. A phone photograph of a report is ~2–5 MB; a multi-page PDF scan more. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * The stored extension, chosen from the SNIFFED type — never from the uploaded
 * filename. `report.pdf.exe` names itself; it does not get to name the object.
 */
export const EXTENSION_FOR_MIME: Record<AllowedMimeType, "pdf" | "jpg" | "png"> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export const MIME_LABEL: Record<AllowedMimeType, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
};

/** What the file picker offers. Convenience only — never a control. */
export const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One document as every reader in the app sees it. */
export interface PatientDocumentSummary {
  id: string;
  patientId: string;
  patientName: string;
  patientNumber: string;
  documentType: DocumentType;
  title: string;
  /** The date the document is ABOUT, not when it was filed. May be null. */
  documentDate: string | null;
  notes: string | null;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  encounterId: string | null;
  locationName: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  createdAt: string;
}
