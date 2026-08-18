import { describe, it, expect } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The service-role key bypasses every tenancy rule in this application.
 *
 * Containment is asserted rather than assumed, because the failure is silent:
 * a key that reaches the browser looks exactly like a key that did not, until
 * someone reads a bundle. Three independent checks, since any one of them can
 * be satisfied while the key still leaks:
 *
 *   1. no client component imports the privileged module
 *   2. the key is never read through a NEXT_PUBLIC_ name
 *   3. neither the variable name nor its value appears in a shipped bundle
 */

async function walk(dir: string, match = /\.tsx?$/): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, match)));
    else if (match.test(entry.name)) out.push(full);
  }
  return out;
}

const SRC = path.resolve("src");
const SERVICE_MODULE = /["']@\/lib\/supabase\/service["']|["'][./]+lib\/supabase\/service["']/;

describe("the privileged Storage client", () => {
  it("is imported only by the modules allowed to hold it", async () => {
    const allowed = new Set([
      path.join("features", "prescriptions", "freeze-store.ts"),
      path.join("features", "prescriptions", "actions.ts"),
    ]);

    const offenders: string[] = [];
    for (const file of await walk(SRC)) {
      if (file.endsWith("service-key-containment.test.ts")) continue;
      if (file.endsWith(path.join("lib", "supabase", "service.ts"))) continue;

      const source = await readFile(file, "utf8");
      if (!SERVICE_MODULE.test(source)) continue;

      const relative = path.relative(SRC, file);
      if (!allowed.has(relative)) offenders.push(relative);
    }

    expect(offenders).toEqual([]);
  });

  it("is never imported by a client component", async () => {
    /**
     * `import "server-only"` already makes this a build error. Asserted anyway
     * because that guard lives in a dependency, and this is the one mistake
     * whose consequence is a leaked super-user credential.
     */
    const offenders: string[] = [];
    for (const file of await walk(SRC)) {
      const source = await readFile(file, "utf8");
      if (!/^\s*["']use client["']/.test(source)) continue;
      if (SERVICE_MODULE.test(source)) offenders.push(path.relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it("is never read through a NEXT_PUBLIC_ name", async () => {
    // Next inlines NEXT_PUBLIC_* into the client bundle. A service key behind
    // such a name is published, not configured.
    const offenders: string[] = [];
    for (const file of await walk(SRC)) {
      const source = await readFile(file, "utf8");
      if (/NEXT_PUBLIC_[A-Z_]*SERVICE/.test(source) || /NEXT_PUBLIC_[A-Z_]*SECRET/.test(source)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("guards the module itself against client execution", async () => {
    const source = await readFile(path.join(SRC, "lib/supabase/service.ts"), "utf8");
    expect(source).toMatch(/^import "server-only";/m);
    expect(source).toMatch(/typeof window !== "undefined"/);
  });

  it("is never printed, logged or returned to a caller", async () => {
    /**
     * A key in a log line is a leaked key. `serviceRoleKey()` is the only way
     * to obtain it, so nothing may pass its result to a logger, a thrown
     * message, or a return value.
     */
    const offenders: string[] = [];
    for (const file of await walk(SRC)) {
      if (file.endsWith("service-key-containment.test.ts")) continue;
      const source = await readFile(file, "utf8");

      for (const line of source.split("\n")) {
        const mentionsKey = /serviceRoleKey\(\)|SUPABASE_SERVICE_ROLE_KEY/.test(line);
        if (!mentionsKey) continue;
        // Reading the NAME to test for presence is fine; emitting the VALUE is not.
        if (/console\.|throw new Error|JSON\.stringify|return\s/.test(line)) {
          if (/serviceRoleKey\(\)/.test(line)) offenders.push(`${path.relative(SRC, file)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("exposes storage only — never a privileged database handle", async () => {
    const source = await readFile(path.join(SRC, "lib/supabase/service.ts"), "utf8");
    // A privileged `.from()` would bypass owner_doctor_id and every location
    // rule at once, and it is only ever one careless export away.
    expect(source).not.toMatch(/export function serviceClient|export const serviceClient/);
    expect(source).toMatch(/export function serviceStorage/);
  });
});

describe("the shipped client bundle", () => {
  it("contains neither the variable name nor its value", async () => {
    const staticDir = path.resolve(".next", "static");
    try {
      await stat(staticDir);
    } catch {
      // No build in this working copy; `npm run build` covers it in CI.
      return;
    }

    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const files = await walk(staticDir, /\.js$/);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (source.includes("SUPABASE_SERVICE_ROLE_KEY")) offenders.push(path.basename(file));
      if (secret && secret.length > 20 && source.includes(secret)) {
        offenders.push(`${path.basename(file)} (VALUE)`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("production storage writes", () => {
  it("no application code writes storage.objects rows directly", async () => {
    /**
     * Supabase treats the `storage` schema as read-only metadata; file
     * operations go through the Storage API. A direct INSERT creates a
     * metadata row with no object behind it — which reads as success and
     * prints as a broken image on a prescription.
     *
     * Verification scripts DO read `storage.objects`, and may write it to set
     * a fixture up; they are not application code and are not scanned here.
     */
    const offenders: string[] = [];
    for (const file of await walk(SRC)) {
      const source = await readFile(file, "utf8");
      if (file.endsWith("service-key-containment.test.ts")) continue;
      if (/(insert\s+into|update|delete\s+from)\s+storage\.objects/i.test(source)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
