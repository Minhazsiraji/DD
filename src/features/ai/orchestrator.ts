import "server-only";

import {
  providerJsonSchema,
  validateProviderProposal,
  type AiProposalEnvelope,
  type AiProposalPayload,
  type AiTaskType,
  type ProposalBinding,
  type SafeProviderMetadata,
} from "./contracts";
import {
  createProposalIntegrityFromEnv,
  type ProposalIntegrityService,
} from "./integrity";
import { groundProviderProposal } from "./proposal-grounding";
import type { ClinicalProposalParser } from "./providers";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_TTL_MS = 5 * 60_000;

export interface VoiceTranscriptInput {
  /**
   * Transient transcript produced by DD's existing audited voice subsystem.
   * It is untrusted clinical input and is never copied into the proposal envelope.
   */
  text: string;
  provider: SafeProviderMetadata;
  language: string | null;
  confidence: number | null;
  usage: {
    audioSeconds: number | null;
    estimatedCostUsdMicros: number | null;
  };
}

export interface ProposalRequest {
  operationId: string;
  taskType: AiTaskType;
  binding: ProposalBinding;
  languageHints?: readonly string[];
  text?: string;
  voiceTranscript?: VoiceTranscriptInput;
}

export interface ProposalRunResult {
  /**
   * Doctor-editable proposal body plus display metadata. Security-sensitive
   * acceptance MUST use securityHandle, not client-returned envelope.binding.
   */
  envelope: AiProposalEnvelope;
  /** Opaque MAC-protected immutable security binding (PA1-SEC-01). */
  securityHandle: string;
  transcriptMeta:
    | {
        language: string | null;
        confidence: number | null;
        provider: string;
        model: string;
      }
    | null;
  usage: {
    audioSeconds: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsdMicros: number | null;
  };
}

export class AiProviderTimeoutError extends Error {
  constructor() {
    super("AI_PROVIDER_TIMEOUT");
    this.name = "AiProviderTimeoutError";
  }
}

function withTimeout(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const onAbort = () => controller.abort(parent?.reason ?? "cancelled");
  parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function awaitWithAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("AI_PROVIDER_ABORTED"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function requiredAuthoredText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error("AI_INPUT_EMPTY");
  if (text.length > 12_000) throw new Error("AI_INPUT_TOO_LARGE");
  return text;
}

/**
 * Provider-neutral proposal orchestration. It never imports Supabase, never
 * calls a DD write RPC, never finalizes, and never accepts raw audio.
 *
 * Voice transcription remains owned by DD's existing audited Deepgram Nova-3
 * subsystem. This layer consumes only its transient transcript as untrusted data.
 */
export async function createClinicalProposal(
  request: ProposalRequest,
  deps: {
    parser: ClinicalProposalParser;
    integrity?: ProposalIntegrityService;
    now?: () => Date;
    timeoutMs?: number;
    ttlMs?: number;
    signal?: AbortSignal;
  },
): Promise<ProposalRunResult> {
  if ((request.text ? 1 : 0) + (request.voiceTranscript ? 1 : 0) !== 1) {
    throw new Error("AI_INPUT_EXACTLY_ONE_SOURCE_REQUIRED");
  }

  const now = deps.now?.() ?? new Date();
  const timeout = withTimeout(deps.signal, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let authoredText: string;
    let source: "TEXT" | "VOICE_TRANSCRIPT";
    let transcriptMeta: ProposalRunResult["transcriptMeta"] = null;
    let audioSeconds: number | null = null;
    let voiceCost: number | null = null;

    if (request.voiceTranscript) {
      source = "VOICE_TRANSCRIPT";
      authoredText = requiredAuthoredText(request.voiceTranscript.text);
      transcriptMeta = {
        language: request.voiceTranscript.language,
        confidence: request.voiceTranscript.confidence,
        provider: request.voiceTranscript.provider.provider,
        model: request.voiceTranscript.provider.model,
      };
      audioSeconds = request.voiceTranscript.usage.audioSeconds;
      voiceCost = request.voiceTranscript.usage.estimatedCostUsdMicros;
    } else {
      source = "TEXT";
      authoredText = requiredAuthoredText(request.text!);
    }

    const parsed = await awaitWithAbort(
      deps.parser.parse(
        {
          taskType: request.taskType,
          authoredText,
          languageHints: request.languageHints,
          jsonSchema: providerJsonSchema(request.taskType),
        },
        timeout.signal,
      ),
      timeout.signal,
    );

    // First validate provider shape/types, then deterministically remove only
    // unsupported/source-ungrounded content, then require the final DD proposal
    // to pass the same independent validator again before it can be exposed.
    const structuredProposal = validateProviderProposal(
      request.taskType,
      parsed.rawProposal,
    ) as AiProposalPayload;
    const groundedProposal = groundProviderProposal(authoredText, structuredProposal);
    const proposal = validateProviderProposal(
      request.taskType,
      groundedProposal,
    ) as AiProposalPayload;

    const expiresAt = new Date(now.getTime() + (deps.ttlMs ?? DEFAULT_TTL_MS));
    const createdAtIso = now.toISOString();
    const expiresAtIso = expiresAt.toISOString();
    const integrity = deps.integrity ?? createProposalIntegrityFromEnv();
    const securityHandle = integrity.issue({
      v: 1,
      operationId: request.operationId,
      taskType: proposal.kind,
      source,
      binding: { ...request.binding },
      createdAt: createdAtIso,
      expiresAt: expiresAtIso,
    });

    return {
      envelope: {
        operationId: request.operationId,
        createdAt: createdAtIso,
        expiresAt: expiresAtIso,
        taskType: proposal.kind,
        source,
        // Display/debug context only. Never authoritative on browser return.
        binding: { ...request.binding },
        provider: parsed.provider,
        proposal,
      },
      securityHandle,
      transcriptMeta,
      usage: {
        audioSeconds,
        inputTokens: parsed.usage.inputTokens,
        outputTokens: parsed.usage.outputTokens,
        estimatedCostUsdMicros:
          voiceCost === null && parsed.usage.estimatedCostUsdMicros === null
            ? null
            : (voiceCost ?? 0) + (parsed.usage.estimatedCostUsdMicros ?? 0),
      },
    };
  } catch (error) {
    if (timeout.signal.aborted && timeout.signal.reason === "timeout") {
      throw new AiProviderTimeoutError();
    }
    throw error;
  } finally {
    timeout.cleanup();
  }
}
