import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The parts of the recovery flow that are easy to break silently.
 *
 * Two independent faults produced the same symptom, and either alone is enough
 * to make password recovery impossible:
 *
 *   1. the callback could not see a fragment, so it called valid links expired
 *   2. the proxy bounced the recovered session off /reset-password to
 *      /dashboard, so even a link that worked never reached the form
 */

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const read = async (p: string) => strip(await readFile(path.resolve(p), "utf8"));

describe("the emailed link lands somewhere a browser can help", () => {
  it("password reset points at the confirm PAGE, not the server-only route", async () => {
    /**
     * A route handler cannot read `window.location.hash`, and that is where
     * this Supabase project puts the recovery tokens.
     */
    const src = await read("src/features/auth/actions.ts");
    expect(src).toMatch(/resetPasswordForEmail\([\s\S]{0,160}\/auth\/confirm\?next=\/reset-password/);
  });

  it("the callback forwards anything it cannot see instead of failing it", async () => {
    const src = await read("src/app/auth/callback/route.ts");
    expect(src).toMatch(/result\.kind !== "code"/);
    expect(src).toMatch(/\/auth\/confirm\$\{search\}/);
  });

  it("NO ONE-TIME TOKEN IS SPENT BY A SERVER GET", async () => {
    /**
     * The reported failure, at its root: mail scanners, link previewers and
     * corporate security gateways fetch URLs out of inboxes before a human
     * clicks. A server that calls `verifyOtp` on GET hands them the token, and
     * the doctor's own click is then correctly told the link was already used.
     *
     * So `token_hash` is forwarded, never verified here — even though it
     * could be. Only PKCE is finished server-side, and only because a scanner
     * has no verifier cookie and therefore takes nothing the doctor could have
     * used.
     */
    const src = await read("src/app/auth/callback/route.ts");
    expect(src).not.toMatch(/verifyOtp/);
    expect(src).toMatch(/exchangeCodeForSession\(/);
  });

  it("…and the page that does spend it runs in the browser", async () => {
    // A scanner fetches HTML; it does not execute this.
    const page = await read("src/app/auth/confirm/page.tsx");
    const client = await read("src/features/auth/components/confirm-link.tsx");
    expect(page).not.toMatch(/verifyOtp|exchangeCodeForSession|setSession/);
    expect(client).toMatch(/^"use client"/m);
    expect(client).toMatch(/verifyOtp\(/);
  });

  it("both halves parse the link with the SAME function", async () => {
    // Two parsers would eventually disagree about what a valid link is.
    for (const file of [
      "src/app/auth/callback/route.ts",
      "src/features/auth/components/confirm-link.tsx",
    ]) {
      expect(await read(file), file).toMatch(/readLinkResult\(/);
    }
  });
});

describe("verification is never skipped", () => {
  it("every branch hands the token to Supabase", async () => {
    /**
     * `setSession` posts the refresh token back and takes what Supabase
     * returns — it is not a local decode of the access token, so a forged
     * fragment gets a rejection rather than a session.
     */
    const src = await read("src/features/auth/components/confirm-link.tsx");
    expect(src).toMatch(/exchangeCodeForSession\(/);
    expect(src).toMatch(/verifyOtp\(/);
    expect(src).toMatch(/setSession\(/);

    // No local shortcut around any of it.
    expect(src).not.toMatch(/jwtDecode|atob\(|JSON\.parse\([^)]*access/i);
  });

  it("a one-time token is presented exactly once", async () => {
    /**
     * React's development double-invoke would spend the code on the first
     * attempt and report the second as expired — manufacturing the very bug
     * being fixed.
     */
    const src = await read("src/features/auth/components/confirm-link.tsx");
    expect(src).toMatch(/ran\.current/);
  });

  it("reads the destination BEFORE stripping the URL", async () => {
    /**
     * `history.replaceState(…, pathname)` drops the query along with the
     * fragment. Reading `next` afterwards found nothing and sent every
     * recovery to the dashboard instead of the password form — a link that
     * verified perfectly and still did not work. Found by walking a real link
     * through the running app.
     */
    const src = await read("src/features/auth/components/confirm-link.tsx");
    const readsNext = src.indexOf('.get("next")');
    const strips = src.indexOf("history.replaceState");
    expect(readsNext).toBeGreaterThan(-1);
    expect(strips).toBeGreaterThan(-1);
    expect(readsNext).toBeLessThan(strips);
  });

  it("the token is cleared from the address bar BEFORE it is used", async () => {
    /**
     * `token_hash` travels in the QUERY, so it has already reached the server
     * and any proxy between — that cannot be undone here. What can be stopped
     * is the rest of its life: browser history, a screenshot, and the
     * `Referer` on every request the page makes next.
     *
     * Stripped up front rather than on success, so a token that FAILED
     * verification is not left on screen either.
     */
    const src = await read("src/features/auth/components/confirm-link.tsx");
    const strips = src.indexOf("history.replaceState");
    const verifies = src.indexOf("await verify(");
    expect(strips).toBeGreaterThan(-1);
    expect(verifies).toBeGreaterThan(-1);
    expect(strips).toBeLessThan(verifies);
  });

  it("never logs a token", async () => {
    for (const file of [
      "src/features/auth/components/confirm-link.tsx",
      "src/app/auth/callback/route.ts",
      "src/features/auth/link-result.ts",
    ]) {
      const src = await read(file);
      // No logging at all on these paths, so nothing can carry a credential.
      expect(src, file).not.toMatch(/console\.(log|error|warn|info|debug)/);
    }
  });
});

describe("a recovered session can actually reach the form", () => {
  it("the proxy no longer bounces /reset-password to the dashboard", async () => {
    const src = await read("src/proxy.ts");
    expect(src).toMatch(/pathname !== "\/reset-password"/);
  });

  it("…and everything else about the gate is unchanged", async () => {
    /**
     * The signed-out redirect is the half that protects data, and it must stay
     * exactly as it was — this fix widens nothing.
     */
    const src = await read("src/proxy.ts");
    expect(src).toMatch(/if \(!user && !isPublic\(pathname\)\)/);
    expect(src).toMatch(/getUser\(\)/);
    expect(src).not.toMatch(/getSession\(\)/);
  });
});

describe("where reset emails are told to come back to", () => {
  it("never trusts a request header for the origin", async () => {
    /**
     * `Host` is attacker-supplied. A Supabase allow list with a wildcard would
     * then accept a neighbouring domain, turning a genuine password-reset email
     * into delivery for somebody else's site.
     */
    const src = await read("src/features/auth/site-url.ts");
    expect(src).not.toMatch(/headers\(\)|x-forwarded-host|request\.|req\./);
  });

  it("prefers a deliberate value, and ignores a leftover localhost in a deployment", async () => {
    const src = await read("src/features/auth/site-url.ts");
    expect(src).toMatch(/localhost/);
    expect(src).toMatch(/VERCEL_PROJECT_PRODUCTION_URL/);
    expect(src).toMatch(/VERCEL_URL/);
  });
});
