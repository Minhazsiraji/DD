import { createHash } from "node:crypto";

/**
 * Freezing a doctor's signature onto one prescription.
 *
 * The orchestration only. It is deliberately free of Supabase, of Next, and of
 * the request — it takes a small storage PORT and returns a decision — because
 * every interesting property of this operation is a failure mode, and failure
 * modes that need live object storage to reproduce do not get tested.
 *
 * The rule this exists to enforce:
 *
 *   a frozen signature is trustworthy because trusted code READ THE BYTES and
 *   verified them — never because a file happens to sit at the expected path.
 *
 * The destination is append-only: `prescription-assets` has no INSERT policy
 * for `authenticated` and no UPDATE or DELETE policy for anyone. So this can
 * write once and can never repair a bad write. That is why a mismatch is a
 * refusal rather than an overwrite: there is no overwrite available, and
 * pretending otherwise would be the more dangerous design.
 */

/** Bytes, or the two ways there are none. */
export type Fetched =
  | { kind: "bytes"; bytes: Uint8Array; contentType: string | null }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export type Written = { kind: "ok" } | { kind: "exists" } | { kind: "error"; message: string };

/**
 * The only storage this module knows about.
 *
 * Narrow on purpose: it cannot list, cannot delete, cannot overwrite. A port
 * that could do those things would eventually be asked to.
 */
export interface SignatureStore {
  read(bucket: string, path: string): Promise<Fetched>;
  /** Must be non-overwriting. `exists` is a normal answer, not a failure. */
  write(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<Written>;
}

export const SOURCE_BUCKET = "doctor-assets";
export const FROZEN_BUCKET = "prescription-assets";

export type FreezeOutcome =
  /** Written by this attempt, read back, and verified byte-for-byte. */
  | { ok: true; kind: "frozen"; sha256: string; path: string }
  /** Already there from an earlier attempt, and verified to be the same bytes. */
  | { ok: true; kind: "already-frozen"; sha256: string; path: string }
  /** The doctor has no signature to freeze. Not an error by itself. */
  | { ok: false; kind: "source-missing" }
  /**
   * Something is at the destination and it is NOT what we meant to freeze.
   * Unrepairable by design, so it is a refusal and an operational alert.
   */
  | { ok: false; kind: "mismatch"; expected: string; found: string; path: string }
  /** The write may have landed; we could not read it back to find out. */
  | { ok: false; kind: "unverifiable"; message: string }
  | { ok: false; kind: "storage-error"; message: string };

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Freeze one signature, idempotently.
 *
 * The source is read ONCE and the bytes are held for the whole attempt. That
 * is what closes the race the review asked about: if the doctor replaces their
 * profile signature while this runs, the bytes we hash are the bytes we write,
 * so "which signature was frozen?" has exactly one answer for this attempt.
 */
export async function freezeSignature(
  store: SignatureStore,
  input: { sourcePath: string; destinationPath: string },
): Promise<FreezeOutcome> {
  const source = await store.read(SOURCE_BUCKET, input.sourcePath);
  if (source.kind === "missing") return { ok: false, kind: "source-missing" };
  if (source.kind === "error") {
    return { ok: false, kind: "storage-error", message: source.message };
  }

  const expected = sha256(source.bytes);
  const contentType = source.contentType ?? "application/octet-stream";

  const written = await store.write(
    FROZEN_BUCKET,
    input.destinationPath,
    source.bytes,
    contentType,
  );
  if (written.kind === "error") {
    return { ok: false, kind: "storage-error", message: written.message };
  }

  /**
   * Read back and hash, on BOTH paths.
   *
   * After our own write, because "the API returned success" is not the same as
   * "the right bytes are stored". After `exists`, because a path collision is
   * exactly the case where trusting the name would be worst — that object may
   * be a half-written retry, or a different signature entirely.
   */
  const stored = await store.read(FROZEN_BUCKET, input.destinationPath);

  if (stored.kind === "missing") {
    /**
     * Storage said it wrote something and then had nothing to give back. We
     * cannot say the freeze failed — a later read may well find it — so this is
     * never reported as a plain error, for the same reason an unconfirmed write
     * is not (Stage 7B).
     */
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

  return {
    ok: true,
    kind: written.kind === "exists" ? "already-frozen" : "frozen",
    sha256: expected,
    path: input.destinationPath,
  };
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
