import { describe, expect, it } from "vitest";
import { AI_BENCHMARK_QUERIES } from "./ai-benchmark";
import {
  PRODUCT_DISCOVERY_BENCHMARK_QUERIES,
  PRODUCT_DISCOVERY_RESULT_FIELDS,
} from "./product-discovery-benchmark";

describe("Product Discovery benchmark", () => {
  it("preserves the original 60-query benchmark and adds a separate 22-query set", () => {
    expect(AI_BENCHMARK_QUERIES).toHaveLength(60);
    expect(PRODUCT_DISCOVERY_BENCHMARK_QUERIES).toHaveLength(22);
    expect(new Set(PRODUCT_DISCOVERY_BENCHMARK_QUERIES.map((item) => item.id)).size).toBe(22);
    expect(PRODUCT_DISCOVERY_BENCHMARK_QUERIES[0]?.id).toBe("PD01");
    expect(PRODUCT_DISCOVERY_BENCHMARK_QUERIES.at(-1)?.id).toBe("PD22");
  });

  it("covers every CENTRAL product-discovery topic", () => {
    const topics = new Set(PRODUCT_DISCOVERY_BENCHMARK_QUERIES.map((item) => item.topic));
    expect(topics).toEqual(
      new Set([
        "voice-prescription",
        "prescription-without-typing",
        "doctor-time-saving",
        "clinical-autopilot",
        "voice-commands",
        "bangla-banglish-dictation",
        "ai-prescription-drafting",
        "doctor-final-approval",
        "investigation-proposals",
        "diagnosis-assistance",
        "human-in-the-loop-medical-ai",
      ]),
    );
  });

  it("freezes the required measurement fields", () => {
    expect(PRODUCT_DISCOVERY_RESULT_FIELDS).toEqual([
      "date",
      "product",
      "queryId",
      "exactQuery",
      "ddAppeared",
      "ddCited",
      "citedUrl",
      "citationSupportsClaim",
      "competitorOrSourceCitedInstead",
      "missingContentOpportunity",
    ]);
  });
});
