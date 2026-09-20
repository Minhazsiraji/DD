import { afterEach, describe, expect, it } from "vitest";
import { AI_BENCHMARK_QUERIES, AI_BENCHMARK_RESULT_FIELDS } from "./ai-benchmark";
import { PRIVATE_CRAWL_PATHS } from "./crawl-policy";
import {
  GATED_PATIENT_CLINICAL_BACKLOG,
  PUBLIC_REVIEWERS,
  articlePath,
  getKnowledgeArticles,
  isGovernanceEligible,
  isProductionPublishable,
} from "./knowledge";

const originalVercelEnv = process.env.VERCEL_ENV;

afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("AEO/GEO knowledge governance", () => {
  it("builds 13 reviewable core articles and gates the two patient-clinical backlog topics", () => {
    process.env.VERCEL_ENV = "preview";
    const articles = getKnowledgeArticles();
    expect(articles).toHaveLength(13);
    expect(articles.every(isGovernanceEligible)).toBe(true);
    expect(GATED_PATIENT_CLINICAL_BACKLOG).toHaveLength(2);
    expect(GATED_PATIENT_CLINICAL_BACKLOG.every((item) => item.contentClass === "PATIENT_CLINICAL")).toBe(true);
  });

  it("does not auto-publish release-candidate articles to Production", () => {
    process.env.VERCEL_ENV = "production";
    expect(getKnowledgeArticles()).toEqual([]);

    process.env.VERCEL_ENV = "preview";
    expect(getKnowledgeArticles().every((article) => !isProductionPublishable(article))).toBe(true);
  });

  it("publishes no fabricated medical reviewer", () => {
    expect(PUBLIC_REVIEWERS).toEqual([]);
  });

  it("keeps answer-first direct answers concise and self-contained", () => {
    process.env.VERCEL_ENV = "preview";
    for (const article of getKnowledgeArticles()) {
      const words = article.directAnswer.trim().split(/\s+/).length;
      expect(words, `${article.slug} answer word count`).toBeGreaterThanOrEqual(40);
      expect(words, `${article.slug} answer word count`).toBeLessThanOrEqual(100);
      expect(article.question.length).toBeGreaterThan(10);
      expect(article.sections.length).toBeGreaterThan(0);
      expect(article.relatedQuestions.length).toBeGreaterThan(0);
      expect(article.references.length).toBeGreaterThan(0);
    }
  });

  it("never links knowledge references into private application namespaces", () => {
    process.env.VERCEL_ENV = "preview";
    for (const article of getKnowledgeArticles()) {
      for (const reference of article.references) {
        expect(
          PRIVATE_CRAWL_PATHS.some(
            (prefix) => reference.href === prefix || reference.href.startsWith(`${prefix}/`),
          ),
          `${article.slug} links to private path ${reference.href}`,
        ).toBe(false);
      }
      expect(articlePath(article)).toMatch(/^\/learn\/(doctors|patients|medical-students)\//);
    }
  });
});

describe("AI visibility benchmark", () => {
  it("contains exactly 60 stable benchmark questions split 20/20/20", () => {
    expect(AI_BENCHMARK_QUERIES).toHaveLength(60);
    expect(new Set(AI_BENCHMARK_QUERIES.map((item) => item.id)).size).toBe(60);
    expect(AI_BENCHMARK_QUERIES.filter((item) => item.audience === "doctors")).toHaveLength(20);
    expect(AI_BENCHMARK_QUERIES.filter((item) => item.audience === "patients")).toHaveLength(20);
    expect(AI_BENCHMARK_QUERIES.filter((item) => item.audience === "medical-students")).toHaveLength(20);
  });

  it("freezes the required measurement fields", () => {
    expect(AI_BENCHMARK_RESULT_FIELDS).toEqual([
      "date",
      "product",
      "queryId",
      "exactQuery",
      "ddAppeared",
      "ddCited",
      "citedUrl",
      "citationSupportsClaim",
      "competingSources",
      "contentGap",
    ]);
  });
});
