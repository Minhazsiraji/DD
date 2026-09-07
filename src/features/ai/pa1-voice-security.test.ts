import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createClinicalProposal } from "./orchestrator";
import { MockProposalParser, MockSpeechProvider } from "./mock-provider";

const binding = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  doctorProfileId: "22222222-2222-4222-8222-222222222222",
  practiceLocationId: "33333333-3333-4333-8333-333333333333",
  patientId: "44444444-4444-4444-8444-444444444444",
  clinicalRecordId: "55555555-5555-4555-8555-555555555555",
  expectedVersion: 7,
};

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

describe("PA1 voice and secret containment", () => {
  it("runs English voice through transient STT -> proposal only", async () => {
    const transcript = "Napa five hundred, one tablet twice daily after food five days.";
    const result = await createClinicalProposal(
      {
        operationId: "op-voice-english",
        taskType: "PRESCRIPTION_MEDICINE",
        binding,
        audio: { bytes: new Uint8Array([7, 8, 9]), mimeType: "audio/webm" },
      },
      {
        speech: new MockSpeechProvider(transcript, "en", 0.95),
        parser: new MockProposalParser(englishProposal),
        now: () => new Date("2026-09-07T10:00:00Z"),
      },
    );
    expect(result.envelope.source).toBe("VOICE_TRANSCRIPT");
    expect(result.envelope.proposal.kind).toBe("PRESCRIPTION_MEDICINE");
    expect(JSON.stringify(result.envelope)).not.toContain(transcript);
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
        languageHints: ["bn-BD", "en"],
        audio: { bytes: new Uint8Array([4, 5, 6]), mimeType: "audio/webm" },
      },
      {
        speech: new MockSpeechProvider(transcript, "bn-en", 0.9),
        parser: new MockProposalParser(mixedProposal),
        now: () => new Date("2026-09-07T10:00:00Z"),
      },
    );
    if (result.envelope.proposal.kind !== "PRESCRIPTION_MEDICINE") throw new Error("wrong type");
    expect(result.envelope.proposal.medicine.display_name).toBe("Napa");
    expect(result.envelope.proposal.medicine.dose_text).toBe("এক ট্যাবলেট");
    expect(result.transcriptMeta?.language).toBe("bn-en");
  });

  it("contains no service-role or browser-exposed provider secret path", () => {
    const productionFiles = [
      "./contracts.ts",
      "./providers.ts",
      "./acceptance.ts",
      "./telemetry.ts",
      "./orchestrator.ts",
      "./mock-provider.ts",
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
  });
});
