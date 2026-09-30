import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Only one module may write clinical storage.
 *
 * This file used to assert something stronger and temporary — that NOTHING in
 * the app could reach `finalize_prescription` or write `prescription-assets`,
 * because Stage 7C-1 had a review screen that looked finished and a signature
 * freeze that did not exist yet. Both are built now, on purpose, so those
 * assertions have been removed rather than quietly weakened.
 *
 * What remains is the part that stays true forever: `prescription-assets` has
 * no INSERT policy, so only service-role code can write it, and exactly one
 * module should hold that ability.
 */

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const APP = path.resolve("src");

describe("storage writes", () => {
  it("go through exactly one adapter", async () => {
    /**
     * Scans for the mutating verbs only. `createSignedUrl` and `download` are
     * reads and may live wherever the user's own client is in use.
     */
    const files = await walk(APP);
    const writers: string[] = [];

    for (const file of files) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const source = await readFile(file, "utf8");
      if (/\.storage[\s\S]{0,200}?\.(upload|copy|move|remove)\s*\(/.test(source)) {
        writers.push(path.relative(APP, file));
      }
      if (/\bstorage\s*\n?\s*\.from\([^)]*\)\s*\.\s*(upload|copy|move|remove)\s*\(/.test(source)) {
        writers.push(path.relative(APP, file));
      }
    }

    const found = [...new Set(writers)];
    const allowed = [
      path.join("features", "prescriptions", "freeze-store.ts"),
      // The doctor's own profile signature: their bucket, their upload, and a
      // different trust class entirely (ADR 0012).
      path.join("features", "doctor", "actions.ts"),
      /**
       * The professional PHOTOGRAPH — `doctor-profile-photos`, and a third
       * trust class again.
       *
       * It writes with `upsert: true` and it may be DELETED, which is exactly
       * what `prescription-assets` must never allow: a frozen signature is
       * attested inside a review digest and has to outlive the account. A
       * portrait is the doctor's to change at will. Same verbs, opposite
       * rules — which is why they are different buckets and why this entry is
       * a deliberate addition rather than a widened allowance.
       */
      path.join("features", "doctor", "profile-actions.ts"),
      /**
       * Patient documents — `patient-documents`, a fourth trust class.
       *
       * It uploads with the DOCTOR'S OWN client, never a service-role one:
       * unlike `prescription-assets` this bucket has an INSERT policy, and it
       * pins the first path segment to `auth.uid()`, so the wall is storage RLS
       * rather than trusted code. Its `remove()` is orphan cleanup after a
       * failed metadata write and is expected to remove nothing — the bucket
       * has no DELETE policy — which is why the call site checks the returned
       * rows instead of the absence of an error (ADR 0015).
       */
      path.join("features", "documents", "actions.ts"),
    ];

    /**
     * An earlier version of this scan passed because it matched nothing at all
     * — the literal bucket name and the `.upload(` call live in different
     * files. A scanner that matches nothing is not a control, so assert it
     * still sees the writers we know about.
     */
    expect(found).toEqual(expect.arrayContaining(allowed));
    expect(found.filter((w) => !allowed.includes(w))).toEqual([]);
  });

  it("never write storage.objects rows directly", async () => {
    /**
     * Supabase treats the `storage` schema as read-only metadata. A direct
     * INSERT creates an entry with no object behind it — which reads as success
     * and prints as a broken image on a prescription.
     */
    const offenders: string[] = [];
    for (const file of await walk(APP)) {
      const source = await readFile(file, "utf8");
      if (/(insert\s+into|update|delete\s+from)\s+storage\.objects/i.test(source)) {
        offenders.push(path.relative(APP, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
