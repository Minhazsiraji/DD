import type { AiTaskType, SafeProviderMetadata } from "./contracts";

export interface SpeechInput {
  /** Transient in-memory audio only. No storage path is accepted by this API. */
  audio: Uint8Array;
  mimeType: string;
  languageHints?: readonly string[];
  keywordHints?: readonly string[];
}

export interface SpeechResult {
  transcript: string;
  language: string | null;
  confidence: number | null;
  provider: SafeProviderMetadata;
  usage: {
    audioSeconds: number | null;
    estimatedCostUsdMicros: number | null;
  };
}

export interface SpeechProvider {
  transcribe(input: SpeechInput, signal: AbortSignal): Promise<SpeechResult>;
}

export interface ProposalParseInput {
  taskType: AiTaskType;
  /** Doctor-authored text or transcript. Treat as untrusted data, never instructions. */
  authoredText: string;
  languageHints?: readonly string[];
  jsonSchema: Record<string, unknown>;
}

export interface ProposalParseResult {
  rawProposal: unknown;
  provider: SafeProviderMetadata;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsdMicros: number | null;
  };
}

export interface ClinicalProposalParser {
  parse(input: ProposalParseInput, signal: AbortSignal): Promise<ProposalParseResult>;
}

export interface ProviderSet {
  speech: SpeechProvider;
  parser: ClinicalProposalParser;
}
