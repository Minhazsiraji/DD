import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

describe("pilot custom-domain readiness", () => {
  it("uses NEXT_PUBLIC_SITE_URL for doctor canonical and OpenGraph URLs", () => {
    const profile = source("src/app/dr/[slug]/page.tsx");
    expect(profile).toContain("publicEnv().NEXT_PUBLIC_SITE_URL");
    expect(profile).toContain("alternates: canonical ? { canonical } : undefined");
    expect(profile).toContain("url: canonical");
    expect(profile).not.toContain("VERCEL_PROJECT_PRODUCTION_URL");
    expect(profile).not.toContain("process.env.VERCEL_URL");
  });

  it("uses the configured canonical hostname for robots and sitemap", () => {
    const robots = source("src/app/robots.ts");
    const sitemap = source("src/app/sitemap.ts");
    expect(robots).toContain("process.env.NEXT_PUBLIC_SITE_URL");
    expect(sitemap).toContain("process.env.NEXT_PUBLIC_SITE_URL");
    expect(robots).toContain("NEXT_PUBLIC_SITE_URL is required in Production.");
    expect(sitemap).toContain("NEXT_PUBLIC_SITE_URL is required in Production.");
    expect(robots).not.toContain("dd-sigma-vert.vercel.app");
    expect(sitemap).not.toContain("dd-sigma-vert.vercel.app");
  });

  it("publishes only robots and sitemap without widening protected app routes", () => {
    const proxy = source("src/proxy.ts");
    const publicStart = proxy.indexOf("const PUBLIC_PATHS = [");
    const publicEnd = proxy.indexOf("];", publicStart);
    const publicPaths = proxy.slice(publicStart, publicEnd);

    expect(publicPaths).toContain('"/robots.txt"');
    expect(publicPaths).toContain('"/sitemap.xml"');
    expect(publicPaths).not.toContain('"/dashboard"');
    expect(publicPaths).not.toContain('"/patients"');
    expect(publicPaths).not.toContain('"/settings"');
    expect(publicPaths).not.toContain('"/owner"');

    expect(proxy).toContain("if (!user && !isPublic(pathname))");
    expect(proxy).toContain('url.pathname = "/login"');
    expect(proxy).toContain('pathname !== "/robots.txt"');
    expect(proxy).toContain('pathname !== "/sitemap.xml"');
  });
});
