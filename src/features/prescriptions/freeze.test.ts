import { describe, it, expect } from "vitest";
import {
  FREEZE_MARKER,
  FROZEN_BUCKET,
  SOURCE_BUCKET,
  freezeSignature,
  sha256,
  signatureNeed,
  type Described,
  type Fetched,
  type FrozenMarker,
  type SignatureStore,
  type Written,
} from "./freeze";

/**
 * Freezing a signature, exercised through every way it can go wrong.
 *
 * These run against a fake store rather than live object storage — not for
 * speed, but because the interesting cases ARE the failures, and a failure that
 * needs a network partition to reproduce never gets tested. The fake is
 * faithful about the three things that matter: it refuses to overwrite, it
 * keeps the custom metadata written with an object, and it can be told to lie
 * about what it stored.
 *
 * Two properties under test throughout:
 *
 *   1. a frozen signature is trusted because trusted code read the bytes and
 *      verified them — never because a file sits at the expected path;
 *
 *   2. a frozen signature belongs to THAT PRESCRIPTION. A doctor who later
 *      changes their profile signature has changed what FUTURE prescriptions
 *      carry — they have not invalidated a draft already prepared.
 */

const RX = "rx-123";
const OTHER_RX = "rx-999";
const SOURCE = "doc-uid/signature-1.png";
const DEST = "doc-uid/rx-123/signature";

const bytes = (s: string) => new TextEncoder().encode(s);
const SIG_A = bytes("signature-A-pixels");
const SIG_B = bytes("signature-B-pixels");

const goodMarker = (data: Uint8Array, rx = RX): FrozenMarker => ({
  frozenBy: FREEZE_MARKER,
  frozenFor: rx,
  sourceSha256: sha256(data),
});

interface Stored {
  bytes: Uint8Array;
  marker?: Partial<FrozenMarker>;
}

interface FakeOptions {
  initial?: Record<string, Stored>;
  failReadOf?: string;
  vanishOn?: string;
  failWrite?: string;
  /** Store something OTHER than what was written — a lying backend. */
  corruptWrites?: Uint8Array;
  /** `info()` fails even though the object is there. */
  failDescribe?: string;
}

function fakeStore(options: FakeOptions = {}) {
  const objects = new Map<string, Stored>(Object.entries(options.initial ?? {}));
  const writes: string[] = [];

  const store: SignatureStore = {
    async read(bucket, path): Promise<Fetched> {
      const key = `${bucket}/${path}`;
      if (options.failReadOf === key) return { kind: "error", message: "storage unreachable" };
      if (options.vanishOn === key) return { kind: "missing" };
      const found = objects.get(key);
      if (!found) return { kind: "missing" };
      return { kind: "bytes", bytes: found.bytes, contentType: "image/png" };
    },

    async describe(bucket, path): Promise<Described> {
      const key = `${bucket}/${path}`;
      if (options.failDescribe === key) return { kind: "error", message: "info failed" };
      const found = objects.get(key);
      if (!found) return { kind: "missing" };
      return { kind: "found", marker: found.marker ?? {} };
    },

    async write(bucket, path, data, _type, marker): Promise<Written> {
      const key = `${bucket}/${path}`;
      writes.push(key);
      if (options.failWrite) return { kind: "error", message: options.failWrite };
      // Append-only, exactly like the real bucket: never replace.
      if (objects.has(key)) return { kind: "exists" };
      objects.set(key, { bytes: options.corruptWrites ?? data, marker });
      return { kind: "ok" };
    },
  };

  return { store, objects, writes };
}

const source = (data: Uint8Array) => ({ [`${SOURCE_BUCKET}/${SOURCE}`]: { bytes: data } });
const frozen = (data: Uint8Array, marker?: Partial<FrozenMarker>) => ({
  [`${FROZEN_BUCKET}/${DEST}`]: { bytes: data, marker: marker ?? goodMarker(data) },
});

const freeze = (store: SignatureStore) =>
  freezeSignature(store, { sourcePath: SOURCE, destinationPath: DEST, prescriptionId: RX });

describe("a first freeze", () => {
  it("copies the signature and verifies the stored bytes", async () => {
    const { store, objects } = fakeStore({ initial: source(SIG_A) });
    const result = await freeze(store);

    expect(result).toEqual({ ok: true, kind: "frozen", sha256: sha256(SIG_A), path: DEST });
    expect(objects.get(`${FROZEN_BUCKET}/${DEST}`)?.bytes).toEqual(SIG_A);
  });

  it("records what it froze, and for which prescription", async () => {
    const { store, objects } = fakeStore({ initial: source(SIG_A) });
    await freeze(store);

    // This marker is the authority on every later retry.
    expect(objects.get(`${FROZEN_BUCKET}/${DEST}`)?.marker).toEqual({
      frozenBy: FREEZE_MARKER,
      frozenFor: RX,
      sourceSha256: sha256(SIG_A),
    });
  });

  it("leaves the doctor's source signature in place", async () => {
    // It is their profile image and the source for the NEXT prescription.
    const { store, objects } = fakeStore({ initial: source(SIG_A) });
    await freeze(store);
    expect(objects.get(`${SOURCE_BUCKET}/${SOURCE}`)?.bytes).toEqual(SIG_A);
  });

  it("catches a backend that stored something other than what we sent", async () => {
    // "The API returned success" is not "the right bytes are stored".
    const { store } = fakeStore({ initial: source(SIG_A), corruptWrites: SIG_B });
    const result = await freeze(store);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("mismatch");
  });
});

/**
 * The rule corrected in review. A frozen signature belongs to the prescription,
 * not to the profile it came from.
 */
describe("after the doctor changes their profile signature", () => {
  it("reuses the already-frozen signature instead of refusing", async () => {
    const { store, writes } = fakeStore({
      initial: {
        // The profile now holds B…
        [`${SOURCE_BUCKET}/${SOURCE}`]: { bytes: SIG_B },
        // …but this prescription was prepared when it held A.
        ...frozen(SIG_A),
      },
    });

    const result = await freeze(store);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("already-frozen");
      // Still A. The draft keeps the signature it was prepared with.
      expect(result.sha256).toBe(sha256(SIG_A));
      expect(result.sha256).not.toBe(sha256(SIG_B));
    }
    // And nothing was written: the destination is append-only.
    expect(writes).toEqual([]);
  });

  it("does not even read the profile signature when one is already frozen", async () => {
    /**
     * Checking the destination FIRST is what makes the rule work. Reading the
     * source first would refuse a prepared prescription for `source-missing`
     * the moment a doctor deleted or replaced their profile image.
     */
    const reads: string[] = [];
    const { store } = fakeStore({ initial: frozen(SIG_A) });
    const spying: SignatureStore = {
      ...store,
      read: (bucket, path) => {
        reads.push(`${bucket}/${path}`);
        return store.read(bucket, path);
      },
    };

    const result = await freezeSignature(spying, {
      sourcePath: SOURCE,
      destinationPath: DEST,
      prescriptionId: RX,
    });

    expect(result.ok).toBe(true);
    expect(reads).toEqual([`${FROZEN_BUCKET}/${DEST}`]);
  });

  it("still works when the profile signature has been deleted entirely", async () => {
    const { store } = fakeStore({ initial: frozen(SIG_A) });
    const result = await freeze(store);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sha256).toBe(sha256(SIG_A));
  });

  it("freezes the NEW signature for a different prescription", async () => {
    const { store, objects } = fakeStore({
      initial: { [`${SOURCE_BUCKET}/${SOURCE}`]: { bytes: SIG_B }, ...frozen(SIG_A) },
    });

    const next = await freezeSignature(store, {
      sourcePath: SOURCE,
      destinationPath: "doc-uid/rx-999/signature",
      prescriptionId: OTHER_RX,
    });

    expect(next.ok).toBe(true);
    if (next.ok) expect(next.sha256).toBe(sha256(SIG_B));
    // The earlier prescription is untouched.
    expect(objects.get(`${FROZEN_BUCKET}/${DEST}`)?.bytes).toEqual(SIG_A);
  });
});

describe("idempotency", () => {
  it("running it twice produces one object and the same identity", async () => {
    const { store, objects } = fakeStore({ initial: source(SIG_A) });

    const first = await freeze(store);
    const second = await freeze(store);

    if (!first.ok || !second.ok) throw new Error("both should succeed");
    expect(first.sha256).toBe(second.sha256);
    expect(second.kind).toBe("already-frozen");
    expect([...objects.keys()].filter((k) => k.startsWith(FROZEN_BUCKET))).toHaveLength(1);
  });

  it("two racing attempts converge on one verified object", async () => {
    const { store, objects } = fakeStore({ initial: source(SIG_A) });
    const [a, b] = await Promise.all([freeze(store), freeze(store)]);

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.sha256).toBe(b.sha256);
    expect([...objects.keys()].filter((k) => k.startsWith(FROZEN_BUCKET))).toHaveLength(1);
  });

  it("a retry after an interrupted request verifies rather than rewrites", async () => {
    // The request died after the copy; nothing recorded that it happened.
    const { store, writes } = fakeStore({ initial: { ...source(SIG_A), ...frozen(SIG_A) } });
    const result = await freeze(store);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("already-frozen");
    expect(writes).toEqual([]);
  });
});

describe("an object we cannot vouch for", () => {
  it("refuses one with no freeze marker", async () => {
    /**
     * The bucket has no INSERT policy, so this should be impossible — which is
     * exactly why it is checked rather than assumed.
     */
    const { store, objects } = fakeStore({
      initial: { ...source(SIG_A), ...frozen(SIG_B, {}) },
    });
    const result = await freeze(store);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("untrusted");
      if (result.kind === "untrusted") expect(result.reason).toMatch(/marker/i);
    }
    // Untouched. Append-only means there is no repair, only a refusal.
    expect(objects.get(`${FROZEN_BUCKET}/${DEST}`)?.bytes).toEqual(SIG_B);
  });

  it("refuses one frozen for a different prescription", async () => {
    const { store } = fakeStore({
      initial: { ...source(SIG_A), ...frozen(SIG_A, goodMarker(SIG_A, OTHER_RX)) },
    });
    const result = await freeze(store);

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "untrusted") {
      expect(result.reason).toMatch(/different prescription/i);
    }
  });

  it("refuses one whose marker records no content hash", async () => {
    const { store } = fakeStore({
      initial: {
        ...source(SIG_A),
        ...frozen(SIG_A, { frozenBy: FREEZE_MARKER, frozenFor: RX }),
      },
    });
    const result = await freeze(store);

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "untrusted") {
      expect(result.reason).toMatch(/hash/i);
    }
  });

  it("refuses when the bytes no longer match the recorded hash", async () => {
    // Our marker, wrong bytes: the object was tampered with or truncated.
    const { store } = fakeStore({
      initial: { ...source(SIG_A), ...frozen(SIG_B, goodMarker(SIG_A)) },
    });
    const result = await freeze(store);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("corrupt");
      if (result.kind === "corrupt") {
        expect(result.expected).toBe(sha256(SIG_A));
        expect(result.found).toBe(sha256(SIG_B));
      }
    }
  });

  it("never trusts a path match alone", async () => {
    const { store } = fakeStore({ initial: { ...source(SIG_A), ...frozen(SIG_B, {}) } });
    expect((await freeze(store)).ok).toBe(false);
  });
});

describe("the source", () => {
  it("reports a missing signature as its own outcome, not an error", async () => {
    const { store } = fakeStore();
    const result = await freeze(store);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("source-missing");
  });

  it("writes nothing when the source cannot be read", async () => {
    const { store, writes } = fakeStore({
      initial: source(SIG_A),
      failReadOf: `${SOURCE_BUCKET}/${SOURCE}`,
    });
    const result = await freeze(store);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("storage-error");
    // Nothing may be written to an append-only destination on a guess.
    expect(writes).toEqual([]);
  });

  /**
   * The race the review asked about: the doctor replaces their profile
   * signature while a freeze is running. The bytes are read ONCE and held, so
   * the thing hashed is the thing written.
   */
  it("freezes the bytes it read, even if the profile changes mid-flight", async () => {
    const objects = new Map<string, Stored>([[`${SOURCE_BUCKET}/${SOURCE}`, { bytes: SIG_A }]]);

    const store: SignatureStore = {
      async read(bucket, path) {
        const found = objects.get(`${bucket}/${path}`);
        return found
          ? { kind: "bytes", bytes: found.bytes, contentType: "image/png" }
          : { kind: "missing" };
      },
      async describe(bucket, path) {
        const found = objects.get(`${bucket}/${path}`);
        return found ? { kind: "found", marker: found.marker ?? {} } : { kind: "missing" };
      },
      async write(bucket, path, data, _type, marker) {
        // The doctor swaps their profile signature between our read and write.
        objects.set(`${SOURCE_BUCKET}/${SOURCE}`, { bytes: SIG_B });
        const key = `${bucket}/${path}`;
        if (objects.has(key)) return { kind: "exists" };
        objects.set(key, { bytes: data, marker });
        return { kind: "ok" };
      },
    };

    const result = await freezeSignature(store, {
      sourcePath: SOURCE,
      destinationPath: DEST,
      prescriptionId: RX,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sha256).toBe(sha256(SIG_A));
    expect(objects.get(`${FROZEN_BUCKET}/${DEST}`)?.bytes).toEqual(SIG_A);
    // …and the doctor's new signature is theirs, untouched.
    expect(objects.get(`${SOURCE_BUCKET}/${SOURCE}`)?.bytes).toEqual(SIG_B);
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
    const result = await freeze(store);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unverifiable");
  });

  it("is unverifiable when the existing object cannot be inspected", async () => {
    const { store } = fakeStore({
      initial: { ...source(SIG_A), ...frozen(SIG_A) },
      failDescribe: `${FROZEN_BUCKET}/${DEST}`,
    });
    const result = await freeze(store);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unverifiable");
  });

  it("is safe to retry once storage answers again", async () => {
    const { store } = fakeStore({ initial: { ...source(SIG_A), ...frozen(SIG_A) } });
    expect((await freeze(store)).ok).toBe(true);
  });

  it("surfaces a failed write as an error, having stored nothing", async () => {
    const { store, objects } = fakeStore({ initial: source(SIG_A), failWrite: "quota exceeded" });
    const result = await freeze(store);

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
