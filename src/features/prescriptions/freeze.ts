import { createHash } from "node:crypto";

/**
 * Freezing a doctor's signature onto one prescription.
 *
 * The orchestration only. It is deliberately free of Supabase, of Next, and of
 * the request — it takes a small storage PORT and returns a decision — because
 * every interesting property of this operation is a failure mode, and failure
 * modes that need live object storage to reproduce do not get tested.
 *
 * Two rules, and the second one was learned in review:
 *
 *   1. A frozen signature is trustworthy because trusted code READ THE BYTES
 *      and verified them — never because a file sits at the expected path.
 *
 *   2. Once frozen, the object belongs to THAT PRESCRIPTION, not to the
 *      doctor's current profile. A doctor who updates their signature next
 *      week has changed what future prescriptions will carry; they have not
 *      invalidated a draft that was already prepared. So a retry verifies the
 *      frozen object against the hash recorded WHEN IT WAS FROZEN, never
 *      against today's profile signature.
 *
 * The destination is append-only: `prescription-assets` has no INSERT policy
 * for `authenticated` and no UPDATE or DELETE policy for anyone. This can write
 * once and can never repair a bad write — which is why an untrustworthy object
 * is a refusal rather than an overwrite.
 */

/** Identifies this writer, so a foreign object at the path is recognisable. */
export const FREEZE_MARKER = "doctors-diary/signature-freeze@1";

/** Written as immutable custom metadata when the object is first created. */
export interface FrozenMarker {
  frozenBy: string;
  frozenFor: string;
  sourceSha256: string;
}

export type Fetched =
  | { kind: "bytes"; bytes: Uint8Array; contentType: string | null }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export type Written = { kind: "ok" } | { kind: "exists" } | { kind: "error"; message: string };

export type Described =
  | { kind: "found"; marker: Partial<FrozenMarker> }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/**
 * The only storage this module knows about.
 *
 * Narrow on purpose: it cannot list, cannot delete, cannot overwrite. A port
 * that could do those things would eventually be asked to.
 */
export interface SignatureStore {
  read(bucket: string, path: string): Promise<Fetched>;
  /** Must be non-overwriting. `exists` is a normal answer, not a failure. */
  write(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    contentType: string,
    marker: FrozenMarker,
  ): Promise<Written>;
  /** The object's custom metadata, without downloading it. */
  describe(bucket: string, path: string): Promise<Described>;
}

export const SOURCE_BUCKET = "doctor-assets";
export const FROZEN_BUCKET = "prescription-assets";

export type FreezeOutcome =
  /** Written by this attempt, read back, verified byte-for-byte. */
  | { ok: true; kind: "frozen"; sha256: string; path: string }
  /**
   * Already frozen for this prescription, and verified against the hash
   * recorded at that time. Its bytes may differ from the doctor's CURRENT
   * profile signature, and that is correct — see rule 2 above.
   */
  | { ok: true; kind: "already-frozen"; sha256: string; path: string }
  /** Nothing frozen yet, and no signature to freeze. */
  | { ok: false; kind: "source-missing" }
  /** We wrote, read back, and got different bytes than we sent. */
  | { ok: false; kind: "mismatch"; expected: string; found: string; path: string }
  /** Something is at the path that trusted code did not put there. */
  | { ok: false; kind: "untrusted"; path: string; reason: string }
  /** Our own marker, but the bytes no longer hash to what it recorded. */
  | { ok: false; kind: "corrupt"; expected: string; found: string; path: string }
  /** The write may have landed; we could not read it back to find out. */
  | { ok: false; kind: "unverifiable"; message: string }
  | { ok: false; kind: "storage-error"; message: string };

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Is the object already at the destination one WE froze for THIS prescription,
 * and does it still hash to what we recorded?
 *
 * The authority is the marker written at freeze time — never the doctor's
 * current profile signature, which may legitimately have changed since.
 */
async function verifyExisting(
  store: SignatureStore,
  path: string,
  prescriptionId: string,
): Promise<FreezeOutcome | null> {
  const described = await store.describe(FROZEN_BUCKET, path);

  // Nothing frozen yet. The caller decides what to do about that.
  if (described.kind === "missing") return null;

  if (described.kind === "error") {
    return { ok: false, kind: "unverifiable", message: described.message };
  }

  const { frozenBy, frozenFor, sourceSha256 } = described.marker;

  /**
   * No trusted marker means trusted code did not create this. Since the bucket
   * has no INSERT policy, that should be impossible — which is exactly why it
   * is checked rather than assumed.
   */
  if (frozenBy !== FREEZE_MARKER) {
    return { ok: false, kind: "untrusted", path, reason: "no trusted freeze marker" };
  }
  if (frozenFor !== prescriptionId) {
    return { ok: false, kind: "untrusted", path, reason: "frozen for a different prescription" };
  }
  if (typeof sourceSha256 !== "string" || !HEX64.test(sourceSha256)) {
    return { ok: false, kind: "untrusted", path, reason: "no recorded content hash" };
  }

  const stored = await store.read(FROZEN_BUCKET, path);
  if (stored.kind === "missing" || stored.kind === "error") {
    return {
      ok: false,
      kind: "unverifiable",
      message: stored.kind === "error" ? stored.message : "The stored signature could not be read.",
    };
  }

  const found = sha256(stored.bytes);
  if (found !== sourceSha256) {
    // Our marker, wrong bytes. Unrepairable — the bucket is append-only.
    return { ok: false, kind: "corrupt", expected: sourceSha256, found, path };
  }

  return { ok: true, kind: "already-frozen", sha256: sourceSha256, path };
}

/**
 * Freeze one signature, idempotently.
 *
 * The DESTINATION is checked first. That order matters: a prescription already
 * prepared must keep working even if the doctor has since replaced or deleted
 * the profile signature it was frozen from. Reading the source first would
 * refuse such a prescription for `source-missing`, which is the disruption this
 * design exists to avoid.
 *
 * On a first freeze the source is read ONCE and the bytes held for the whole
 * attempt, so if the doctor replaces their signature mid-flight the bytes we
 * hash are the bytes we write.
 */
export async function freezeSignature(
  store: SignatureStore,
  input: { sourcePath: string; destinationPath: string; prescriptionId: string },
): Promise<FreezeOutcome> {
  // Already frozen? Then that object is the answer, whatever the profile says.
  const existing = await verifyExisting(store, input.destinationPath, input.prescriptionId);
  if (existing) return existing;

  const source = await store.read(SOURCE_BUCKET, input.sourcePath);
  if (source.kind === "missing") return { ok: false, kind: "source-missing" };
  if (source.kind === "error") {
    return { ok: false, kind: "storage-error", message: source.message };
  }

  const expected = sha256(source.bytes);
  const marker: FrozenMarker = {
    frozenBy: FREEZE_MARKER,
    frozenFor: input.prescriptionId,
    sourceSha256: expected,
  };

  const written = await store.write(
    FROZEN_BUCKET,
    input.destinationPath,
    source.bytes,
    source.contentType ?? "application/octet-stream",
    marker,
  );
  if (written.kind === "error") {
    return { ok: false, kind: "storage-error", message: written.message };
  }

  /**
   * Lost a race: another request created the object between our check and our
   * write. Fall back to verifying THAT object rather than assuming it is ours.
   */
  if (written.kind === "exists") {
    return (
      (await verifyExisting(store, input.destinationPath, input.prescriptionId)) ?? {
        ok: false,
        kind: "unverifiable",
        message: "A signature was stored by another request but could not be inspected.",
      }
    );
  }

  /**
   * Our own write, read back. "The API returned success" is not the same as
   * "the right bytes are stored".
   */
  const stored = await store.read(FROZEN_BUCKET, input.destinationPath);
  if (stored.kind === "missing") {
    return {
      ok: false,
      kind: "unverifiable",
      message: "The signature was stored but could not be read back to verify it.",
    };
  }
  if (stored.kind === "error") {
    return { ok: false, kind: "unverifiable", message: stored.message };
  }

  const found = sha256(stored.bytes);
  if (found !== expected) {
    return { ok: false, kind: "mismatch", expected, found, path: input.destinationPath };
  }

  return { ok: true, kind: "frozen", sha256: expected, path: input.destinationPath };
}

/**
 * Whether this prescription needs a frozen signature at all.
 *
 * Three states, kept apart because they mean different things to a doctor and
 * two of them are perfectly normal:
 *
 *   not-required   the layout hides the signature — nothing is missing
 *   unavailable    the layout shows one and the doctor has none on file
 *   required       there is a signature to freeze
 *
 * `unavailable` is NOT silently downgraded to "print a blank line". A layout
 * that says a signature prints, on a prescription with no signature, is a
 * disagreement the doctor has to settle.
 */
export type SignatureNeed =
  | { kind: "not-required" }
  | { kind: "unavailable" }
  | { kind: "required"; sourcePath: string };

export function signatureNeed(input: {
  showSignature: boolean;
  sourcePath: string | null;
}): SignatureNeed {
  if (!input.showSignature) return { kind: "not-required" };
  const path = (input.sourcePath ?? "").trim();
  if (path === "") return { kind: "unavailable" };
  return { kind: "required", sourcePath: path };
}
