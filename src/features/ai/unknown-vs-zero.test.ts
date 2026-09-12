import { describe, expect, it } from "vitest";
import { createHmacProposalIntegrity } from "./integrity";
import { MockProposalParser } from "./mock-provider";
import {
  formatUsdForDisplay,
  picousdToMinorDecimal,
  sumOrUnknown,
} from "./money";
import { createClinicalProposal } from "./orchestrator";
import { projectOwnerAggregates, sumOwnerCostMinor, type OwnerAggregateRow } from "./owner-projection";
import { costForTokenUsage, createPricingBook, type PricingSnapshot } from "./pricing";
import { NOT_DISPATCHED_USAGE, UNKNOWN_USAGE, reportedUsage, type ProviderUsageReport } from "./providers";
import {
  buildOperationStarted,
  buildProviderAttempted,
  buildProviderOutcome,
  buildVoiceGrant,
  buildVoiceSessionReported,
  mintTelemetryOperationId,
  mintVoiceGrantId,
  type AiTelemetryEvent,
} from "./telemetry";
import { InMemoryAiTelemetrySink } from "./telemetry-sink";

/**
 * EXACT UNKNOWN-VS-ZERO REGRESSION PROOF (O1-E-R3).
 *
 *   known zero        = 0
 *   positive sub-cent = the exact positive value
 *   unknown           = NULL
 *   a partial known sum is never reported as complete
 *
 * Each case names the frozen-PA1 defect it pins. Run against PA1 107a1243 the
 * C1, C4 and ORCH cases fail; on this branch they pass.
 */

const DOCTOR = "22222222-2222-4222-8222-222222222222";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const principal = { actorUserId: ACTOR, doctorProfileId: DOCTOR };
const binding = {
  actorUserId: ACTOR,
  doctorProfileId: DOCTOR,
  practiceLocationId: "33333333-3333-4333-8333-333333333333",
  patientId: "44444444-4444-4444-8444-444444444444",
  clinicalRecordId: "55555555-5555-4555-8555-555555555555",
  expectedVersion: 1,
};
const validRx = {
  kind: "PRESCRIPTION_MEDICINE",
  medicine: { display_name: "Napa" },
  uncertainties: [],
  requires_review: true,
} as const;

const SNAPSHOT: PricingSnapshot = {
  id: "illustrative-2026-09",
  providerId: "openai",
  modelId: "gpt-5.6-terra",
  capturedAt: "2026-01-01T00:00:00.000Z",
  sourceRef: "test fixture",
  unitPriceUsdMicros: {
    INPUT_TOKENS: BigInt(250_000),
    CACHED_INPUT_TOKENS: BigInt(25_000),
    OUTPUT_TOKENS: BigInt(2_500_000),
  },
};

/** One provider call on 2026-09-11 (Dhaka), as the orchestrator would record it. */
function call(usage: ProviderUsageReport, hourUtc: number, type: "AI_PROVIDER_SUCCEEDED" | "AI_PROVIDER_TIMEOUT" = "AI_PROVIDER_SUCCEEDED"): AiTelemetryEvent[] {
  const operationId = mintTelemetryOperationId();
  const at = new Date(Date.UTC(2026, 8, 11, hourUtc));
  const common = {
    principal,
    operationId,
    providerId: "openai",
    modelId: "gpt-5.6-terra",
    taskType: "PRESCRIPTION_MEDICINE" as const,
  };
  return [
    buildOperationStarted({ ...common, occurredAt: at, source: "TEXT" }),
    buildProviderAttempted({ ...common, occurredAt: at, attemptNo: 1 }),
    buildProviderOutcome({
      ...common,
      type,
      occurredAt: at,
      attemptNo: 1,
      latencyMs: 1,
      failureCode: type === "AI_PROVIDER_TIMEOUT" ? "PROVIDER_TIMEOUT" : null,
      httpStatus: null,
      usage,
      cost: costForTokenUsage(usage, SNAPSHOT),
    }),
  ];
}

const row = (rows: OwnerAggregateRow[], unit: string) => rows.find((r) => r.unit === unit)!;
const project = (events: AiTelemetryEvent[]) =>
  projectOwnerAggregates(events, { timeZone: "Asia/Dhaka", principalOfActor: () => DOCTOR });

describe("C1 — mock-provider.ts:25 no longer fabricates a zero", () => {
  it("reports unknown consumption by default, not an authoritative 0", async () => {
    const parsed = await new MockProposalParser(validRx).parse(
      { taskType: "PRESCRIPTION_MEDICINE", authoredText: "x", jsonSchema: {} },
      new AbortController().signal,
    );
    expect(parsed.usage.state).toBe("UNKNOWN_PENDING_RECONCILIATION");
    expect(parsed.usage.tokens.inputTokens).toBeNull();
    expect(parsed.usage.tokens.outputTokens).toBeNull();
    expect(JSON.stringify(parsed.usage)).not.toMatch(/:0[,}]/);
  });
});

describe("ORCH — orchestrator.ts:217–220 no longer reports a partial sum as the whole", () => {
  it("returns NULL cost when the provider did not report usage", async () => {
    const result = await createClinicalProposal(
      {
        operationId: "op-voice",
        taskType: "PRESCRIPTION_MEDICINE",
        binding,
        voiceTranscript: {
          text: "Napa five hundred",
          provider: { provider: "deepgram", model: "nova-3" },
          language: "en-US",
          confidence: null,
          usage: { audioSeconds: 4 },
        },
      },
      {
        parser: new MockProposalParser(validRx),
        integrity: createHmacProposalIntegrity("o1e-test-signing-secret-32-bytes-minimum-2026"),
        telemetry: { sink: new InMemoryAiTelemetrySink() },
      },
    );
    expect(result.usage.estimatedCostUsdMicros).toBeNull();
    expect(result.usage.costState).toBe("UNKNOWN_PENDING_RECONCILIATION");
  });
});

describe("C4 — telemetry.ts:115–119 fold no longer zero-fills unknowns", () => {
  it("one unknown contributor makes the whole sum unknown", () => {
    expect(sumOrUnknown([BigInt(300_000_000), null])).toBeNull();
    expect(sumOrUnknown([BigInt(300_000_000), BigInt(0)])).toBe(BigInt(300_000_000));
  });

  it("an aggregate containing a timed-out call has a NULL cost, not the known part", () => {
    const rows = project([...call(reportedUsage({ inputTokens: 1000, cachedInputTokens: 200, outputTokens: 38 }), 4), ...call(UNKNOWN_USAGE, 5, "AI_PROVIDER_TIMEOUT")]);
    expect(row(rows, "OUTPUT_TOKENS").estimated_cost_minor).toBeNull();
    expect(sumOwnerCostMinor(rows)).toBeNull();
  });
});

describe("Known zero stays exactly 0", () => {
  it("a call that never reached the provider costs an authoritative zero", () => {
    const cost = costForTokenUsage(NOT_DISPATCHED_USAGE, SNAPSHOT);
    expect(cost.state).toBe("NOT_INCURRED");
    expect(cost.total).toBe(BigInt(0));
  });

  it("count rows carry an authoritative zero, not NULL", () => {
    const rows = project(call(reportedUsage({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 }), 4));
    expect(row(rows, "OPERATIONS").estimated_cost_minor).toBe("0.0000000000");
    expect(row(rows, "PROVIDER_CALLS").estimated_cost_minor).toBe("0.0000000000");
  });

  it("displays a known zero as $0.00 and an unknown as Unknown", () => {
    expect(formatUsdForDisplay("0.0000000000")).toBe("$0.00");
    expect(formatUsdForDisplay(null)).toBe("Unknown");
  });
});

describe("Positive sub-cent stays the exact positive value — O1-E-R3 worked example", () => {
  const rows = project(
    call(reportedUsage({ inputTokens: 1000, cachedInputTokens: 200, outputTokens: 38, reasoningTokens: 18 }), 4),
  );

  it("emits exact fractional minor units per disjoint meter", () => {
    expect(row(rows, "INPUT_TOKENS")).toMatchObject({ quantity_total: 800, estimated_cost_minor: "0.0200000000" });
    expect(row(rows, "CACHED_INPUT_TOKENS")).toMatchObject({ quantity_total: 200, estimated_cost_minor: "0.0005000000" });
    expect(row(rows, "OUTPUT_TOKENS")).toMatchObject({ quantity_total: 38, estimated_cost_minor: "0.0095000000" });
  });

  it("sums to exactly 0.03 minor = 300 micros — not 0, and not 1", () => {
    expect(sumOwnerCostMinor(rows)).toBe("0.0300000000");
    expect(sumOwnerCostMinor(rows)).toBe(picousdToMinorDecimal(BigInt(300_000_000)));
  });

  it("never lets reasoning tokens cross the boundary", () => {
    expect(rows.some((r) => (r.unit as string) === "REASONING_TOKENS")).toBe(false);
  });

  it("renders <$0.01 — never $0.00 and never $0.01", () => {
    expect(formatUsdForDisplay("0.0300000000")).toBe("<$0.01");
    expect(formatUsdForDisplay("0.0000000001")).toBe("<$0.01");
    expect(formatUsdForDisplay("0.9999999999")).toBe("<$0.01");
    expect(formatUsdForDisplay("1.0000000000")).toBe("$0.01");
  });

  it("1,000 such calls aggregate exactly to $0.30", () => {
    const many = Array.from({ length: 1000 }, () =>
      call(reportedUsage({ inputTokens: 1000, cachedInputTokens: 200, outputTokens: 38 }), 4),
    ).flat();
    expect(sumOwnerCostMinor(project(many))).toBe("30.0000000000");
    expect(formatUsdForDisplay("30.0000000000")).toBe("$0.30");
  });
});

describe("Partial known sum is never reported as complete — O1-E-R3 mixed example", () => {
  const rows = project([
    ...call(reportedUsage({ inputTokens: 1000, cachedInputTokens: 200, outputTokens: 38 }), 4), // A: 300 µ$
    ...call(reportedUsage({ inputTokens: 1600, cachedInputTokens: 0, outputTokens: 76 }), 5), //   B: 590 µ$
    ...call(UNKNOWN_USAGE, 6, "AI_PROVIDER_TIMEOUT"), //                                            C: unknown
  ]);

  it("NULLs every billable bucket the unknown call contributes to", () => {
    for (const unit of ["INPUT_TOKENS", "CACHED_INPUT_TOKENS", "OUTPUT_TOKENS"]) {
      expect(row(rows, unit).estimated_cost_minor).toBeNull();
    }
  });

  it("keeps event_count truthful — all three contributors", () => {
    expect(row(rows, "INPUT_TOKENS").event_count).toBe(3);
  });

  it("NULLs quantity too — a known subset is not a total", () => {
    expect(row(rows, "INPUT_TOKENS").quantity_total).toBeNull();
    expect(row(rows, "CACHED_INPUT_TOKENS").quantity_total).toBeNull();
    expect(row(rows, "OUTPUT_TOKENS").quantity_total).toBeNull();
  });

  it("keeps fully-known count rows with a real 0 cost", () => {
    expect(row(rows, "PROVIDER_CALLS")).toMatchObject({ quantity_total: 3, estimated_cost_minor: "0.0000000000" });
  });

  it("a bucket with NO known quantity reports NULL quantity, not 0", () => {
    const only = project(call(UNKNOWN_USAGE, 6, "AI_PROVIDER_TIMEOUT"));
    expect(row(only, "OUTPUT_TOKENS")).toMatchObject({ quantity_total: null, estimated_cost_minor: null, event_count: 1 });
  });
});

describe("Quantity completeness — a known subset is never published as a total", () => {
  const out = (n: number) => reportedUsage({ inputTokens: 0, cachedInputTokens: 0, outputTokens: n });

  it("all quantities known: the exact sum is emitted", () => {
    const rows = project([...call(out(100), 4), ...call(out(200), 5)]);
    expect(row(rows, "OUTPUT_TOKENS")).toMatchObject({ quantity_total: 300, event_count: 2 });
  });

  it("one unknown among knowns: 100, 200, UNKNOWN -> event_count 3, quantity NULL (never 300)", () => {
    const rows = project([
      ...call(out(100), 4),
      ...call(out(200), 5),
      ...call(UNKNOWN_USAGE, 6, "AI_PROVIDER_TIMEOUT"),
    ]);
    expect(row(rows, "OUTPUT_TOKENS")).toMatchObject({ quantity_total: null, event_count: 3 });
    expect(row(rows, "OUTPUT_TOKENS").quantity_total).not.toBe(300);
  });

  it("all unknown: quantity NULL", () => {
    const rows = project([
      ...call(UNKNOWN_USAGE, 4, "AI_PROVIDER_TIMEOUT"),
      ...call(UNKNOWN_USAGE, 5, "AI_PROVIDER_TIMEOUT"),
    ]);
    expect(row(rows, "OUTPUT_TOKENS")).toMatchObject({ quantity_total: null, event_count: 2 });
  });

  it("known authoritative zero stays 0, and is not confused with unknown", () => {
    const rows = project(call(out(0), 4));
    expect(row(rows, "OUTPUT_TOKENS")).toMatchObject({ quantity_total: 0, event_count: 1 });
    expect(row(rows, "OUTPUT_TOKENS").quantity_total).not.toBeNull();
  });

  it("positive quantity plus one unknown contributor: quantity NULL and cost NULL", () => {
    const rows = project([...call(out(500), 4), ...call(UNKNOWN_USAGE, 5, "AI_PROVIDER_TIMEOUT")]);
    expect(row(rows, "OUTPUT_TOKENS")).toMatchObject({
      quantity_total: null,
      estimated_cost_minor: null,
      event_count: 2,
    });
  });

  it("count rows stay known — they are complete by construction", () => {
    const rows = project([...call(out(100), 4), ...call(UNKNOWN_USAGE, 5, "AI_PROVIDER_TIMEOUT")]);
    expect(row(rows, "PROVIDER_CALLS")).toMatchObject({ quantity_total: 2, estimated_cost_minor: "0.0000000000" });
    expect(row(rows, "OPERATIONS").quantity_total).toBe(2);
  });
});

describe("Voice — an unmeasured session is unknown, never zero", () => {
  const at = new Date("2026-09-11T04:00:00Z");
  const audioSnapshot = createPricingBook([
    { ...SNAPSHOT, providerId: "deepgram", modelId: "nova-3", unitPriceUsdMicros: { AUDIO_SECONDS: BigInt(77) } },
  ]).snapshotFor("deepgram", "nova-3", at);

  const grant = () => {
    const grantId = mintVoiceGrantId();
    return { grantId, event: buildVoiceGrant({ occurredAt: at, actorUserId: ACTOR, grantId, denialReason: null }) };
  };
  const session = (grantId: string, ms: number, actorUserId = ACTOR, occurredAt = at) =>
    buildVoiceSessionReported({
      occurredAt,
      actorUserId,
      beacon: {
        voiceSessionId: `ddvs_${crypto.randomUUID()}`,
        grantId,
        streamedAudioMs: ms,
        connectLatencyMs: null,
        firstResultLatencyMs: null,
      },
      cost: { state: "ESTIMATED", source: "PRICING_SNAPSHOT", mode: "ALLOCATED", pricingSnapshotId: audioSnapshot!.id, total: BigInt(ms) * BigInt(77) * BigInt(1000) },
    });

  it("a measured day is exact", () => {
    const a = grant();
    const rows = project([a.event, session(a.grantId, 2000)]);
    expect(row(rows, "AUDIO_MILLIS")).toMatchObject({ quantity_total: 2000, event_count: 1, estimated_cost_minor: "0.0154000000" });
  });

  describe("a grant id is correlation, never authority", () => {
    const OTHER_USER = "88888888-8888-4888-8888-888888888888";
    const earlier = new Date("2026-09-11T03:59:00Z");

    it("another user's report naming the grant cannot change the holder's figures — even arriving first", () => {
      const a = grant();
      const rows = project([
        a.event,
        session(a.grantId, 999_999, OTHER_USER, earlier), // leaked id, forged, earliest
        session(a.grantId, 2000), //                          the holder's genuine report
      ]);
      expect(row(rows, "AUDIO_MILLIS")).toMatchObject({ quantity_total: 2000, event_count: 1, estimated_cost_minor: "0.0154000000" });
    });

    it("a leaked grant with no genuine report reads as unknown, never as the forger's number", () => {
      const a = grant();
      const rows = project([a.event, session(a.grantId, 999_999, OTHER_USER)]);
      expect(row(rows, "AUDIO_MILLIS")).toMatchObject({ quantity_total: null, estimated_cost_minor: null });
    });

    it("a report naming no server-issued grant is not counted at all", () => {
      const rows = project([session(mintVoiceGrantId(), 60_000)]);
      expect(rows.some((r) => r.unit === "AUDIO_MILLIS")).toBe(false);
    });

    it("a report naming a DENIED grant is not counted — a denial issues no grant", () => {
      const grantId = mintVoiceGrantId();
      const denied = buildVoiceGrant({
        occurredAt: at,
        actorUserId: ACTOR,
        grantId,
        denialReason: "RATE_LIMITED",
      });
      const rows = project([denied, session(grantId, 45_000)]);
      expect(rows.some((r) => r.unit === "AUDIO_MILLIS")).toBe(false);
    });

    it("only the accepted report for a grant contributes — a duplicate adds nothing", () => {
      const a = grant();
      const rows = project([
        a.event,
        session(a.grantId, 2000),
        session(a.grantId, 5000, ACTOR, new Date("2026-09-11T04:05:00Z")),
      ]);
      expect(row(rows, "AUDIO_MILLIS")).toMatchObject({
        quantity_total: 2000,
        event_count: 1,
        estimated_cost_minor: "0.0154000000",
      });
    });
  });

  it("one grant with no report NULLs the day's audio quantity and cost", () => {
    const a = grant();
    const b = grant();
    const rows = project([a.event, session(a.grantId, 2000), b.event]);
    expect(row(rows, "AUDIO_MILLIS")).toMatchObject({ quantity_total: null, event_count: 2, estimated_cost_minor: null });
    expect(row(rows, "VOICE_GRANTS")).toMatchObject({ quantity_total: 2 });
  });
});
