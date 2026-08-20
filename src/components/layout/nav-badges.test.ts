import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PRIMARY_NAV, SECONDARY_NAV, MOBILE_NAV } from "./nav-config";

/**
 * A number beside "Live Queue" is read as a fact about the waiting room.
 *
 * These were the literals 7 and 24 — Phase-1 placeholders that were never
 * replaced. The sidebar said "Live Queue 7" above an empty room, and every
 * doctor at every location saw the same two numbers. A made-up count on a
 * clinical workspace is worse than no count.
 */

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("no badge is ever a constant", () => {
  it("nav items carry a KEY, never a number", () => {
    for (const item of [...PRIMARY_NAV, ...SECONDARY_NAV, ...MOBILE_NAV]) {
      expect(item, `${item.label} must not carry a literal count`).not.toHaveProperty("badge");
      if ("badgeKey" in item && item.badgeKey !== undefined) {
        expect(typeof item.badgeKey).toBe("string");
      }
    }
  });

  it("the config declares no numeric literal beside a nav entry", async () => {
    const src = strip(await readFile(path.resolve("src/components/layout/nav-config.tsx"), "utf8"));
    // `badge: 7` in any shape.
    expect(src).not.toMatch(/badge\s*:\s*\d/);
  });

  it("the sidebar renders the count it is GIVEN, not one it holds", async () => {
    const src = strip(
      await readFile(path.resolve("src/components/layout/desktop-sidebar.tsx"), "utf8"),
    );
    expect(src).toMatch(/counts\?\.\[item\.badgeKey\]/);
    expect(src).not.toMatch(/item\.badge\b/);
  });

  it("a zero or a failed read shows nothing at all", async () => {
    const src = strip(
      await readFile(path.resolve("src/components/layout/desktop-sidebar.tsx"), "utf8"),
    );
    /**
     * `> 0` matters twice: a "0" chip on every item is noise, and a zero shown
     * when the read FAILED would be a false claim of an empty waiting room —
     * the one sentence the queue screen already refuses to say.
     */
    expect(src).toMatch(/typeof count === "number" && count > 0/);
  });
});

describe("nothing else in the chrome claims a count either", () => {
  it("the notification bell announces no unread total it cannot back", async () => {
    const src = strip(await readFile(path.resolve("src/components/layout/top-bar.tsx"), "utf8"));
    /**
     * It read "Notifications, 3 unread" with a permanent red dot. There is no
     * notifications feature, so a screen reader was told three times over that
     * three things needed attention.
     */
    expect(src).not.toMatch(/\d+\s*unread/i);
    expect(src).toMatch(/aria-label="Notifications"/);
  });
});

describe("the counts come from the caller's own authorised reads", () => {
  it("reuses the queue RPC and the appointments read, not a new count path", async () => {
    const src = strip(await readFile(path.resolve("src/features/queue/nav-counts.ts"), "utf8"));
    expect(src).toMatch(/getQueue\(/);
    expect(src).toMatch(/getAppointmentsForDay\(/);
    // No bespoke SQL that could disagree with the screens it points at.
    expect(src).not.toMatch(/\.from\(|\.rpc\(/);
  });

  it("is scoped to the active location and to today", async () => {
    const src = strip(await readFile(path.resolve("src/features/queue/nav-counts.ts"), "utf8"));
    expect(src).toMatch(/activeLocationId/);
    expect(src).toMatch(/todayInDhaka\(\)/);
    // Both reads take the location — neither may quietly span all of them.
    expect(src).toMatch(/getQueue\(activeLocationId, today\)/);
    expect(src).toMatch(/getAppointmentsForDay\(today, activeLocationId\)/);
  });

  it("counts WAITING the way the queue screen does", async () => {
    const src = strip(await readFile(path.resolve("src/features/queue/nav-counts.ts"), "utf8"));
    /**
     * Through `groupQueue`, the same function the board uses — so the badge and
     * the screen cannot drift into two different definitions of "waiting".
     */
    expect(src).toMatch(/groupQueue\(queue\.rows\)\.waiting\.length/);
  });

  it("a failed read yields no count rather than a zero", async () => {
    const src = strip(await readFile(path.resolve("src/features/queue/nav-counts.ts"), "utf8"));
    expect(src).toMatch(/queue\.ok \?[\s\S]{0,80}: undefined/);
    expect(src).toMatch(/appointments\.ok \?[\s\S]{0,80}: undefined/);
  });

  it("is resolved per request in the layout, so it cannot be stale", async () => {
    const src = strip(await readFile(path.resolve("src/app/(app)/layout.tsx"), "utf8"));
    expect(src).toMatch(/await getNavCounts\(activeLocationId\)/);
    // Passed down, never cached in a module-level variable.
    expect(src).toMatch(/<DesktopSidebar counts=\{navCounts\}/);
  });
});
