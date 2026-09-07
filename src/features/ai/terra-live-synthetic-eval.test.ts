import { describe, expect, it } from "vitest";
import { providerJsonSchema, validateProviderProposal } from "./contracts";
import { createOpenAiTerraSyntheticParserFromEnv } from "./openai-terra-provider";
import { PA1_SYNTHETIC_EVAL_CORPUS } from "./synthetic-eval-corpus";
import {
  scoreSyntheticEvaluation,
  type SyntheticEvalPrediction,
} from "./synthetic-eval";

const liveEnabled =
  process.env.PA1_SYNTHETIC_AI_EVAL === "enabled" &&
  typeof process.env.OPENAI_API_KEY === "string" &&
  process.env.OPENAI_API_KEY.length > 0;

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  if (error instanceof Error) return error.name || "ERROR";
  return "UNKNOWN_ERROR";
}

describe.skipIf(!liveEnabled)("Terra live synthetic semantic evaluation", () => {
  it(
    "evaluates the full hand-authored corpus and emits semantic metrics",
    async () => {
      const parser = createOpenAiTerraSyntheticParserFromEnv();
      const predictions: SyntheticEvalPrediction[] = [];

      // Deliberately sequential: this is a small safety/accuracy evaluation,
      // not a load test, and keeps provider traffic/cost bounded and auditable.
      for (const item of PA1_SYNTHETIC_EVAL_CORPUS) {
        try {
          const parsed = await parser.parse(
            {
              taskType: item.taskType,
              authoredText: item.authoredText,
              languageHints: item.languageHints,
              jsonSchema: providerJsonSchema(item.taskType),
            },
            AbortSignal.timeout(30_000),
          );
          predictions.push({
            caseId: item.id,
            proposal: validateProviderProposal(item.taskType, parsed.rawProposal),
          });
        } catch (error) {
          predictions.push({ caseId: item.id, proposal: null, errorCode: errorCode(error) });
        }
      }

      const overall = scoreSyntheticEvaluation(PA1_SYNTHETIC_EVAL_CORPUS, predictions);
      const englishCases = PA1_SYNTHETIC_EVAL_CORPUS.filter((item) => item.language === "ENGLISH");
      const banglaCases = PA1_SYNTHETIC_EVAL_CORPUS.filter((item) => item.language === "BANGLA");
      const mixedCases = PA1_SYNTHETIC_EVAL_CORPUS.filter((item) => item.language === "MIXED");
      const report = {
        model: "gpt-5.6-terra",
        corpusVersion: "pa1-c1-2026-09-07",
        syntheticOnly: true,
        overall,
        english: scoreSyntheticEvaluation(englishCases, predictions),
        bangla: scoreSyntheticEvaluation(banglaCases, predictions),
        mixed: scoreSyntheticEvaluation(mixedCases, predictions),
      };

      // Marker is intentionally machine-searchable in CI logs. Corpus text and
      // model proposal payloads are never printed.
      console.log(`PA1_TERRA_SYNTHETIC_METRICS=${JSON.stringify(report)}`);
      expect(overall.cases).toBe(PA1_SYNTHETIC_EVAL_CORPUS.length);
      expect(overall.providerErrors).toBe(0);
    },
    10 * 60_000,
  );
});
