import {
  ALLOWED_MIME_TYPES,
  EXTENSION_FOR_MIME,
  MAX_DOCUMENT_BYTES,
  type AllowedMimeType,
} from "./types";

/**
 * What kind of file is this, REALLY?
 *
 * Three things claim to answer that and none of them is evidence:
 *
 *   the extension    typed by whoever made the file
 *   `file.type`      set by the browser from the extension, and forgeable
 *                    outright by anything that is not a browser
 *   the filename     attacker-controlled text throughout
 *
 * So the answer comes from the bytes. A pure function over the first few of
 * them, with no I/O, because it is the one check the whole upload path rests on
 * and it has to be testable without a database, a bucket or a browser.
 *
 * This is not a virus scanner and does not pretend to be. It answers one
 * question — is this a PDF, a JPEG or a PNG — and refuses everything else,
 * which is what stops an HTML file with active content, a renamed executable,
 * or an SVG from entering a store whose contents are later handed back to a
 * browser.
 */

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((b, i) => bytes[i] === b);
}

/**
 * The content type the BYTES say this is, or null.
 *
 * Only the first 8 bytes are ever needed, so callers may pass a slice.
 */
export function sniffMimeType(bytes: Uint8Array): AllowedMimeType | null {
  if (startsWith(bytes, PDF)) return "application/pdf";
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  return null;
}

/** How many leading bytes `sniffMimeType` can possibly need. */
export const SNIFF_BYTES = 8;

export type FileRejection =
  | "EMPTY"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "TYPE_MISMATCH";

export interface FileAccepted {
  ok: true;
  /** Sniffed, not claimed. This is what gets stored and recorded. */
  mimeType: AllowedMimeType;
  extension: "pdf" | "jpg" | "png";
}

export interface FileRejected {
  ok: false;
  reason: FileRejection;
  message: string;
}

export const FILE_REJECTION_MESSAGE: Record<FileRejection, string> = {
  EMPTY: "That file is empty. Choose the report you want to keep.",
  TOO_LARGE: "That file is over 10 MB. Use a smaller scan or photo.",
  UNSUPPORTED_TYPE: "Only PDF, JPG and PNG files can be stored here.",
  /**
   * Said plainly rather than as "unsupported type". A doctor whose scanner
   * writes a TIFF named .pdf needs to know the file is not what it says it is —
   * otherwise they retry the same file and get the same refusal forever.
   */
  TYPE_MISMATCH: "That file is not really a PDF, JPG or PNG, whatever it is named.",
};

/**
 * Decide on a file from its size and its leading bytes.
 *
 * `claimedType` is accepted only to be CROSS-CHECKED, never to decide. A
 * mismatch between what the browser says and what the bytes say is refused
 * rather than resolved: one of the two is wrong, and quietly picking a winner
 * is how a file ends up stored under a content type it does not have.
 */
export function classifyUpload(input: {
  sizeBytes: number;
  leadingBytes: Uint8Array;
  claimedType?: string | null;
}): FileAccepted | FileRejected {
  if (input.sizeBytes <= 0) {
    return { ok: false, reason: "EMPTY", message: FILE_REJECTION_MESSAGE.EMPTY };
  }
  if (input.sizeBytes > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: "TOO_LARGE", message: FILE_REJECTION_MESSAGE.TOO_LARGE };
  }

  const sniffed = sniffMimeType(input.leadingBytes);
  if (!sniffed) {
    return {
      ok: false,
      reason: "UNSUPPORTED_TYPE",
      message: FILE_REJECTION_MESSAGE.UNSUPPORTED_TYPE,
    };
  }

  const claimed = input.claimedType?.trim().toLowerCase() ?? "";
  if (claimed) {
    // `image/jpg` is not a real media type but browsers and scanners emit it.
    const normalised = claimed === "image/jpg" ? "image/jpeg" : claimed;
    const known = (ALLOWED_MIME_TYPES as readonly string[]).includes(normalised);
    if (!known) {
      return {
        ok: false,
        reason: "UNSUPPORTED_TYPE",
        message: FILE_REJECTION_MESSAGE.UNSUPPORTED_TYPE,
      };
    }
    if (normalised !== sniffed) {
      return {
        ok: false,
        reason: "TYPE_MISMATCH",
        message: FILE_REJECTION_MESSAGE.TYPE_MISMATCH,
      };
    }
  }

  return { ok: true, mimeType: sniffed, extension: EXTENSION_FOR_MIME[sniffed] };
}

/**
 * The object key for a new document.
 *
 * `<owning doctor's auth user id>/<patient id>/<random uuid>.<ext>` — the exact
 * shape `create_patient_document()` re-derives and refuses to accept anything
 * else for. The original filename appears nowhere in it: a filename must not
 * choose a path.
 */
export function documentStoragePath(input: {
  doctorUserId: string;
  patientId: string;
  objectId: string;
  extension: "pdf" | "jpg" | "png";
}): string {
  return `${input.doctorUserId}/${input.patientId}/${input.objectId}.${input.extension}`;
}
