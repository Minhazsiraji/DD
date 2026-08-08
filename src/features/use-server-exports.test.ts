import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * A "use server" module may export ONLY async functions.
 *
 * This exists because of a real bug: `addLocationSchema` (a Zod object) was
 * exported from a "use server" file. The page still rendered, so lint,
 * typecheck AND `next build` all passed — it failed only when the form was
 * actually submitted, with:
 *
 *   Error: A "use server" file can only export async functions, found object.
 *
 * Nothing else in the toolchain catches this class of mistake, and the symptom
 * (a 500 on submit, page renders fine) is genuinely hard to trace back.
 *
 * Type-only exports are fine — they are erased before the directive applies.
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

const USE_SERVER = /^\s*["']use server["']/;

/** export const|let|var|class|function (not async function), excluding types. */
const ILLEGAL_EXPORT =
  /^export\s+(?!async\s+function\b)(?!type\b)(?!interface\b)(?!default\s+async\b)(const|let|var|class|function|enum)\s+(\w+)/gm;

describe('"use server" modules', () => {
  it("export only async functions", async () => {
    const files = await walk(path.resolve("src"));
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (!USE_SERVER.test(source)) continue;

      for (const match of source.matchAll(ILLEGAL_EXPORT)) {
        offenders.push(
          `${path.relative(process.cwd(), file)} — export ${match[1]} ${match[2]}`,
        );
      }
    }

    expect(
      offenders,
      `Move these out of the "use server" file (e.g. into a sibling schema.ts):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("actually scans something, so a broken walk cannot pass silently", async () => {
    const files = await walk(path.resolve("src"));
    const serverModules: string[] = [];
    for (const file of files) {
      if (USE_SERVER.test(await readFile(file, "utf8"))) serverModules.push(file);
    }
    expect(serverModules.length).toBeGreaterThan(0);
  });
});
