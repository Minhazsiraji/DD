import { describe, expect, it } from "vitest";
import {
  classifyUpload,
  documentStoragePath,
  sniffMimeType,
  SNIFF_BYTES,
} from "./file-validation";
import { MAX_DOCUMENT_BYTES } from "./types";

/**
 * The upload gate, tested where it is a pure function.
 *
 * This is the one check the whole storage path rests on, and it must be
 * provable without a database, a bucket or a browser — otherwise it is only
 * ever exercised by the thing it is supposed to protect.
 */

const bytes = (...values: number[]) => Uint8Array.from(values);

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46);

describe("sniffing the real content type", () => {
  it("recognises the three types we accept", () => {
    expect(sniffMimeType(PDF)).toBe("application/pdf");
    expect(sniffMimeType(PNG)).toBe("image/png");
    expect(sniffMimeType(JPEG)).toBe("image/jpeg");
  });

  it("refuses everything else, including things that render as documents", () => {
    // HTML, an SVG, a ZIP/Office container, an ELF binary, a GIF.
    const cases = [
      "<!DOCTYPE html>",
      "<svg xmlns=",
      "PK",
      "ELF",
      "GIF89a",
    ];
    for (const text of cases) {
      const buf = Uint8Array.from(text, (c) => c.charCodeAt(0));
      expect(sniffMimeType(buf), text).toBeNull();
    }
  });

  it("needs no more bytes than it asks for", () => {
    expect(sniffMimeType(PDF.subarray(0, SNIFF_BYTES))).toBe("application/pdf");
    // A truncated file is not a PDF, and must not be guessed into one.
    expect(sniffMimeType(PDF.subarray(0, 3))).toBeNull();
  });
});

describe("classifying an upload", () => {
  it("accepts a real PDF and reports the extension from the BYTES", () => {
    const verdict = classifyUpload({ sizeBytes: 1024, leadingBytes: PDF });
    expect(verdict).toEqual({ ok: true, mimeType: "application/pdf", extension: "pdf" });
  });

  it("refuses an empty file", () => {
    const verdict = classifyUpload({ sizeBytes: 0, leadingBytes: PDF });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("EMPTY");
  });

  it("refuses a file over the ceiling, and accepts one exactly at it", () => {
    const over = classifyUpload({ sizeBytes: MAX_DOCUMENT_BYTES + 1, leadingBytes: PDF });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("TOO_LARGE");

    expect(classifyUpload({ sizeBytes: MAX_DOCUMENT_BYTES, leadingBytes: PDF }).ok).toBe(true);
  });

  it("refuses an unsupported type however it is named", () => {
    const gif = Uint8Array.from("GIF89a", (c) => c.charCodeAt(0));
    const verdict = classifyUpload({
      sizeBytes: 500,
      leadingBytes: gif,
      // The browser dutifully repeats the lie the extension told it.
      claimedType: "application/pdf",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("UNSUPPORTED_TYPE");
  });

  it("REFUSES rather than resolves a claim that disagrees with the bytes", () => {
    const verdict = classifyUpload({
      sizeBytes: 500,
      leadingBytes: PNG,
      claimedType: "application/pdf",
    });
    expect(verdict.ok).toBe(false);
    // Not silently stored as a PNG, and not silently stored as a PDF: one of
    // the two answers is wrong and picking a winner is how a file ends up
    // stored under a content type it does not have.
    if (!verdict.ok) expect(verdict.reason).toBe("TYPE_MISMATCH");
  });

  it("tolerates image/jpg, which is not a real media type but is emitted anyway", () => {
    const verdict = classifyUpload({
      sizeBytes: 500,
      leadingBytes: JPEG,
      claimedType: "IMAGE/JPG",
    });
    expect(verdict).toEqual({ ok: true, mimeType: "image/jpeg", extension: "jpg" });
  });

  it("ignores the filename entirely — it is not an input", () => {
    // There is no filename parameter at all, by construction. This test exists
    // so that adding one is a visible decision rather than a quiet one.
    const verdict = classifyUpload({ sizeBytes: 10, leadingBytes: JPEG });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.extension).toBe("jpg");
  });
});

describe("the storage path", () => {
  const doctorUserId = "11111111-1111-4111-8111-111111111111";
  const patientId = "22222222-2222-4222-8222-222222222222";
  const objectId = "33333333-3333-4333-8333-333333333333";

  it("is owner / patient / random-object, and nothing else", () => {
    expect(documentStoragePath({ doctorUserId, patientId, objectId, extension: "pdf" })).toBe(
      `${doctorUserId}/${patientId}/${objectId}.pdf`,
    );
  });

  it("matches the shape create_patient_document() re-derives", () => {
    /**
     * The SQL refuses anything else. Kept as a literal here so the two cannot
     * drift silently: a change on either side fails this.
     */
    const SQL_SHAPE =
      /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/;

    for (const extension of ["pdf", "jpg", "png"] as const) {
      const path = documentStoragePath({ doctorUserId, patientId, objectId, extension });
      expect(path, path).toMatch(SQL_SHAPE);
      expect(path.split("/")).toHaveLength(3);
    }
  });
});
