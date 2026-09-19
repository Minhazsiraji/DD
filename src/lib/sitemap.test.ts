import { describe, expect, it } from "vitest";
import { SITE_ORIGIN } from "./seo";
import { buildSitemap } from "./sitemap";

describe("SEO sitemap", () => {
  it("includes approved static public routes", () => {
    const urls = buildSitemap([]).map((entry) => entry.url);
    expect(urls).toContain(`${SITE_ORIGIN}/`);
    expect(urls).toContain(`${SITE_ORIGIN}/about`);
    expect(urls).toContain(`${SITE_ORIGIN}/for-doctors`);
  });

  it("includes only slugs supplied by the search-eligible RPC consumer", () => {
    const urls = buildSitemap(["real-doctor"]).map((entry) => entry.url);
    expect(urls).toContain(`${SITE_ORIGIN}/dr/real-doctor`);
    expect(urls.some((url) => url.includes("qa.invalid"))).toBe(false);
  });

  it("never emits a Preview deployment origin", () => {
    const urls = buildSitemap(["doctor-one"]).map((entry) => entry.url);
    expect(urls.every((url) => url.startsWith(SITE_ORIGIN))).toBe(true);
    expect(urls.some((url) => url.includes("vercel.app"))).toBe(false);
  });
});
