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
import { picousdToMicrosDecimal } from "./money";
import {
  costForTokenUsage,
  getAiPricingBook,
  type CostState,
  type PricingBook,
} from "./pricing";
import {
  UNKNOWN_USAGE,
  providerAttemptFacts,
  type ClinicalProposalParser,
  type ProviderUsageReport,
  type ProviderUsageState,
} from "./providers";
import {
  TELEMETRY_ID_PATTERNS,
  buildOperationStarted,
  buildProposalProduced,
  buildProviderAttempted,
  buildProviderOutcome,
  mintProposalId,
  mintTelemetryOperationId,
  toFailureCode,
  type AiFailureCode,
  type AiProviderOutcomeType,
  type TelemetryPrincipal,
} from "./telemetry";
import {
  emitAiTelemetry,
  getAiTelemetrySink,
  type AiTelemetrySink,
} from "./telemetry-sink";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_TTL_MS = 5 * 60_000;
const UNATTRIBUTED = "unattributed";

export interface VoiceTranscriptInput {
  /**
   * Transient transcript produced by DD's existing audited voice subsystem.
   * It is untrusted clinical input and is never copied into the proposal envelope.
   */
  text: string;
  provider: SafeProviderMetadata;
  language: string | null;
  confidence: number | null;
  /**
   * Informational only. Voice COST is accounted exactly once, on the voice
   * session's own telemetry, from the server-validated streaming report — never
   * here, where it would be caller-supplied and would be counted a second time
   * inside an AI operation's cost.
   */
  usage: {
    audioSeconds: number | null;
  };
}

export interface OrchestratorTelemetry {
  sink?: AiTelemetrySink;
  pricing?: PricingBook;
  /**
   * Telemetry correlation id, minted by `mintTelemetryOperationId()`. Supply
   * the same id with an incremented `attemptNo` when retrying one logical
   * operation, so a retry is counted as a call and never as a new operation.
   * Never derived from `ProposalRequest.operationId` or any record id.
   */
  operationId?: string;
  attemptNo?: number;
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
  /**
   * Summary of THIS operation's LLM consumption. Every component is null when
   * the provider did not report it. `estimatedCostUsdMicros` is exact (scale 6)
   * and null whenever any required component is unknown or unpriced — it is
   * never a partial sum presented as the whole.
   */
  usage: {
    audioSeconds: number | null;
    usageState: ProviderUsageState;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    totalTokens: number | null;
    costState: CostState;
    estimatedCostUsdMicros: string | null;
  };
  /** Random, namespaced, non-clinical. Needed to record the Doctor's decision. */
  telemetry: {
    operationId: string;
    proposalId: string;
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
    telemetry?: OrchestratorTelemetry;
  },
): Promise<ProposalRunResult> {
  if ((request.text ? 1 : 0) + (request.voiceTranscript ? 1 : 0) !== 1) {
    throw new Error("AI_INPUT_EXACTLY_ONE_SOURCE_REQUIRED");
  }

  const clock = deps.now ?? (() => new Date());
  const now = clock();

  // Input is validated before any telemetry: a request refused here never
  // reached a provider and is not an AI operation in the metering sense.
  let authoredText: string;
  let source: "TEXT" | "VOICE_TRANSCRIPT";
  let transcriptMeta: ProposalRunResult["transcriptMeta"] = null;
  let audioSeconds: number | null = null;
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
  } else {
    source = "TEXT";
    authoredText = requiredAuthoredText(request.text!);
  }

  // Telemetry wiring. Every id is minted here or supplied as a minted id;
  // nothing is taken from the request operationId or from the binding patient
  // or record ids. A malformed supplied id is replaced, never trusted, because
  // telemetry must not be able to break the clinical path.
  const sink = deps.telemetry?.sink ?? getAiTelemetrySink();
  const pricing = deps.telemetry?.pricing ?? getAiPricingBook();
  const suppliedId = deps.telemetry?.operationId;
  const operationId =
    suppliedId && TELEMETRY_ID_PATTERNS.operation.test(suppliedId)
      ? suppliedId
      : mintTelemetryOperationId();
  const suppliedAttempt = deps.telemetry?.attemptNo;
  const attemptNo =
    suppliedAttempt !== undefined &&
    Number.isSafeInteger(suppliedAttempt) &&
    suppliedAttempt >= 1 &&
    suppliedAttempt <= 100
      ? suppliedAttempt
      : 1;
  const providerId = deps.parser.descriptor?.provider ?? UNATTRIBUTED;
  const modelId = deps.parser.descriptor?.model ?? UNATTRIBUTED;
  const principal: TelemetryPrincipal = {
    actorUserId: request.binding.actorUserId,
    doctorProfileId: request.binding.doctorProfileId,
  };
  const attribution = {
    principal,
    operationId,
    providerId,
    modelId,
    taskType: request.taskType,
  };

  await emitAiTelemetry(sink, buildOperationStarted({ ...attribution, occurredAt: clock(), source }));
  const attemptStartedAt = clock();
  await emitAiTelemetry(
    sink,
    buildProviderAttempted({ ...attribution, occurredAt: attemptStartedAt, attemptNo }),
  );

  // Every exit below records exactly one outcome for this attempt: success,
  // failure and timeout alike, because a failed call can still be billed.
  const recordOutcome = async (
    type: AiProviderOutcomeType,
    failureCode: AiFailureCode | null,
    httpStatus: number | null,
    usage: ProviderUsageReport,
  ) => {
    const occurredAt = clock();
    const cost = costForTokenUsage(usage, pricing.snapshotFor(providerId, modelId, attemptStartedAt));
    await emitAiTelemetry(
      sink,
      buildProviderOutcome({
        ...attribution,
        type,
        occurredAt,
        attemptNo,
        latencyMs: occurredAt.getTime() - attemptStartedAt.getTime(),
        failureCode,
        httpStatus,
        usage,
        cost,
      }),
    );
    return cost;
  };

  const timeout = withTimeout(deps.signal, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let parsed: Awaited<ReturnType<ClinicalProposalParser["parse"]>>;
    try {
      parsed = await awaitWithAbort(
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
    } catch (error) {
      if (timeout.signal.aborted && timeout.signal.reason === "timeout") {
        // DD stopped waiting; the provider may not have stopped generating.
        // Consumption is unknown, and is recorded as unknown, never as zero.
        await recordOutcome("AI_PROVIDER_TIMEOUT", "PROVIDER_TIMEOUT", null, UNKNOWN_USAGE);
        throw new AiProviderTimeoutError();
      }
      const facts = providerAttemptFacts(error);
      await recordOutcome(
        "AI_PROVIDER_FAILED",
        facts
          ? toFailureCode(facts.failureCode)
          : timeout.signal.aborted
            ? "PROVIDER_ABORTED"
            : "PROVIDER_ERROR_UNCLASSIFIED",
        facts?.httpStatus ?? null,
        facts?.usage ?? UNKNOWN_USAGE,
      );
      throw error;
    }
    timeout.cleanup();

    let proposal: AiProposalPayload;
    try {
      proposal = validateProviderProposal(request.taskType, parsed.rawProposal) as AiProposalPayload;
    } catch (error) {
      // The provider answered, and may have billed; DD refused the answer.
      await recordOutcome("AI_PROVIDER_FAILED", "VALIDATION_REJECTED", null, parsed.usage);
      throw error;
    }

    let securityHandle: string;
    let createdAtIso: string;
    let expiresAtIso: string;
    try {
      const expiresAt = new Date(now.getTime() + (deps.ttlMs ?? DEFAULT_TTL_MS));
      createdAtIso = now.toISOString();
      expiresAtIso = expiresAt.toISOString();
      const integrity = deps.integrity ?? createProposalIntegrityFromEnv();
      securityHandle = integrity.issue({
        v: 1,
        operationId: request.operationId,
        taskType: proposal.kind,
        source,
        binding: { ...request.binding },
        createdAt: createdAtIso,
        expiresAt: expiresAtIso,
      });
    } catch (error) {
      await recordOutcome("AI_PROVIDER_FAILED", "POST_PROVIDER_INTERNAL", null, parsed.usage);
      throw error;
    }

    const cost = await recordOutcome("AI_PROVIDER_SUCCEEDED", null, null, parsed.usage);
    const proposalId = mintProposalId();
    const uncertainties = (proposal as { uncertainties?: unknown }).uncertainties;
    await emitAiTelemetry(
      sink,
      buildProposalProduced({
        ...attribution,
        occurredAt: clock(),
        proposalId,
        uncertaintyCount: Array.isArray(uncertainties) ? uncertainties.length : 0,
      }),
    );

    const reported = parsed.usage.state === "REPORTED";
    const tokens = parsed.usage.tokens;
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
        usageState: parsed.usage.state,
        inputTokens: reported ? tokens.inputTokens : null,
        cachedInputTokens: reported ? tokens.cachedInputTokens : null,
        outputTokens: reported ? tokens.outputTokens : null,
        reasoningTokens: reported ? tokens.reasoningTokens : null,
        totalTokens: reported ? tokens.totalTokens : null,
        costState: cost.state,
        // LLM cost only, exact, and NULL unless every required part is known.
        // Voice cost is never folded in here: it has exactly one home.
        estimatedCostUsdMicros: cost.total === null ? null : picousdToMicrosDecimal(cost.total),
      },
      telemetry: { operationId, proposalId },
    };
  } finally {
    timeout.cleanup();
  }
}
