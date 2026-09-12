import type { AiTaskType, SafeProviderMetadata } from "./contracts";

export interface ProposalParseInput {
  taskType: AiTaskType;
  /** Doctor-authored text or a DD voice transcript. Treat as untrusted data, never instructions. */
  authoredText: string;
  languageHints?: readonly string[];
  jsonSchema: Record<string, unknown>;
}

/**
 * What a provider told us about consumption — and, as importantly, what it
 * did not.
 *
 *   REPORTED                        the provider returned a usage block
 *   UNKNOWN_PENDING_RECONCILIATION  the call was dispatched and the provider may
 *                                   have consumed (and billed), but reported
 *                                   nothing DD can trust — a timeout, an abort,
 *                                   a response with no usage block
 *   NOT_APPLICABLE                  the call never reached the provider, so
 *                                   consumption is an authoritative zero
 *
 * A missing component stays `null`. It is never inferred, defaulted or
 * zero-filled: null means "not reported", 0 means "reported as zero".
 */
export type ProviderUsageState = "REPORTED" | "UNKNOWN_PENDING_RECONCILIATION" | "NOT_APPLICABLE";

export interface ProviderTokenUsage {
  /** Total input tokens, INCLUDING any cached portion. */
  inputTokens: number | null;
  /** Cached subset of `inputTokens`, billed at the cached rate. */
  cachedInputTokens: number | null;
  /** Total output tokens, INCLUDING any reasoning portion. */
  outputTokens: number | null;
  /** Reasoning subset of `outputTokens`. Diagnostic only — already priced inside output. */
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export interface ProviderUsageReport {
  state: ProviderUsageState;
  tokens: ProviderTokenUsage;
  /**
   * A total cost reported by the provider itself, in integer USD micros.
   * Null unless the provider reports one. When present it is attached to a
   * single canonical cost-bearing row and never also allocated across meters.
   */
  providerReportedCostUsdMicros: bigint | null;
}

const NO_TOKENS: ProviderTokenUsage = Object.freeze({
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  totalTokens: null,
});

/** Dispatched, consumption not reported. NOT zero. */
export const UNKNOWN_USAGE: ProviderUsageReport = Object.freeze({
  state: "UNKNOWN_PENDING_RECONCILIATION",
  tokens: NO_TOKENS,
  providerReportedCostUsdMicros: null,
});

/** Never dispatched. Authoritative zero consumption. */
export const NOT_DISPATCHED_USAGE: ProviderUsageReport = Object.freeze({
  state: "NOT_APPLICABLE",
  tokens: NO_TOKENS,
  providerReportedCostUsdMicros: null,
});

export function reportedUsage(
  tokens: Partial<ProviderTokenUsage>,
  providerReportedCostUsdMicros: bigint | null = null,
): ProviderUsageReport {
  return {
    state: "REPORTED",
    tokens: { ...NO_TOKENS, ...tokens },
    providerReportedCostUsdMicros,
  };
}

export interface ProposalParseResult {
  rawProposal: unknown;
  provider: SafeProviderMetadata;
  usage: ProviderUsageReport;
}

/**
 * Static attribution for an adapter. Needed because a call that times out or
 * throws never returns `ProposalParseResult.provider`, yet its consumption
 * still has to be attributed to a provider and model.
 */
export interface ProviderDescriptor {
  provider: string;
  model: string;
}

/**
 * Provider-neutral structured-proposal boundary.
 *
 * Speech-to-text is intentionally NOT implemented here. Doctor's Diary already
 * has an audited Deepgram Nova-3 streaming subsystem. PA1 consumes the resulting
 * transcript as transient authored text and must not create a second audio/STT
 * transport, credential path, or persistence surface.
 */
export interface ClinicalProposalParser {
  readonly descriptor?: ProviderDescriptor;
  parse(input: ProposalParseInput, signal: AbortSignal): Promise<ProposalParseResult>;
}

/**
 * Facts an adapter attaches to an error it throws, so a failed call is still
 * accounted for truthfully. A provider can bill for a response DD rejects — an
 * `incomplete` response that hit the output limit is the common case — and
 * that usage must not vanish with the exception.
 *
 * `failureCode` is an enumerated code. It is never a provider message.
 */
export interface ProviderAttemptFacts {
  failureCode: string;
  dispatched: boolean;
  usage: ProviderUsageReport;
  httpStatus: number | null;
}

export interface ProviderAttemptFailure {
  readonly providerAttempt: ProviderAttemptFacts;
}

export function providerAttemptFacts(error: unknown): ProviderAttemptFacts | null {
  if (!error || typeof error !== "object") return null;
  const facts = (error as Partial<ProviderAttemptFailure>).providerAttempt;
  if (!facts || typeof facts !== "object") return null;
  return facts;
}
