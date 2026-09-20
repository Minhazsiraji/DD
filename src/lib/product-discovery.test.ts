import { afterEach, describe, expect, it } from "vitest";
import { PRIVATE_CRAWL_PATHS } from "./crawl-policy";
import { getAuthor } from "./knowledge";
import {
  getProductDiscoveryArticle,
  getProductDiscoveryArticles,
  getProductDiscoverySitemapPaths,
} from "./product-discovery";
import { SITE_ORIGIN, articleJsonLd } from "./seo";

const originalVercelEnv = process.env.VERCEL_ENV;

afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("voice and Autopilot product discovery content", () => {
  it("defines exactly eight doctor discovery articles and keeps all pending CENTRAL approval", () => {
    const articles = getProductDiscoveryArticles({ productionOnly: false });
    expect(articles).toHaveLength(8);
    expect(articles.every((article) => article.audience === "doctors")).toBe(true);
    expect(articles.every((article) => article.editorialApproval === "PENDING_CENTRAL")).toBe(true);
  });

  it("fails closed in Production until editorial approval", () => {
    process.env.VERCEL_ENV = "production";
    expect(getProductDiscoveryArticles()).toEqual([]);
    expect(getProductDiscoverySitemapPaths()).toEqual([]);
  });

  it("uses explicit product-truth status labels without unsupported availability claims", () => {
    const allowed = new Set(["LIVE / AVAILABLE", "PILOT", "IN QUALIFICATION", "PLANNED"]);
    const articles = getProductDiscoveryArticles({ productionOnly: false });
    for (const article of articles) {
      expect(allowed.has(article.capabilityStatus)).toBe(true);
      expect(article.capabilityStatus).toBe("PILOT");
      expect(article.statusDetail.length).toBeGreaterThan(30);
    }

    const diagnosis = getProductDiscoveryArticle(
      "doctors",
      "ai-assisted-investigation-diagnosis-workflow",
      { productionOnly: false },
    );
    expect(diagnosis?.statusDetail).toContain("Structured investigation proposals are PILOT");
    expect(diagnosis?.statusDetail).toContain("PLANNED");
    expect(diagnosis?.directAnswer).toContain("does not make the system an autonomous diagnostic tool");
  });

  it("keeps answer-first copy concise and preserves doctor authority", () => {
    for (const article of getProductDiscoveryArticles({ productionOnly: false })) {
      const words = article.directAnswer.trim().split(/\s+/).length;
      expect(words, `${article.slug} answer word count`).toBeGreaterThanOrEqual(40);
      expect(words, `${article.slug} answer word count`).toBeLessThanOrEqual(100);

      const headings = article.sections.map((section) => section.heading);
      expect(headings).toContain("What problem it solves");
      expect(headings).toContain("Where doctor confirmation is required");
      expect(headings.some((heading) => /What AI (may|is allowed to) do/i.test(heading))).toBe(true);
      expect(headings.some((heading) => /What AI (may not|is not allowed to) do/i.test(heading))).toBe(true);

      expect(article.relatedProductLinks.length).toBeGreaterThanOrEqual(3);
      expect(article.directAnswer).not.toMatch(/95%|\d+% time|doctors using|clinical superiority|improves outcomes/i);
    }
  });

  it("implements mixed-script Doctor's Diary Banglish semantics", () => {
    const article = getProductDiscoveryArticle(
      "doctors",
      "english-bangla-banglish-voice-clinical-notes",
      { productionOnly: false },
    );
    expect(article).toBeDefined();
    expect(article?.directAnswer).toContain("Patient এর তিন দিন ধরে fever এবং dry cough আছে।");
    expect(article?.directAnswer).toContain("English words stay English and Bangla words stay বাংলা");
    const definition = article?.sections.find((section) => section.heading === "How Doctor's Diary defines Banglish");
    expect(definition?.paragraphs.join(" ")).toContain("is not the preferred output convention");
  });

  it("interlinks only public Doctor's Diary entities and privacy/security pages", () => {
    for (const article of getProductDiscoveryArticles({ productionOnly: false })) {
      for (const item of [...article.relatedProductLinks, ...article.references]) {
        expect(item.href.startsWith("/")).toBe(true);
        expect(
          PRIVATE_CRAWL_PATHS.some(
            (prefix) => item.href === prefix || item.href.startsWith(`${prefix}/`),
          ),
          `${article.slug} links to private path ${item.href}`,
        ).toBe(false);
      }
    }
  });

  it("reuses the existing Article structured-data contract", () => {
    const article = getProductDiscoveryArticles({ productionOnly: false })[0];
    const author = getAuthor(article.authorSlug);
    expect(author).toBeDefined();
    if (!author) throw new Error("Expected product-discovery author");
    const path = `/learn/${article.audience}/${article.slug}`;
    const schema = articleJsonLd({ article, path, author });
    expect(schema).toMatchObject({
      "@type": "Article",
      headline: article.title,
      url: `${SITE_ORIGIN}${path}`,
      datePublished: "2026-09-21",
      dateModified: "2026-09-21",
    });
  });
});
