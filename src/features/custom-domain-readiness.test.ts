import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

describe("pilot custom-domain readiness", () => {
  it("uses the branded production origin for doctor canonical and OpenGraph URLs", () => {
    const profile = source("src/app/dr/[slug]/page.tsx");
    const seo = source("src/lib/seo.ts");

    expect(seo).toContain('SITE_ORIGIN = "https://dd.agentsiraji.com"');
    expect(profile).toContain("canonicalUrl(`/dr/${encodeURIComponent(doctor.slug)}`)");
    expect(profile).toContain("alternates: { canonical }");
    expect(profile).toContain("url: canonical");
    expect(profile).not.toContain("VERCEL_PROJECT_PRODUCTION_URL");
    expect(profile).not.toContain("process.env.VERCEL_URL");
    expect(profile).not.toContain("vercel.app");
  });

  it("uses the branded production origin for robots and sitemap while Preview stays blocked", () => {
    const robots = source("src/app/robots.ts");
    const sitemap = source("src/app/sitemap.ts");
    const sitemapBuilder = source("src/lib/sitemap.ts");
    const seo = source("src/lib/seo.ts");

    expect(seo).toContain('SITE_ORIGIN = "https://dd.agentsiraji.com"');
    expect(robots).toContain("SITE_ORIGIN");
    expect(sitemapBuilder).toContain("SITE_ORIGIN");
    expect(robots).toContain('process.env.VERCEL_ENV === "production"');
    expect(robots).toContain('disallow: "/"');
    expect(sitemap).not.toContain("process.env.VERCEL_URL");
    expect(sitemapBuilder).not.toContain("vercel.app");
    expect(robots).not.toContain("dd-sigma-vert.vercel.app");
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
