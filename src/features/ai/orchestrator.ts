import "server-only";

import {
  providerJsonSchema,
  validateProviderProposal,
  type AiProposalEnvelope,
  type AiProposalPayload,
  type AiTaskType,
  type ProposalBinding,
} from "./contracts";
import type { ClinicalProposalParser, SpeechProvider } from "./providers";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_TTL_MS = 5 * 60_000;

export interface ProposalRequest {
  operationId: string;
  taskType: AiTaskType;
  binding: ProposalBinding;
  languageHints?: readonly string[];
  text?: string;
  audio?: {
    /** Transient bytes only. This layer has no persistence API. */
    bytes: Uint8Array;
    mimeType: string;
    keywordHints?: readonly string[];
  };
}

export interface ProposalRunResult {
  envelope: AiProposalEnvelope;
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
 * calls a DD write RPC, never finalizes, and never persists raw audio.
 */
export async function createClinicalProposal(
  request: ProposalRequest,
  deps: {
    parser: ClinicalProposalParser;
    speech?: SpeechProvider;
    now?: () => Date;
    timeoutMs?: number;
    ttlMs?: number;
    signal?: AbortSignal;
  },
): Promise<ProposalRunResult> {
  if ((request.text ? 1 : 0) + (request.audio ? 1 : 0) !== 1) {
    throw new Error("AI_INPUT_EXACTLY_ONE_SOURCE_REQUIRED");
  }

  const now = deps.now?.() ?? new Date();
  const timeout = withTimeout(deps.signal, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let authoredText: string;
    let source: "TEXT" | "VOICE_TRANSCRIPT";
    let transcriptMeta: ProposalRunResult["transcriptMeta"] = null;
    let audioSeconds: number | null = null;
    let audioCost: number | null = null;

    if (request.audio) {
      if (!deps.speech) throw new Error("AI_SPEECH_PROVIDER_REQUIRED");
      source = "VOICE_TRANSCRIPT";
      const result = await awaitWithAbort(
        deps.speech.transcribe(
          {
            audio: request.audio.bytes,
            mimeType: request.audio.mimeType,
            languageHints: request.languageHints,
            keywordHints: request.audio.keywordHints,
          },
          timeout.signal,
        ),
        timeout.signal,
      );
      authoredText = requiredAuthoredText(result.transcript);
      transcriptMeta = {
        language: result.language,
        confidence: result.confidence,
        provider: result.provider.provider,
        model: result.provider.model,
      };
      audioSeconds = result.usage.audioSeconds;
      audioCost = result.usage.estimatedCostUsdMicros;
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

    const proposal = validateProviderProposal(
      request.taskType,
      parsed.rawProposal,
    ) as AiProposalPayload;
    const expiresAt = new Date(now.getTime() + (deps.ttlMs ?? DEFAULT_TTL_MS));

    return {
      envelope: {
        operationId: request.operationId,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        taskType: proposal.kind,
        source,
        binding: { ...request.binding },
        provider: parsed.provider,
        proposal,
      },
      transcriptMeta,
      usage: {
        audioSeconds,
        inputTokens: parsed.usage.inputTokens,
        outputTokens: parsed.usage.outputTokens,
        estimatedCostUsdMicros:
          audioCost === null && parsed.usage.estimatedCostUsdMicros === null
            ? null
            : (audioCost ?? 0) + (parsed.usage.estimatedCostUsdMicros ?? 0),
      },
    };
  } catch (error) {
    if (timeout.signal.aborted && timeout.signal.reason === "timeout") {
      throw new AiProviderTimeoutError();
    }
    throw error;
  } finally {
    timeout.cleanup();
    // Best-effort wipe of the transient caller buffer after processing.
    request.audio?.bytes.fill(0);
    // No raw audio reference is copied into the result or telemetry contract.
  }
}
