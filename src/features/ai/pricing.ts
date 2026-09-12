import type { ProviderUsageReport } from "./providers";
import { picousdFromMicros, type Picousd } from "./money";

/**
 * Provider pricing and cost attribution (O1-E-R3).
 *
 * NO PRICE IS HARDCODED HERE. A rate is data with a source and a capture date,
 * supplied as a snapshot. With no snapshot for a provider/model, cost is
 * UNPRICED and therefore NULL — never a guessed number, and never zero.
 *
 * COST-BEARING ROW INVARIANT. Every priced operation attributes its cost under
 * exactly one mode, fixed at emission and never mixed:
 *
 *   ALLOCATED  cost split across GENUINELY DISJOINT billable meters. Uncached
 *              input, cached input and output partition the billed volume, so
 *              the three amounts sum to the total with nothing counted twice.
 *              Reasoning tokens are a subset of output and carry no cost here.
 *   CANONICAL  the provider reported a total; it sits on one canonical row
 *              (output for AI, audio for voice) and every other meter carries
 *              an authoritative zero increment.
 */

export type PricingMeter =
  | "INPUT_TOKENS"
  | "CACHED_INPUT_TOKENS"
  | "OUTPUT_TOKENS"
  | "AUDIO_SECONDS";

export interface PricingSnapshot {
  /** Opaque, immutable. A new rate is a new snapshot, never an edit. */
  id: string;
  providerId: string;
  modelId: string;
  /** Effective from this instant. */
  capturedAt: string;
  sourceRef: string;
  /**
   * Integer USD micros. Token meters are priced per 1,000,000 tokens;
   * AUDIO_SECONDS per second of audio.
   */
  unitPriceUsdMicros: Partial<Record<PricingMeter, bigint>>;
}

export interface PricingBook {
  /** The snapshot in force at `at`, or null. Never a fallback guess. */
  snapshotFor(providerId: string, modelId: string, at: Date): PricingSnapshot | null;
}

export const EMPTY_PRICING_BOOK: PricingBook = Object.freeze({
  snapshotFor: () => null,
});

export function createPricingBook(snapshots: readonly PricingSnapshot[]): PricingBook {
  const frozen = snapshots.map((snapshot) => Object.freeze({ ...snapshot }));
  return {
    snapshotFor(providerId, modelId, at) {
      let chosen: PricingSnapshot | null = null;
      for (const snapshot of frozen) {
        if (snapshot.providerId !== providerId || snapshot.modelId !== modelId) continue;
        const from = Date.parse(snapshot.capturedAt);
        if (Number.isNaN(from) || from > at.getTime()) continue;
        if (!chosen || from > Date.parse(chosen.capturedAt)) chosen = snapshot;
      }
      return chosen;
    },
  };
}

let configuredPricingBook: PricingBook = EMPTY_PRICING_BOOK;

/** Server configuration hook. Until a book is configured, every cost is UNPRICED. */
export function configureAiPricingBook(book: PricingBook): void {
  configuredPricingBook = book;
}

export function getAiPricingBook(): PricingBook {
  return configuredPricingBook;
}

export type CostState =
  | "ESTIMATED"
  | "PROVIDER_REPORTED"
  | "RECONCILED"
  | "UNKNOWN_PENDING_RECONCILIATION"
  | "UNPRICED"
  /** Provider never reached, or nothing was consumed: an authoritative zero. */
  | "NOT_INCURRED";

export type CostSource = "PRICING_SNAPSHOT" | "PROVIDER_REPORTED" | "RECONCILIATION";
export type CostAttributionMode = "ALLOCATED" | "CANONICAL";

export interface TokenCostFacts {
  state: CostState;
  source: CostSource | null;
  mode: CostAttributionMode | null;
  pricingSnapshotId: string | null;
  /** Null whenever any required component is unknown. */
  total: Picousd | null;
  /** Disjoint per-meter amounts. They sum exactly to `total` when known. */
  inputUncached: Picousd | null;
  cachedInput: Picousd | null;
  output: Picousd | null;
}

const ZERO = BigInt(0);

function unknownCost(state: CostState, pricingSnapshotId: string | null = null): TokenCostFacts {
  return {
    state,
    source: null,
    mode: null,
    pricingSnapshotId,
    total: null,
    inputUncached: null,
    cachedInput: null,
    output: null,
  };
}

function isCount(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

/** tokens × (micros per 1,000,000 tokens) is exactly picodollars. */
function tokenCost(tokens: number, microsPerMillion: bigint): Picousd {
  return BigInt(tokens) * microsPerMillion;
}

export function costForTokenUsage(
  usage: ProviderUsageReport,
  snapshot: PricingSnapshot | null,
): TokenCostFacts {
  if (usage.state === "NOT_APPLICABLE") {
    return {
      state: "NOT_INCURRED",
      source: null,
      mode: null,
      pricingSnapshotId: null,
      total: ZERO,
      inputUncached: ZERO,
      cachedInput: ZERO,
      output: ZERO,
    };
  }
  if (usage.state === "UNKNOWN_PENDING_RECONCILIATION") {
    return unknownCost("UNKNOWN_PENDING_RECONCILIATION");
  }

  // CANONICAL: a provider-reported total, attached once. Never combined with
  // an allocation for the same operation.
  if (usage.providerReportedCostUsdMicros !== null) {
    const reported = picousdFromMicros(usage.providerReportedCostUsdMicros);
    return {
      state: "PROVIDER_REPORTED",
      source: "PROVIDER_REPORTED",
      mode: "CANONICAL",
      pricingSnapshotId: null,
      total: reported,
      inputUncached: ZERO,
      cachedInput: ZERO,
      output: reported,
    };
  }

  const { inputTokens, cachedInputTokens, outputTokens } = usage.tokens;
  // Allocation needs every billable component. A missing cached split means
  // the uncached quantity is unknown too — pricing all input at the full rate
  // would be a guess, so the cost is unknown rather than estimated.
  if (!isCount(inputTokens) || !isCount(cachedInputTokens) || !isCount(outputTokens)) {
    return unknownCost("UNKNOWN_PENDING_RECONCILIATION");
  }
  if (cachedInputTokens > inputTokens) return unknownCost("UNKNOWN_PENDING_RECONCILIATION");
  if (!snapshot) return unknownCost("UNPRICED");

  const uncached = inputTokens - cachedInputTokens;
  const rates = snapshot.unitPriceUsdMicros;
  const priced = (tokens: number, rate: bigint | undefined): Picousd | null => {
    if (tokens === 0) return ZERO; // zero tokens cost zero at any rate
    return rate === undefined ? null : tokenCost(tokens, rate);
  };

  const inputUncached = priced(uncached, rates.INPUT_TOKENS);
  const cachedInput = priced(cachedInputTokens, rates.CACHED_INPUT_TOKENS);
  const output = priced(outputTokens, rates.OUTPUT_TOKENS);
  if (inputUncached === null || cachedInput === null || output === null) {
    return unknownCost("UNPRICED", snapshot.id);
  }

  return {
    state: "ESTIMATED",
    source: "PRICING_SNAPSHOT",
    mode: "ALLOCATED",
    pricingSnapshotId: snapshot.id,
    total: inputUncached + cachedInput + output,
    inputUncached,
    cachedInput,
    output,
  };
}

export interface AudioCostFacts {
  state: CostState;
  source: CostSource | null;
  mode: CostAttributionMode | null;
  pricingSnapshotId: string | null;
  total: Picousd | null;
}

/**
 * Streamed audio duration × per-second rate. ms × (micros per second) × 1000
 * is exactly picodollars.
 */
export function costForAudio(
  streamedAudioMs: number | null,
  snapshot: PricingSnapshot | null,
): AudioCostFacts {
  if (streamedAudioMs === null || !isCount(streamedAudioMs)) {
    return {
      state: "UNKNOWN_PENDING_RECONCILIATION",
      source: null,
      mode: null,
      pricingSnapshotId: null,
      total: null,
    };
  }
  if (streamedAudioMs === 0) {
    return { state: "NOT_INCURRED", source: null, mode: null, pricingSnapshotId: null, total: ZERO };
  }
  const rate = snapshot?.unitPriceUsdMicros.AUDIO_SECONDS;
  if (!snapshot || rate === undefined) {
    return {
      state: "UNPRICED",
      source: null,
      mode: null,
      pricingSnapshotId: snapshot?.id ?? null,
      total: null,
    };
  }
  return {
    state: "ESTIMATED",
    source: "PRICING_SNAPSHOT",
    mode: "ALLOCATED",
    pricingSnapshotId: snapshot.id,
    total: BigInt(streamedAudioMs) * rate * BigInt(1000),
  };
}
