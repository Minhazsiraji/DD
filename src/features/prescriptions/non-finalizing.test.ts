import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Stage 7C-1 must not be able to finalise a prescription.
 *
 * Not "does not today" — CANNOT. The signature freeze does not exist yet
 * (Stage 7C-2A), so a finalisation reachable from this build would produce a
 * permanent, unsigned clinical record. The review screen deliberately looks
 * like a finished prescription, which is exactly why the absence of a path to
 * `finalize_prescription` has to be asserted rather than assumed.
 *
 * This test is expected to be DELETED in Stage 7C-2B, when finalisation is
 * built on purpose. Until then it is the thing standing between a review screen
 * and an irreversible one.
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

describe("Stage 7C-1 is non-finalizing", () => {
  /**
   * A CALL, not a mention.
   *
   * The RPC can only be invoked by naming it in a quoted string — `.rpc("…")`
   * for supabase-js, or a quoted identifier in raw SQL. Documentation refers to
   * it in backticks inside comments, which is exactly the discriminator: prose
   * explaining why we do not finalise yet must not read as finalising.
   */
  const CALLS_FINALIZE = /["']finalize_prescription["']/;

  it("no application file calls finalize_prescription", async () => {
    const files = await walk(APP);
    const callers: string[] = [];

    for (const file of files) {
      if (file.endsWith("non-finalizing.test.ts")) continue;
      const source = await readFile(file, "utf8");
      if (CALLS_FINALIZE.test(source)) callers.push(path.relative(APP, file));
    }

    expect(callers, `finalisation is not built yet, but ${callers.join(", ")} calls it`).toEqual([]);
  });

  it("…and the matcher would notice if one did", () => {
    // Guards the test itself: a regex that matches nothing passes forever.
    expect(CALLS_FINALIZE.test(`await supabase.rpc("finalize_prescription", {})`)).toBe(true);
    expect(CALLS_FINALIZE.test("has no path to `finalize_prescription`")).toBe(false);
  });

  it("no application file writes to the frozen clinical bucket", async () => {
    /**
     * `prescription-assets` is server-only as of the storage correction: the
     * bucket has no INSERT policy at all. A browser-side upload here would fail
     * anyway — this asserts we are not even trying, so the freeze arrives as
     * deliberate service-role orchestration rather than as a patch to a
     * client-side upload that stopped working.
     */
    const files = await walk(APP);
    const writers: string[] = [];

    for (const file of files) {
      if (file.endsWith("non-finalizing.test.ts")) continue;
      const source = await readFile(file, "utf8");
      if (!source.includes("prescription-assets")) continue;
      if (/\.(upload|copy|move|remove)\s*\(/.test(source)) writers.push(path.relative(APP, file));
    }

    expect(writers).toEqual([]);
  });

  it("the review screen offers no approval control", async () => {
    const screen = await readFile(
      path.join(APP, "features/prescriptions/components/review-screen.tsx"),
      "utf8",
    );
    // Copy is not a security control, but a button reading "Finalize" on a
    // screen that cannot finalise is its own kind of lie.
    expect(screen).not.toMatch(/Approve &amp; finalize|Finalize prescription/i);
    expect(screen).toMatch(/cannot approve it/i);
  });
});
