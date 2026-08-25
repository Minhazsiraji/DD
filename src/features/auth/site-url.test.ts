import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveAuthOrigin } from "./site-url";

/**
 * Where a password-reset email is told to come back to.
 *
 * Vercel sets an environment variable for EVERY environment unless it is
 * explicitly scoped, so a Preview build inherits Production's
 * `NEXT_PUBLIC_SITE_URL` by default. An earlier ordering consulted that first,
 * which meant a reset requested on a preview mailed a link back to production:
 * the preview could not be accepted in isolation, and a tester clicking the
 * link would land on the live site and change a live password.
 */

const PRODUCTION = "https://dd-sigma-vert.vercel.app";
const PREVIEW_HOST = "dd-git-fix-password-recovery-minhaz.vercel.app";

describe("a preview answers for itself", () => {
  it("PREVIEW inheriting the production site URL still returns to the PREVIEW", () => {
    // The exact regression the audit caught.
    expect(
      resolveAuthOrigin({
        siteUrl: PRODUCTION,
        vercelEnv: "preview",
        vercelUrl: PREVIEW_HOST,
        productionUrl: "dd-sigma-vert.vercel.app",
      }),
    ).toBe(`https://${PREVIEW_HOST}`);
  });

  it("…and a preview with no inherited value behaves the same", () => {
    expect(
      resolveAuthOrigin({
        siteUrl: undefined,
        vercelEnv: "preview",
        vercelUrl: PREVIEW_HOST,
        productionUrl: "dd-sigma-vert.vercel.app",
      }),
    ).toBe(`https://${PREVIEW_HOST}`);
  });

  it("a preview that cannot name itself does not silently become production", () => {
    /**
     * With no `VERCEL_URL` there is nothing preview-specific to use, so the
     * configured value applies — but this is the one case worth stating out
     * loud rather than leaving to fall through unnoticed.
     */
    expect(
      resolveAuthOrigin({
        siteUrl: PRODUCTION,
        vercelEnv: "preview",
        vercelUrl: undefined,
        productionUrl: "dd-sigma-vert.vercel.app",
      }),
    ).toBe(PRODUCTION);
  });
});

describe("production uses production", () => {
  it("honours the deliberately configured site URL", () => {
    expect(
      resolveAuthOrigin({
        siteUrl: PRODUCTION,
        vercelEnv: "production",
        vercelUrl: "dd-abc123.vercel.app",
        productionUrl: "dd-sigma-vert.vercel.app",
      }),
    ).toBe(PRODUCTION);
  });

  it("prefers a configured CUSTOM domain over the platform's vercel.app host", () => {
    // A custom domain is a decision the platform variables know nothing about.
    expect(
      resolveAuthOrigin({
        siteUrl: "https://app.doctorsdiary.com.bd",
        vercelEnv: "production",
        vercelUrl: "dd-abc123.vercel.app",
        productionUrl: "dd-sigma-vert.vercel.app",
      }),
    ).toBe("https://app.doctorsdiary.com.bd");
  });

  it("falls back to the project's production domain when nothing is configured", () => {
    expect(
      resolveAuthOrigin({
        siteUrl: undefined,
        vercelEnv: "production",
        vercelUrl: "dd-abc123.vercel.app",
        productionUrl: "dd-sigma-vert.vercel.app",
      }),
    ).toBe(PRODUCTION);
  });

  it("ignores a leftover localhost on a deployed environment", () => {
    /**
     * `http://localhost:3000` is this repository's default. Deployed, it is a
     * leftover rather than a decision — honouring it would mail production
     * links to a developer's machine.
     */
    expect(
      resolveAuthOrigin({
        siteUrl: "http://localhost:3000",
        vercelEnv: "production",
        vercelUrl: "dd-abc123.vercel.app",
        productionUrl: "dd-sigma-vert.vercel.app",
      }),
    ).toBe(PRODUCTION);
  });
});

describe("local development stays local", () => {
  it("uses localhost when there is no deployment at all", () => {
    expect(
      resolveAuthOrigin({
        siteUrl: "http://localhost:3000",
        vercelEnv: undefined,
        vercelUrl: undefined,
        productionUrl: undefined,
      }),
    ).toBe("http://localhost:3000");
  });

  it("keeps a non-default local port", () => {
    // The dev server here runs on 3200.
    expect(
      resolveAuthOrigin({
        siteUrl: "http://localhost:3200",
        vercelEnv: "development",
        vercelUrl: undefined,
        productionUrl: undefined,
      }),
    ).toBe("http://localhost:3200");
  });

  it("falls back to localhost rather than nothing", () => {
    expect(
      resolveAuthOrigin({
        siteUrl: undefined,
        vercelEnv: undefined,
        vercelUrl: undefined,
        productionUrl: undefined,
      }),
    ).toBe("http://localhost:3000");
  });
});

describe("shape", () => {
  it("never emits a trailing slash, so the joined path cannot double up", () => {
    expect(
      resolveAuthOrigin({
        siteUrl: "https://app.example.com/",
        vercelEnv: "production",
        vercelUrl: undefined,
        productionUrl: undefined,
      }),
    ).toBe("https://app.example.com");
  });

  it("tolerates a scheme on a platform host without doubling it", () => {
    expect(
      resolveAuthOrigin({
        siteUrl: undefined,
        vercelEnv: "preview",
        vercelUrl: `https://${PREVIEW_HOST}`,
        productionUrl: undefined,
      }),
    ).toBe(`https://${PREVIEW_HOST}`);
  });
});

describe("the request can never choose the destination", () => {
  it("takes no request, header, cookie or host as input", async () => {
    /**
     * `Host` and `X-Forwarded-Host` are attacker-supplied. A Supabase allow
     * list holding a wildcard would then accept a neighbouring domain, and a
     * genuine password-reset email becomes delivery for somebody else's site.
     *
     * The type itself is the guarantee — `AuthOriginEnv` has four fields and
     * all four are platform build-time values — and this asserts nothing has
     * quietly reached for a request since.
     */
    const src = (await readFile(path.resolve("src/features/auth/site-url.ts"), "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    for (const forbidden of [
      /\bheaders\s*\(/,
      /x-forwarded-host/i,
      // Reading a header named host — not the local `trimHost(host)` helper,
      // which is a parameter and matching it would prove nothing.
      /\.get\(\s*["'`]host["'`]/i,
      /NextRequest|nextUrl|request\./,
      /cookies\s*\(/,
    ]) {
      expect(src, `must not read ${forbidden}`).not.toMatch(forbidden);
    }

    // And the only environment it reads is the platform's own.
    expect(src).toMatch(/process\.env\.VERCEL_ENV/);
    expect(src).toMatch(/process\.env\.VERCEL_URL/);
    expect(src).toMatch(/process\.env\.VERCEL_PROJECT_PRODUCTION_URL/);
  });
});
