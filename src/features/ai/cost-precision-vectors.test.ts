import { describe, expect, it } from "vitest";
import { COST_PRECISION_VECTORS } from "./cost-precision-vectors";
import {
  microsDecimalToPicousd,
  minorDecimalToPicousd,
  picousdToMicrosDecimal,
  picousdToMinorDecimal,
  sumOrUnknown,
} from "./money";
import { costForAudio, costForTokenUsage } from "./pricing";
import { reportedUsage } from "./providers";

describe("O1-E → O1-F cost precision vectors (the E side of the round trip)", () => {
  it.each(COST_PRECISION_VECTORS.filter((v) => v.picousd !== null))(
    "emits exactly: $label",
    (vector) => {
      const value = BigInt(vector.picousd!);
      expect(picousdToMicrosDecimal(value)).toBe(vector.micros);
      expect(picousdToMinorDecimal(value)).toBe(vector.minor);
      expect(microsDecimalToPicousd(vector.micros!)).toBe(value);
      expect(minorDecimalToPicousd(vector.minor!)).toBe(value);
    },
  );

  it("keeps unknown as null on both representations", () => {
    const unknown = COST_PRECISION_VECTORS.find((v) => v.picousd === null)!;
    expect(unknown.micros).toBeNull();
    expect(unknown.minor).toBeNull();
    expect(sumOrUnknown([BigInt(1), null])).toBeNull();
  });

  it("the vectors are what the pricing code actually produces", () => {
    const snapshot = {
      id: "vectors",
      providerId: "openai",
      modelId: "gpt-5.6-terra",
      capturedAt: "2026-01-01T00:00:00.000Z",
      sourceRef: "vectors",
      unitPriceUsdMicros: {
        INPUT_TOKENS: BigInt(250_000),
        CACHED_INPUT_TOKENS: BigInt(25_000),
        OUTPUT_TOKENS: BigInt(2_500_000),
        AUDIO_SECONDS: BigInt(77),
      },
    };
    const r3 = costForTokenUsage(
      reportedUsage({ inputTokens: 1000, cachedInputTokens: 200, outputTokens: 38 }),
      snapshot,
    );
    expect(picousdToMinorDecimal(r3.inputUncached!)).toBe("0.0200000000");
    expect(picousdToMinorDecimal(r3.cachedInput!)).toBe("0.0005000000");
    expect(picousdToMinorDecimal(r3.output!)).toBe("0.0095000000");
    expect(picousdToMinorDecimal(r3.total!)).toBe("0.0300000000");
    expect(picousdToMinorDecimal(costForAudio(2000, snapshot).total!)).toBe("0.0154000000");
    const smallest = costForTokenUsage(
      reportedUsage({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 }),
      { ...snapshot, unitPriceUsdMicros: { INPUT_TOKENS: BigInt(1) } },
    );
    expect(picousdToMinorDecimal(smallest.total!)).toBe("0.0000000001");
  });

  it("a scale-6 minor column would turn the smallest positive cost into zero", () => {
    const smallest = COST_PRECISION_VECTORS[0]!;
    const [whole, fraction] = smallest.minor!.split(".");
    const truncatedToScale6 = `${whole}.${fraction!.slice(0, 6)}`;
    expect(minorDecimalToPicousd(truncatedToScale6.padEnd(truncatedToScale6.length + 4, "0"))).toBe(BigInt(0));
    expect(BigInt(smallest.picousd!)).toBeGreaterThan(BigInt(0));
  });
});
