import { describe, expect, it } from "vitest";
import { PRIVATE_CRAWL_PATHS } from "./crawl-policy";
import { SITE_ORIGIN } from "./seo";
import { buildSitemap } from "./sitemap";

describe("SEO/AEO sitemap", () => {
  it("includes approved static public routes", () => {
    const urls = buildSitemap([]).map((entry) => entry.url);
    expect(urls).toContain(`${SITE_ORIGIN}/`);
    expect(urls).toContain(`${SITE_ORIGIN}/about`);
    expect(urls).toContain(`${SITE_ORIGIN}/for-doctors`);
    expect(urls).toContain(`${SITE_ORIGIN}/learn`);
    expect(urls).toContain(`${SITE_ORIGIN}/editorial-policy`);
    expect(urls).toContain(`${SITE_ORIGIN}/medical-content-policy`);
    expect(urls).toContain(`${SITE_ORIGIN}/corrections-policy`);
    expect(urls).toContain(`${SITE_ORIGIN}/authors/agentsiraji`);
    expect(urls).toContain(`${SITE_ORIGIN}/reviewers`);
  });

  it("includes only slugs supplied by the search-eligible RPC consumer", () => {
    const urls = buildSitemap(["real-doctor"]).map((entry) => entry.url);
    expect(urls).toContain(`${SITE_ORIGIN}/dr/real-doctor`);
    expect(urls.some((url) => url.includes("qa.invalid"))).toBe(false);
  });

  it("includes explicitly supplied knowledge paths and no private application routes", () => {
    const urls = buildSitemap([], ["/learn/doctors/digital-consultation-workflow"]).map((entry) => entry.url);
    expect(urls).toContain(`${SITE_ORIGIN}/learn/doctors/digital-consultation-workflow`);
    for (const privatePath of PRIVATE_CRAWL_PATHS) {
      expect(urls.some((url) => new URL(url).pathname === privatePath || new URL(url).pathname.startsWith(`${privatePath}/`))).toBe(false);
    }
  });

  it("never emits a Preview deployment origin", () => {
    const urls = buildSitemap(["doctor-one"], ["/learn/doctors/digital-consultation-workflow"]).map((entry) => entry.url);
    expect(urls.every((url) => url.startsWith(SITE_ORIGIN))).toBe(true);
    expect(urls.some((url) => url.includes("vercel.app"))).toBe(false);
  });
});
