import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("Deepgram selective reconciliation security locks", () => {
  it("keeps the permanent Deepgram credential on the server grant route", () => {
    const route = source("../../app/api/voice/token/route.ts");
    expect(route).toContain('import "server-only";');
    expect(route).toContain('process.env.DEEPGRAM_API_KEY');
    expect(route).toContain('requirePermission("update", "encounter")');
    expect(route).toContain('origin !== request.nextUrl.origin');
    expect(route).toContain('https://api.deepgram.com/v1/auth/grant');
    expect(route).toContain('TOKEN_TTL_SECONDS = 30');
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(route).not.toContain("NEXT_PUBLIC_DEEPGRAM");
    expect(route).not.toContain("patientId");
    expect(route).not.toContain("patient_id");
    expect(route).not.toContain("encounterId");
    expect(route).not.toContain("prescriptionId");
    expect(route).not.toContain("request.json(");
    expect(route).not.toContain("/api/voice/transcribe");
    expect(route).not.toContain("supabase");
  });

  it("browser transport requests only the temporary token route", () => {
    const provider = source("./provider.ts");
    expect(provider).toContain('fetch("/api/voice/token"');
    expect(provider).toContain("new WebSocket(");
    expect(provider).toContain("new MediaRecorder(");
    expect(provider).not.toContain("DEEPGRAM_API_KEY");
    expect(provider).not.toContain("OPENAI_API_KEY");
    expect(provider).not.toContain("/api/voice/transcribe");
    expect(provider).not.toContain("patientId");
    expect(provider).not.toContain("encounterId");
    expect(provider).not.toContain("prescriptionId");
    expect(provider).not.toContain("FINALIZE_PRESCRIPTION");
    expect(provider).not.toContain("CONFIRM_PRINT");
    expect(provider).not.toContain("START_CORRECTION");
  });

  it("has exactly one approved STT provider", () => {
    const provider = source("./provider.ts");
    const language = source("./voice-language.tsx");
    expect(provider).toContain('VOICE_TRANSCRIPTION_PROVIDER_IDS = ["deepgram"]');
    expect(provider).not.toContain('id: "browser"');
    expect(language).toContain("Deepgram Nova-3");
    expect(language).not.toContain("Browser fallback");
    expect(language).not.toContain("Engine:");
  });

  it("retains one active voice lease and stale-run isolation", () => {
    const hook = source("./use-dictation.ts");
    expect(hook).toContain("let activeVoiceLease");
    expect(hook).toContain("activeVoiceLease.cancel()");
    expect(hook).toContain("activeRun.current !== runId");
    expect(hook).toContain("current?.abort()");
    expect(hook).not.toContain("savePrescription");
    expect(hook).not.toContain("finalizePrescription");
    expect(hook).not.toContain("FINALIZE_PRESCRIPTION");
    expect(hook).not.toContain("confirmPrint");
    expect(hook).not.toContain("startCorrection");
    expect(hook).not.toContain("supabase");
  });

  it("keeps Dictate as draft-only and fully reversible on Discard", () => {
    const button = source("./components/dictate-button.tsx");
    expect(button).toContain("runBaseValue");
    expect(button).toContain("revertRunPreview");
    expect(button).toContain("Discard");
    expect(button).toContain('data-voice-provider="deepgram"');
    expect(button).not.toContain("savePrescription");
    expect(button).not.toContain("addMedicine");
    expect(button).not.toContain("confirmPrint");
    expect(button).not.toContain("startCorrection");
  });

  it("contains no voice transcript persistence or server transcript endpoint", () => {
    const route = source("../../app/api/voice/token/route.ts");
    const provider = source("./provider.ts");
    const hook = source("./use-dictation.ts");
    const combined = `${route}\n${provider}\n${hook}`;
    expect(combined).not.toContain("localStorage");
    expect(combined).not.toContain("sessionStorage");
    expect(combined).not.toContain("supabase.from");
    expect(combined).not.toContain("/api/voice/transcribe");
  });
});
