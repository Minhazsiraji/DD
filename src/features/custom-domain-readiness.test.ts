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
    const crawlPolicy = source("src/lib/crawl-policy.ts");
    const sitemap = source("src/app/sitemap.ts");
    const sitemapBuilder = source("src/lib/sitemap.ts");
    const seo = source("src/lib/seo.ts");

    expect(seo).toContain('SITE_ORIGIN = "https://dd.agentsiraji.com"');
    expect(crawlPolicy).toContain("SITE_ORIGIN");
    expect(crawlPolicy).toContain('sitemap: `${SITE_ORIGIN}/sitemap.xml`');
    expect(sitemapBuilder).toContain("SITE_ORIGIN");
    expect(robots).toContain('process.env.VERCEL_ENV === "production"');
    expect(crawlPolicy).toContain('disallow: "/"');
    expect(sitemap).not.toContain("process.env.VERCEL_URL");
    expect(sitemapBuilder).not.toContain("vercel.app");
    expect(crawlPolicy).not.toContain("dd-sigma-vert.vercel.app");
  });

  it("publishes approved public discovery routes without widening protected app routes", () => {
    const proxy = source("src/proxy.ts");
    const publicRoutes = source("src/lib/public-routes.ts");
    const crawlPolicy = source("src/lib/crawl-policy.ts");

    expect(publicRoutes).toContain('"/robots.txt"');
    expect(publicRoutes).toContain('"/sitemap.xml"');
    expect(publicRoutes).toContain('"/about"');
    expect(publicRoutes).toContain('"/for-doctors"');
    expect(publicRoutes).toContain('"/learn"');
    expect(publicRoutes).toContain('"/editorial-policy"');
    expect(publicRoutes).toContain('"/medical-content-policy"');
    expect(publicRoutes).toContain('"/corrections-policy"');
    expect(publicRoutes).toContain('"/authors"');
    expect(publicRoutes).toContain('"/reviewers"');

    expect(publicRoutes).not.toContain('"/dashboard"');
    expect(publicRoutes).not.toContain('"/patients"');
    expect(publicRoutes).not.toContain('"/settings"');
    expect(publicRoutes).not.toContain('"/owner"');

    expect(proxy).toContain("if (!user && !isPublicRequestPath(pathname))");
    expect(proxy).toContain('url.pathname = "/login"');

    expect(crawlPolicy).toContain('"/dashboard"');
    expect(crawlPolicy).toContain('"/patients"');
    expect(crawlPolicy).toContain('"/settings"');
    expect(crawlPolicy).toContain('"/owner"');
    expect(crawlPolicy).toContain('"/api/"');
  });
});
