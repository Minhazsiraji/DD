import { describe, it, expect } from "vitest";
import {
  FROZEN_BUCKET,
  SOURCE_BUCKET,
  freezeSignature,
  sha256,
  signatureNeed,
  type Fetched,
  type SignatureStore,
  type Written,
} from "./freeze";

/**
 * Freezing a signature, exercised through every way it can go wrong.
 *
 * These run against a fake store rather than live object storage — not for
 * speed, but because the interesting cases ARE the failures, and a failure that
 * needs a network partition to reproduce never gets tested. The fake is
 * deliberately faithful about the two things that matter: it refuses to
 * overwrite, and it can be told to lie about what it stored.
 *
 * The property under test throughout:
 *
 *   a frozen signature is trusted because trusted code read the bytes and
 *   verified them — never because a file sits at the expected path.
 */

const SOURCE = "doc-uid/signature-1.png";
const DEST = "doc-uid/rx-id/signature";

const bytes = (s: string) => new TextEncoder().encode(s);
const SIG_A = bytes("signature-A-pixels");
const SIG_B = bytes("signature-B-pixels");

interface FakeOptions {
  /** Objects already present, by `bucket/path`. */
  initial?: Record<string, Uint8Array>;
  /** Reads of this key fail with an error rather than returning bytes. */
  failReadOf?: string;
  /** Reads of this key report the object as absent. */
  vanishOn?: string;
  /** Writes fail outright. */
  failWrite?: string;
  /** Store something OTHER than what was written — a lying backend. */
  corruptWrites?: Uint8Array;
}

function fakeStore(options: FakeOptions = {}) {
  const objects = new Map<string, Uint8Array>(Object.entries(options.initial ?? {}));
  const writes: string[] = [];

  const store: SignatureStore = {
    async read(bucket, path): Promise<Fetched> {
      const key = `${bucket}/${path}`;
      if (options.failReadOf === key) return { kind: "error", message: "storage unreachable" };
      if (options.vanishOn === key) return { kind: "missing" };
      const found = objects.get(key);
      if (!found) return { kind: "missing" };
      return { kind: "bytes", bytes: found, contentType: "image/png" };
    },

    async write(bucket, path, data): Promise<Written> {
      const key = `${bucket}/${path}`;
      writes.push(key);
      if (options.failWrite) return { kind: "error", message: options.failWrite };
      // Append-only, exactly like the real bucket: never replace.
      if (objects.has(key)) return { kind: "exists" };
      objects.set(key, options.corruptWrites ?? data);
      return { kind: "ok" };
    },
  };

  return { store, objects, writes };
}

const source = (data: Uint8Array) => ({ [`${SOURCE_BUCKET}/${SOURCE}`]: data });
const frozen = (data: Uint8Array) => ({ [`${FROZEN_BUCKET}/${DEST}`]: data });

describe("a normal freeze", () => {
  it("copies the signature and verifies the stored bytes", async () => {
    const { store, objects } = fakeStore({ initial: source(SIG_A) });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result).toEqual({ ok: true, kind: "frozen", sha256: sha256(SIG_A), path: DEST });
    expect(objects.get(`${FROZEN_BUCKET}/${DEST}`)).toEqual(SIG_A);
  });

  it("leaves the doctor's source signature in place", async () => {
    // It is their profile image and the source for the NEXT prescription.
    const { store, objects } = fakeStore({ initial: source(SIG_A) });
    await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });
    expect(objects.get(`${SOURCE_BUCKET}/${SOURCE}`)).toEqual(SIG_A);
  });

  it("reports the hash of the bytes it actually froze", async () => {
    const { store } = fakeStore({ initial: source(SIG_A) });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });
    if (!result.ok) throw new Error("expected success");
    expect(result.sha256).toBe(sha256(SIG_A));
    expect(result.sha256).not.toBe(sha256(SIG_B));
  });
});

describe("idempotency", () => {
  it("treats an identical existing object as success", async () => {
    const { store, writes } = fakeStore({
      initial: { ...source(SIG_A), ...frozen(SIG_A) },
    });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("already-frozen");
    // It still tried, and was refused — that refusal is what proves append-only.
    expect(writes).toEqual([`${FROZEN_BUCKET}/${DEST}`]);
  });

  it("running it twice produces one object and the same identity", async () => {
    const { store, objects } = fakeStore({ initial: source(SIG_A) });

    const first = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });
    const second = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    if (!first.ok || !second.ok) throw new Error("both should succeed");
    expect(first.sha256).toBe(second.sha256);
    expect(first.path).toBe(second.path);
    expect(second.kind).toBe("already-frozen");
    expect([...objects.keys()].filter((k) => k.startsWith(FROZEN_BUCKET))).toHaveLength(1);
  });

  it("two racing attempts converge on one verified object", async () => {
    // Same store, both started before either finished.
    const { store, objects } = fakeStore({ initial: source(SIG_A) });
    const [a, b] = await Promise.all([
      freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST }),
      freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST }),
    ]);

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.sha256).toBe(b.sha256);
    expect([...objects.keys()].filter((k) => k.startsWith(FROZEN_BUCKET))).toHaveLength(1);
  });

  it("a retry after an interrupted request verifies rather than rewrites", async () => {
    /**
     * The request died after the copy. The object is there; nothing recorded
     * that it was. The retry must not produce a second one, and must not take
     * the first on trust either.
     */
    const { store, writes } = fakeStore({ initial: { ...source(SIG_A), ...frozen(SIG_A) } });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("already-frozen");
    expect(writes).toHaveLength(1);
  });
});

describe("a destination that is not what we meant to freeze", () => {
  it("refuses, and does not overwrite", async () => {
    const { store, objects } = fakeStore({
      initial: { ...source(SIG_A), ...frozen(SIG_B) },
    });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("mismatch");
      if (result.kind === "mismatch") {
        expect(result.expected).toBe(sha256(SIG_A));
        expect(result.found).toBe(sha256(SIG_B));
      }
    }
    // The pre-existing object is untouched. It is append-only; there is no
    // repair available, which is exactly why this refuses.
    expect(objects.get(`${FROZEN_BUCKET}/${DEST}`)).toEqual(SIG_B);
  });

  it("catches a backend that stored something other than what we sent", async () => {
    // "The API returned success" is not "the right bytes are stored".
    const { store } = fakeStore({ initial: source(SIG_A), corruptWrites: SIG_B });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("mismatch");
  });

  it("never reports success on a path match alone", async () => {
    // The whole point: the same path, different bytes, must not pass.
    const { store } = fakeStore({ initial: { ...source(SIG_A), ...frozen(SIG_B) } });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });
    expect(result.ok).toBe(false);
  });
});

describe("the source", () => {
  it("reports a missing signature as its own outcome, not an error", async () => {
    const { store } = fakeStore();
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("source-missing");
  });

  it("writes nothing when the source cannot be read", async () => {
    const { store, writes } = fakeStore({
      initial: source(SIG_A),
      failReadOf: `${SOURCE_BUCKET}/${SOURCE}`,
    });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("storage-error");
    // Nothing may be written to an append-only destination on a guess.
    expect(writes).toEqual([]);
  });

  /**
   * The race the review asked about: the doctor replaces their profile
   * signature while a freeze is running. The bytes are read ONCE and held, so
   * the thing hashed is the thing written — "which signature was frozen?" has
   * one answer per attempt.
   */
  it("freezes the bytes it read, even if the profile changes mid-flight", async () => {
    const objects = new Map<string, Uint8Array>([[`${SOURCE_BUCKET}/${SOURCE}`, SIG_A]]);

    const store: SignatureStore = {
      async read(bucket, path) {
        const found = objects.get(`${bucket}/${path}`);
        return found
          ? { kind: "bytes", bytes: found, contentType: "image/png" }
          : { kind: "missing" };
      },
      async write(bucket, path, data) {
        // The doctor swaps their profile signature between our read and write.
        objects.set(`${SOURCE_BUCKET}/${SOURCE}`, SIG_B);
        const key = `${bucket}/${path}`;
        if (objects.has(key)) return { kind: "exists" };
        objects.set(key, data);
        return { kind: "ok" };
      },
    };

    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sha256).toBe(sha256(SIG_A));
    expect(objects.get(`${FROZEN_BUCKET}/${DEST}`)).toEqual(SIG_A);
    // …and the doctor's new signature is theirs, untouched.
    expect(objects.get(`${SOURCE_BUCKET}/${SOURCE}`)).toEqual(SIG_B);
  });
});

describe("a write we cannot confirm", () => {
  it("is never reported as a plain failure", async () => {
    /**
     * Storage accepted the write and then had nothing to give back. Saying
     * "failed" would invite a doctor to start again somewhere else; saying
     * "done" would claim a verification we did not perform.
     */
    const { store } = fakeStore({
      initial: source(SIG_A),
      vanishOn: `${FROZEN_BUCKET}/${DEST}`,
    });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unverifiable");
      expect(result.kind).not.toBe("storage-error");
    }
  });

  it("is safe to retry once storage answers again", async () => {
    const { store } = fakeStore({ initial: { ...source(SIG_A), ...frozen(SIG_A) } });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });
    expect(result.ok).toBe(true);
  });

  it("surfaces a failed write as an error, having stored nothing", async () => {
    const { store, objects } = fakeStore({ initial: source(SIG_A), failWrite: "quota exceeded" });
    const result = await freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("storage-error");
    expect(objects.has(`${FROZEN_BUCKET}/${DEST}`)).toBe(false);
  });
});

describe("whether a signature is needed at all", () => {
  it("needs nothing when the layout hides the signature", () => {
    expect(signatureNeed({ showSignature: false, sourcePath: null })).toEqual({
      kind: "not-required",
    });
    // Even if the doctor has one — the layout decides what prints.
    expect(signatureNeed({ showSignature: false, sourcePath: SOURCE })).toEqual({
      kind: "not-required",
    });
  });

  it("says so plainly when the layout wants one the doctor does not have", () => {
    // Never downgraded to "print a blank line": a prescription that looks
    // signed and is not is worse than one that refuses to be prepared.
    expect(signatureNeed({ showSignature: true, sourcePath: null })).toEqual({
      kind: "unavailable",
    });
    expect(signatureNeed({ showSignature: true, sourcePath: "   " })).toEqual({
      kind: "unavailable",
    });
  });

  it("requires a freeze when there is one to freeze", () => {
    expect(signatureNeed({ showSignature: true, sourcePath: SOURCE })).toEqual({
      kind: "required",
      sourcePath: SOURCE,
    });
  });
});

describe("sha256", () => {
  it("separates two images that differ by one byte", () => {
    expect(sha256(bytes("aaaa"))).not.toBe(sha256(bytes("aaab")));
  });

  it("is stable for identical bytes from different arrays", () => {
    expect(sha256(bytes("same"))).toBe(sha256(new Uint8Array(bytes("same"))));
  });
});
