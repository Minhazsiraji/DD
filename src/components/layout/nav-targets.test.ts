import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PRIMARY_NAV, SECONDARY_NAV, MOBILE_NAV, QUICK_ACTIONS } from "./nav-config";

/**
 * Every navigation target must be a route that exists.
 *
 * Found during the Alpha release gate, by clicking "Start Consultation" as a
 * doctor would: four of the five quick actions pointed at routes that were
 * never built. Three answered 404. The fourth landed on the consultation route,
 * which read "new" as an encounter id and said "The record exists — we simply
 * could not reach it just now. Do not start a new consultation for this
 * patient." Confident, specific, false, and the first thing a doctor meets.
 *
 * Typecheck cannot catch this: an href is a string. So the routes are checked
 * against the filesystem, which is where App Router keeps the answer.
 */

const APP = path.resolve("src/app");

/** Does a route exist for this path, static or dynamic? */
function routeExists(href: string): boolean {
  const clean = href.split(/[?#]/)[0]!.replace(/^\/+|\/+$/g, "");
  const segments = clean === "" ? [] : clean.split("/");

  const walk = (dir: string, rest: string[]): boolean => {
    if (rest.length === 0) {
      return existsSync(path.join(dir, "page.tsx")) || existsSync(path.join(dir, "page.ts"));
    }
    const [head, ...tail] = rest;

    // An exact segment.
    if (existsSync(path.join(dir, head!)) && walk(path.join(dir, head!), tail)) return true;

    /**
     * A route GROUP — `(app)` — is invisible in the URL, so it is transparent
     * here too. Without this every real route under `src/app/(app)/` would be
     * reported missing.
     */
    for (const group of ["(app)", "(auth)", "(setup)", "(marketing)"]) {
      const g = path.join(dir, group);
      if (existsSync(g) && walk(g, rest)) return true;
    }

    // A dynamic segment: `[id]` or `[...slug]`.
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("[")) continue;
        if (walk(path.join(dir, entry.name), tail)) return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  return walk(APP, segments);
}

describe("navigation goes somewhere", () => {
  it("the route checker itself works", () => {
    // A control: a checker that answers "yes" to everything proves nothing.
    expect(routeExists("/patients")).toBe(true);
    expect(routeExists("/prescription/some-id")).toBe(true);
    expect(routeExists("/definitely-not-a-route")).toBe(false);
    expect(routeExists("/prescriptions/new")).toBe(false);
  });

  for (const [name, items] of [
    ["PRIMARY_NAV", PRIMARY_NAV],
    ["SECONDARY_NAV", SECONDARY_NAV],
    ["MOBILE_NAV", MOBILE_NAV],
  ] as const) {
    it(`${name} has no dead links`, () => {
      const dead = items.filter((i) => !routeExists(i.href)).map((i) => `${i.label} -> ${i.href}`);
      expect(dead).toEqual([]);
    });
  }

  it("QUICK_ACTIONS has no dead links", () => {
    const dead = QUICK_ACTIONS.filter((a) => !routeExists(a.href)).map(
      (a) => `${a.label} -> ${a.href}`,
    );
    expect(dead).toEqual([]);
  });

  it("no quick action points at a literal 'new' sub-route that is really a dynamic id", () => {
    /**
     * The specific shape of the bug: `/consultation/new` matched
     * `/consultation/[encounterId]`, so it resolved and then failed at the
     * database with a message written for a real, temporarily unreachable
     * record.
     */
    for (const action of QUICK_ACTIONS) {
      expect(action.href).not.toMatch(/^\/(consultation|prescription)\/new$/);
    }
  });
});


describe("Top Bar identity treatment", () => {
  it("shows one identity treatment at a time: compact below xl, text at xl+", () => {
    const topbar = readFileSync(path.resolve("src/components/layout/top-bar.tsx"), "utf8");
    expect(topbar).toContain("text-brand xl:hidden");
    expect(topbar).toContain("hidden min-w-0 xl:block");
  });
});
