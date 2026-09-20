import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRIVATE_CRAWL_PATHS,
  PUBLIC_CRAWL_PATHS,
  SEARCH_CRAWLERS,
  TRAINING_CRAWLERS,
  buildRobots,
} from "./crawl-policy";
import { SITE_ORIGIN } from "./seo";

type Rule = { userAgent: string | string[]; allow?: string | string[]; disallow?: string | string[] };

function productionRules(): Rule[] {
  const rules = buildRobots(true).rules;
  return (Array.isArray(rules) ? rules : [rules]) as Rule[];
}

function ruleFor(userAgent: string): Rule | undefined {
  return productionRules().find((rule) => rule.userAgent === userAgent);
}

describe("AEO/GEO crawler policy", () => {
  it("allows search/citation crawlers while preserving private exclusions", () => {
    for (const crawler of SEARCH_CRAWLERS) {
      const rule = ruleFor(crawler);
      expect(rule).toBeDefined();
      expect(rule?.allow).toEqual(expect.arrayContaining(["/learn", "/about", "/for-doctors", "/dr/"]));
      expect(rule?.disallow).toEqual(expect.arrayContaining(["/dashboard", "/patients", "/api/"]));
    }
  });

  it("disallows model-training/extended-use crawlers", () => {
    for (const crawler of TRAINING_CRAWLERS) {
      expect(ruleFor(crawler)?.disallow).toBe("/");
    }
  });

  it("keeps Preview globally blocked", () => {
    expect(buildRobots(false)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("publishes only the branded Production sitemap authority", () => {
    expect(buildRobots(true).sitemap).toBe(`${SITE_ORIGIN}/sitemap.xml`);
  });

  it("covers every current authenticated app namespace with an explicit crawl exclusion", () => {
    const appDir = join(process.cwd(), "src", "app", "(app)");
    const routeDirs = readdirSync(appDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/${entry.name}`);

    for (const route of routeDirs) {
      expect(
        PRIVATE_CRAWL_PATHS.some(
          (prefix) => route === prefix || route.startsWith(`${prefix}/`) || prefix.startsWith(`${route}/`),
        ),
        `${route} is missing from PRIVATE_CRAWL_PATHS`,
      ).toBe(true);
    }
  });

  it("keeps public and private route declarations non-overlapping", () => {
    for (const publicPath of PUBLIC_CRAWL_PATHS) {
      expect(PRIVATE_CRAWL_PATHS).not.toContain(publicPath as (typeof PRIVATE_CRAWL_PATHS)[number]);
    }
  });
});
