import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHmacProposalIntegrity } from "./integrity";
import { createClinicalProposal } from "./orchestrator";
import { MockProposalParser } from "./mock-provider";

const binding = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  doctorProfileId: "22222222-2222-4222-8222-222222222222",
  practiceLocationId: "33333333-3333-4333-8333-333333333333",
  patientId: "44444444-4444-4444-8444-444444444444",
  clinicalRecordId: "55555555-5555-4555-8555-555555555555",
  expectedVersion: 7,
};

const integrity = createHmacProposalIntegrity(
  "pa1-c1-voice-test-signing-secret-32-bytes-minimum",
);

const englishProposal = {
  kind: "PRESCRIPTION_MEDICINE",
  medicine: {
    display_name: "Napa",
    strength_text: "500 mg",
    dose_text: "1 tablet",
    schedule_text: "twice daily",
    duration_text: "5 days",
    food_relation: "after food",
  },
  uncertainties: [],
  requires_review: true,
} as const;

function deepgramTranscript(text: string, language: string) {
  return {
    text,
    provider: { provider: "deepgram", model: "nova-3" },
    language,
    confidence: null,
    usage: { audioSeconds: 4 },
  };
}

describe("PA1 voice and secret containment", () => {
  it("runs an existing Deepgram English transcript through proposal-only orchestration", async () => {
    const transcript = "Napa five hundred, one tablet twice daily after food five days.";
    const result = await createClinicalProposal(
      {
        operationId: "op-voice-english",
        taskType: "PRESCRIPTION_MEDICINE",
        binding,
        voiceTranscript: deepgramTranscript(transcript, "en-US"),
      },
      {
        parser: new MockProposalParser(englishProposal),
        integrity,
        now: () => new Date("2026-09-07T10:00:00Z"),
      },
    );
    expect(result.envelope.source).toBe("VOICE_TRANSCRIPT");
    expect(result.envelope.proposal.kind).toBe("PRESCRIPTION_MEDICINE");
    expect(JSON.stringify(result.envelope)).not.toContain(transcript);
    expect(result.transcriptMeta?.provider).toBe("deepgram");
    expect(result.transcriptMeta?.model).toBe("nova-3");
    expect(result.securityHandle).not.toContain(transcript);
  });

  it("preserves mixed Bangla-English medical wording", async () => {
    const transcript = "Napa five hundred, এক ট্যাবলেট দিনে দুইবার after food five days";
    const mixedProposal = {
      kind: "PRESCRIPTION_MEDICINE",
      medicine: {
        display_name: "Napa",
        strength_text: "500 mg",
        dose_text: "এক ট্যাবলেট",
        schedule_text: "দিনে দুইবার",
        duration_text: "5 days",
        food_relation: "after food",
      },
      uncertainties: [],
      requires_review: true,
    } as const;
    const result = await createClinicalProposal(
      {
        operationId: "op-voice-mixed",
        taskType: "PRESCRIPTION_MEDICINE",
        binding,
        languageHints: ["bn", "en-US"],
        voiceTranscript: deepgramTranscript(transcript, "bn"),
      },
      {
        parser: new MockProposalParser(mixedProposal),
        integrity,
        now: () => new Date("2026-09-07T10:00:00Z"),
      },
    );
    if (result.envelope.proposal.kind !== "PRESCRIPTION_MEDICINE") throw new Error("wrong type");
    expect(result.envelope.proposal.medicine.display_name).toBe("Napa");
    expect(result.envelope.proposal.medicine.dose_text).toBe("এক ট্যাবলেট");
    expect(result.transcriptMeta?.language).toBe("bn");
  });

  it("contains no duplicate STT implementation inside the PA1 proposal layer", () => {
    const productionFiles = [
      "./contracts.ts",
      "./providers.ts",
      "./acceptance.ts",
      "./integrity.ts",
      "./telemetry.ts",
      "./orchestrator.ts",
      "./mock-provider.ts",
      "./openai-terra-provider.ts",
      // O1-E telemetry and cost accounting: the same containment applies.
      "./money.ts",
      "./pricing.ts",
      "./telemetry-events.ts",
      "./telemetry-allowlist.ts",
      "./telemetry-validation.ts",
      "./telemetry-privacy.ts",
      "./telemetry-builders.ts",
      "./telemetry-voice.ts",
      "./telemetry-sink.ts",
      "./proposal-decision.ts",
      "./owner-projection.ts",
    ];
    const source = productionFiles
      .map((file) => readFileSync(new URL(file, import.meta.url), "utf8"))
      .join("\n");
    expect(source).toContain('import "server-only";');
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("serviceRoleKey");
    expect(source).not.toContain("NEXT_PUBLIC_OPENAI");
    expect(source).not.toContain("NEXT_PUBLIC_DEEPGRAM");
    expect(source).not.toContain("NEXT_PUBLIC_GOOGLE");
    expect(source).not.toContain("SpeechProvider");
    expect(source).not.toContain("audio.bytes");
    expect(source).not.toContain("new MediaRecorder");
    expect(source).not.toContain("new WebSocket");
    expect(source).not.toContain("/api/voice/transcribe");
  });
});
