import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dictationErrorMessage } from "./dictation";
import { buildDeepgramStreamingUrl } from "./deepgram-stream";

async function source(file: string) {
  return readFile(path.resolve(file), "utf8");
}

function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const TOKEN_DIAGNOSTICS = [
  "TOKEN_ROUTE_UNAUTHORIZED",
  "TOKEN_ROUTE_FORBIDDEN",
  "TOKEN_RATE_LIMIT",
  "TOKEN_CONFIG_MISSING",
  "TOKEN_GRANT_REJECTED",
  "TOKEN_GRANT_NETWORK",
] as const;

const CLIENT_DIAGNOSTICS = [
  "WS_CONNECTION",
  "AUDIO_CAPTURE",
  "FIRST_TRANSCRIPT_TIMEOUT",
] as const;

describe("Deepgram token-route connection boundary", () => {
  it("keeps the permanent key server-side and asks Deepgram for a five-minute pilot grant", async () => {
    const route = await source("src/app/api/voice/token/route.ts");
    expect(route).toContain("process.env.DEEPGRAM_API_KEY");
    expect(route).toContain('fetch("https://api.deepgram.com/v1/auth/grant"');
    expect(route).toContain("Authorization: `Token ${apiKey}`");
    expect(route).toContain("TOKEN_TTL_SECONDS = 300");
    expect(route).toContain("ttl_seconds: TOKEN_TTL_SECONDS");
    expect(route).not.toMatch(/NEXT_PUBLIC_DEEPGRAM/);
  });

  it("classifies each token failure without exposing the key or access token", async () => {
    const route = await source("src/app/api/voice/token/route.ts");
    for (const diagnostic of TOKEN_DIAGNOSTICS) expect(route).toContain(diagnostic);
    expect(route).toMatch(/TOKEN_CONFIG_MISSING/);
    expect(route).toMatch(/TOKEN_GRANT_REJECTED/);
    expect(route).toMatch(/TOKEN_GRANT_NETWORK/);
    expect(route).not.toMatch(/console\.(log|info|warn|error)/);
  });

  it("only exposes diagnostic details in Preview or Development", async () => {
    const route = await source("src/app/api/voice/token/route.ts");
    expect(route).toContain('process.env.VERCEL_ENV === "preview"');
    expect(route).toContain('process.env.NODE_ENV === "development"');
    expect(route).toMatch(/qa && diagnostic \? \{ \.\.\.body, diagnostic, \.\.\.qaDetails \} : body/);
  });

  it("preserves the public HTTP failure contract", async () => {
    const route = await source("src/app/api/voice/token/route.ts");
    expect(route).toMatch(/\{ code: "unauthorized" \}, 401, "TOKEN_ROUTE_UNAUTHORIZED"/);
    expect(route).toMatch(/\{ code: "forbidden" \}, 403, "TOKEN_ROUTE_FORBIDDEN"/);
    expect(route).toMatch(/\{ code: "rate-limited" \}, 429, "TOKEN_RATE_LIMIT"/);
    expect(route).toMatch(/\{ code: "provider-unavailable" \}, 503, "TOKEN_CONFIG_MISSING"/);
    expect(route).toMatch(/unavailable \? 503 : 502/);
  });

  it("never accepts audio, transcript or clinical identifiers", async () => {
    const route = codeOnly(await source("src/app/api/voice/token/route.ts"));
    expect(route).not.toMatch(/formData\(|MediaRecorder|Blob|transcript/);
    expect(route).not.toMatch(/patientId|encounterId|prescriptionId|fieldName/);
    expect(route).not.toMatch(/supabase|\.rpc\(|insert\(|update\(/);
  });
});

describe("Deepgram browser-side connection diagnosis", () => {
  it("keeps English and Bangla on Nova-3 with the intended provider language codes", () => {
    expect(new URL(buildDeepgramStreamingUrl("en-US")).searchParams.get("language")).toBe("en-US");
    expect(new URL(buildDeepgramStreamingUrl("bn")).searchParams.get("language")).toBe("bn");
    expect(() => buildDeepgramStreamingUrl("bn-BD")).toThrow();
    expect(() => buildDeepgramStreamingUrl("multi")).toThrow();
  });

  it("keeps Browser Bengali fallback at bn-BD", async () => {
    const language = await source("src/features/dictation/voice-language.tsx");
    expect(language).toMatch(/id: "deepgram", label: "Deepgram", providerLanguage: "bn"/);
    expect(language).toMatch(/id: "browser", label: "Browser fallback", providerLanguage: "bn-BD"/);
    expect(language).toMatch(/id: "deepgram", label: "Deepgram", providerLanguage: "en-US"/);
  });

  it("classifies WebSocket, audio capture and first-transcript timeout only after a healthy QA token", async () => {
    const provider = await source("src/features/dictation/provider.ts");
    for (const diagnostic of [...TOKEN_DIAGNOSTICS, ...CLIENT_DIAGNOSTICS]) {
      expect(provider).toContain(diagnostic);
    }
    expect(provider).toContain("qaDiagnostics = grant.qaDiagnostics");
    expect(provider).toContain('qaCode("WS_CONNECTION"');
    expect(provider).toContain('qaCode("AUDIO_CAPTURE"');
    expect(provider).toContain('qaCode("FIRST_TRANSCRIPT_TIMEOUT"');
  });

  it("lets the server timeout return its diagnostic before the client aborts", async () => {
    const route = await source("src/app/api/voice/token/route.ts");
    const provider = await source("src/features/dictation/provider.ts");
    expect(route).toContain("setTimeout(() => controller.abort(), 5000)");
    expect(provider).toContain("const TOKEN_ROUTE_TIMEOUT_MS = 6500");
  });

  it("keeps the architecture browser → token route → direct Deepgram WebSocket", async () => {
    const provider = codeOnly(await source("src/features/dictation/provider.ts"));
    const cache = codeOnly(await source("src/features/dictation/deepgram-token-cache.ts"));
    expect(cache).toMatch(/fetchImpl\("\/api\/voice\/token"/);
    expect(provider).toMatch(/new WebSocket/);
    expect(provider).toMatch(/socket\.send\(event\.data\)|ws\.send\(event\.data\)/);
    expect(provider).not.toMatch(/\/api\/voice\/transcribe|FormData|new Blob/);
    expect(provider).not.toMatch(/DEEPGRAM_API_KEY|NEXT_PUBLIC_DEEPGRAM/);
    expect(cache).not.toMatch(/DEEPGRAM_API_KEY|NEXT_PUBLIC_DEEPGRAM/);
  });

  it("starts microphone acquisition and token acquisition concurrently", async () => {
    const provider = await source("src/features/dictation/provider.ts");
    const micAt = provider.indexOf("const microphonePromise");
    const tokenAt = provider.indexOf("const tokenPromise = requestToken(false)");
    const waitAt = provider.indexOf("Promise.all([microphonePromise, tokenPromise])");
    expect(micAt).toBeGreaterThan(0);
    expect(tokenAt).toBeGreaterThan(micAt);
    expect(waitAt).toBeGreaterThan(tokenAt);
  });

  it("starts first-transcript timeout from provider SpeechStarted, not the first audio chunk", async () => {
    const provider = await source("src/features/dictation/provider.ts");
    const firstAudioBlock = provider.slice(
      provider.indexOf("latency.firstAudioSentMs"),
      provider.indexOf("recorder.onerror"),
    );
    expect(firstAudioBlock).not.toContain("FIRST_TRANSCRIPT_TIMEOUT");
    expect(provider).toMatch(/message\.type === "SpeechStarted"[\s\S]*FIRST_TRANSCRIPT_TIMEOUT/);
  });
});

describe("QA diagnostics are safe and draft-preserving", () => {
  it("all requested failure categories retain simple draft-preserving user wording", () => {
    for (const code of [...TOKEN_DIAGNOSTICS, ...CLIENT_DIAGNOSTICS]) {
      expect(dictationErrorMessage(code), code).toMatch(/preserv|microphone audio/i);
    }
  });

  it("exposes only the allowlisted QA code on the voice control", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    for (const diagnostic of [...TOKEN_DIAGNOSTICS, ...CLIENT_DIAGNOSTICS]) {
      expect(hook).toContain(diagnostic);
    }
    expect(button).toContain("data-voice-diagnostic");
    expect(button).toContain("data-voice-qa-diagnostic");
    expect(button).toContain("QA: {diagnosticCode}");
  });

  it("preserves one active field and stale-run protections", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    expect(hook).toContain("let activeVoiceLease");
    expect(hook).toContain("activeVoiceLease.cancel()");
    expect(hook).toContain("activeRun.current += 1");
    expect((hook.match(/activeRun\.current !== runId \|\| ended/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("adds no clinical authority to the voice layer", async () => {
    for (const file of [
      "src/app/api/voice/token/route.ts",
      "src/features/dictation/provider.ts",
      "src/features/dictation/deepgram-token-cache.ts",
      "src/features/dictation/use-dictation.ts",
      "src/features/dictation/components/dictate-button.tsx",
    ]) {
      const src = codeOnly(await source(file));
      expect(src).not.toMatch(/finalizePrescription|finishConsultation|finish_consultation/i);
      expect(src).not.toMatch(/addMedicine|addDiagnosis|addInvestigation/i);
      expect(src).not.toMatch(/expectedVersion|compareAndSwap|\.rpc\(/i);
    }
  });
});
