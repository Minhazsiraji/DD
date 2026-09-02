import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEEPGRAM_BN_CLINICAL_KEYTERMS,
  DEEPGRAM_CONNECTION_TIMEOUT_MS,
  DEEPGRAM_FINALIZE_TIMEOUT_MS,
  DEEPGRAM_FIRST_TRANSCRIPT_TIMEOUT_MS,
  DEEPGRAM_MEDIA_TIMESLICE_MS,
  DeepgramTranscriptAssembler,
  buildDeepgramStreamingUrl,
  deepgramBearerProtocols,
} from "./deepgram-stream";
import {
  clearDeepgramAccessTokenCache,
  DEEPGRAM_TOKEN_REFRESH_SKEW_MS,
  getDeepgramAccessToken,
  peekDeepgramTokenCache,
} from "./deepgram-token-cache";

async function source(file: string) {
  return readFile(path.resolve(file), "utf8");
}

function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function result(start: number, transcript: string, isFinal: boolean, fromFinalize = false) {
  return {
    type: "Results" as const,
    start,
    is_final: isFinal,
    from_finalize: fromFinalize,
    channel: { alternatives: [{ transcript }] },
  };
}

describe("Deepgram cumulative streaming transcript", () => {
  it("emits useful interim text before Stop", () => {
    const a = new DeepgramTranscriptAssembler();
    expect(a.apply(result(0, "রোগীর তিন দিন", false))).toEqual({
      text: "রোগীর তিন দিন",
      isFinal: false,
    });
  });

  it("replaces interim with final for the same segment instead of duplicating words", () => {
    const a = new DeepgramTranscriptAssembler();
    a.apply(result(0, "রোগীর তিন", false));
    expect(a.apply(result(0, "রোগীর তিন দিন ধরে জ্বর", true))?.text).toBe(
      "রোগীর তিন দিন ধরে জ্বর",
    );
  });

  it("preserves finalized segments while a later interim evolves", () => {
    const a = new DeepgramTranscriptAssembler();
    a.apply(result(0, "রোগীর asthma আছে", true));
    expect(a.apply(result(2.5, "গত দুই দিন", false))?.text).toBe(
      "রোগীর asthma আছে গত দুই দিন",
    );
    expect(a.apply(result(2.5, "গত দুই দিন ধরে shortness of breath বেড়েছে।", true))?.text).toBe(
      "রোগীর asthma আছে গত দুই দিন ধরে shortness of breath বেড়েছে।",
    );
  });

  it("a corrected final with the same audio start replaces the previous final", () => {
    const a = new DeepgramTranscriptAssembler();
    a.apply(result(0, "Paracetamol five hundred", true));
    expect(a.apply(result(0, "Paracetamol five hundred milligram", true))?.text).toBe(
      "Paracetamol five hundred milligram",
    );
  });

  it("ignores empty provider events without erasing prior transcript", () => {
    const a = new DeepgramTranscriptAssembler();
    a.apply(result(0, "Fever for three days", true));
    expect(a.apply(result(3, "   ", false))).toBeNull();
    expect(a.current()).toBe("Fever for three days");
  });
});

describe("Deepgram live configuration", () => {
  it("maps Bangla to bn and English to en-US with Nova-3 live parameters", () => {
    for (const language of ["bn", "en-US"]) {
      const url = new URL(buildDeepgramStreamingUrl(language));
      expect(url.protocol).toBe("wss:");
      expect(url.hostname).toBe("api.deepgram.com");
      expect(url.pathname).toBe("/v1/listen");
      expect(url.searchParams.get("model")).toBe("nova-3");
      expect(url.searchParams.get("language")).toBe(language);
      expect(url.searchParams.get("interim_results")).toBe("true");
      expect(url.searchParams.get("endpointing")).toBe("300");
      expect(url.searchParams.get("utterance_end_ms")).toBe("1000");
      expect(url.searchParams.get("vad_events")).toBe("true");
      expect(url.searchParams.get("mip_opt_out")).toBe("true");
      expect(url.searchParams.has("encoding")).toBe(false);
      expect(url.searchParams.has("sample_rate")).toBe(false);
    }
  });

  it("keeps Bangla monolingual and adds only a bounded recognition-bias keyterm pilot", () => {
    const url = new URL(buildDeepgramStreamingUrl("bn"));
    expect(url.searchParams.get("language")).toBe("bn");
    expect(url.searchParams.getAll("keyterm")).toEqual([...DEEPGRAM_BN_CLINICAL_KEYTERMS]);
    expect(DEEPGRAM_BN_CLINICAL_KEYTERMS.length).toBeGreaterThan(0);
    expect(DEEPGRAM_BN_CLINICAL_KEYTERMS.length).toBeLessThanOrEqual(20);
    expect(url.searchParams.getAll("keyterm")).toContain("right knee");
    expect(url.searchParams.getAll("keyterm")).toContain("serum creatinine");
  });

  it("does not add Bangla pilot keyterms to English", () => {
    expect(new URL(buildDeepgramStreamingUrl("en-US")).searchParams.getAll("keyterm")).toEqual([]);
  });

  it("rejects arbitrary provider-language injection and unsupported multi mode", () => {
    expect(() => buildDeepgramStreamingUrl("bn&model=evil")).toThrow();
    expect(() => buildDeepgramStreamingUrl("multi")).toThrow();
  });

  it("uses Deepgram bearer-token WebSocket subprotocols", () => {
    expect(deepgramBearerProtocols("short-lived-token")).toEqual(["bearer", "short-lived-token"]);
  });

  it("keeps bounded connection, transcript and Stop-finalization timeouts", () => {
    expect(DEEPGRAM_CONNECTION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEEPGRAM_FIRST_TRANSCRIPT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEEPGRAM_FINALIZE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEEPGRAM_FINALIZE_TIMEOUT_MS).toBeLessThanOrEqual(2000);
    expect(DEEPGRAM_MEDIA_TIMESLICE_MS).toBeLessThanOrEqual(250);
  });
});

describe("short-lived Deepgram token cache", () => {
  beforeEach(() => clearDeepgramAccessTokenCache());

  it("reuses a healthy token from browser memory instead of requesting another grant", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ accessToken: "ephemeral", expiresIn: 300, qaDiagnostics: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const first = await getDeepgramAccessToken({ fetchImpl, now: () => now });
    expect(first.source).toBe("network");
    now += 10_000;
    const second = await getDeepgramAccessToken({ fetchImpl, now: () => now });
    expect(second.source).toBe("cache");
    expect(second.accessToken).toBe("ephemeral");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes before actual expiry rather than using an almost-expired token", async () => {
    let now = 2_000_000;
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return new Response(JSON.stringify({ accessToken: `ephemeral-${call}`, expiresIn: 300 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await getDeepgramAccessToken({ fetchImpl, now: () => now });
    now += 300_000 - DEEPGRAM_TOKEN_REFRESH_SKEW_MS + 1;
    const refreshed = await getDeepgramAccessToken({ fetchImpl, now: () => now });
    expect(refreshed.source).toBe("network");
    expect(refreshed.accessToken).toBe("ephemeral-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("supports explicit cache invalidation for a rejected cached credential", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ accessToken: "ephemeral", expiresIn: 300 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    await getDeepgramAccessToken({ fetchImpl });
    expect(peekDeepgramTokenCache().usable).toBe(true);
    clearDeepgramAccessTokenCache();
    expect(peekDeepgramTokenCache().usable).toBe(false);
  });

  it("contains no persistent browser storage, cookies or logging", async () => {
    const cache = codeOnly(await source("src/features/dictation/deepgram-token-cache.ts"));
    for (const forbidden of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "console.log",
      "console.info",
      "console.warn",
      "console.error",
    ]) {
      expect(cache.includes(forbidden), forbidden).toBe(false);
    }
    expect(cache).toContain('window.addEventListener("pagehide", clearDeepgramAccessTokenCache');
  });
});

describe("stream transport and credential security", () => {
  it("streams MediaRecorder chunks while speaking instead of waiting for a Blob upload", async () => {
    const provider = codeOnly(await source("src/features/dictation/provider.ts"));
    expect(provider).toMatch(/recorder\.start\(DEEPGRAM_MEDIA_TIMESLICE_MS\)/);
    expect(provider).toMatch(/(?:socket|ws)\.send\(event\.data\)/);
    expect(provider).toMatch(/new WebSocket/);
    expect(provider).toMatch(/deepgramBearerProtocols\(grant\.accessToken\)/);
    expect(provider).not.toMatch(/new Blob\(|new FormData\(|\/api\/voice\/transcribe/);
  });

  it("uses KeepAlive and explicit Finalize without restarting batch transcription", async () => {
    const provider = await source("src/features/dictation/provider.ts");
    expect(provider).toMatch(/type: "KeepAlive"/);
    expect(provider).toMatch(/type: "Finalize"/);
    expect(provider).toMatch(/DEEPGRAM_FINALIZE_TIMEOUT_MS/);
    expect(provider).not.toMatch(/transcribe\s*=\s*async/);
  });

  it("permanent provider key exists only in the server token route", async () => {
    const tokenRoute = await source("src/app/api/voice/token/route.ts");
    const provider = await source("src/features/dictation/provider.ts");
    const cache = await source("src/features/dictation/deepgram-token-cache.ts");
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    const language = await source("src/features/dictation/voice-language.tsx");
    expect(tokenRoute).toMatch(/process\.env\.DEEPGRAM_API_KEY/);
    for (const client of [provider, cache, button, language]) {
      expect(client).not.toMatch(/DEEPGRAM_API_KEY|NEXT_PUBLIC_DEEPGRAM/);
    }
  });

  it("authenticates before granting a 300-second token and fails closed on Origin", async () => {
    const raw = await source("src/app/api/voice/token/route.ts");
    const authAt = raw.indexOf('requirePermission("update", "encounter")');
    const keyAt = raw.indexOf("process.env.DEEPGRAM_API_KEY");
    const grantAt = raw.indexOf("https://api.deepgram.com/v1/auth/grant");
    expect(authAt).toBeGreaterThanOrEqual(0);
    expect(keyAt).toBeGreaterThan(authAt);
    expect(grantAt).toBeGreaterThan(keyAt);
    expect(raw).toMatch(/ttl_seconds: TOKEN_TTL_SECONDS/);
    expect(raw).toMatch(/TOKEN_TTL_SECONDS = 300/);
    expect(raw).toMatch(/if \(origin !== request\.nextUrl\.origin\)/);
    expect(raw).toMatch(/MAX_GRANTS_PER_WINDOW = 12/);
  });

  it("token route contains no audio, transcript, patient or clinical write path", async () => {
    const route = codeOnly(await source("src/app/api/voice/token/route.ts"));
    expect(route).not.toMatch(/formData\(|MediaRecorder|Blob|audio\.arrayBuffer|transcript/);
    expect(route).not.toMatch(/patientId|encounterId|prescriptionId|fieldName/);
    expect(route).not.toMatch(/supabase|\.rpc\(|\.from\(|insert\(|update\(/);
    expect(route).not.toMatch(/console\.(log|info|warn|error)/);
  });

  it("client streaming code persists and logs neither audio nor transcript", async () => {
    const provider = codeOnly(await source("src/features/dictation/provider.ts"));
    for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "console.log", "console.info", "supabase"]) {
      expect(provider.includes(forbidden), forbidden).toBe(false);
    }
  });
});

describe("draft-only live UX and stale-run boundary", () => {
  it("updates the field from one fixed run baseline so interim evolution cannot append itself", async () => {
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/runBaseValue/);
    expect(button).toMatch(/insertTranscript\(base, said, runBaseCaret\.current\)/);
    expect(button).toMatch(/onPreview: applyRunTranscript/);
    expect(button).toMatch(/onFinal: \(said\) => \{\s*applyRunTranscript\(said\)/);
  });

  it("Discard restores the exact pre-run draft after interim text was shown", async () => {
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/revertRunPreview/);
    expect(button).toMatch(/onInsert\(base, caret\)/);
    expect(button).toMatch(/onCancel: revertRunPreview/);
  });

  it("late interim/final/error events are gated by the active run id", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    expect((hook.match(/activeRun\.current !== runId \|\| ended/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(hook).toMatch(/activeRun\.current \+= 1;[\s\S]*current\?\.abort\(\)/);
  });

  it("only one field may own a live voice session at a time", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/let activeVoiceLease/);
    expect(hook).toMatch(/activeVoiceLease\.cancel\(\)/);
  });

  it("exposes timing numbers as inert data attributes without clinical logging", async () => {
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    for (const metric of [
      "data-voice-mic-ready-ms",
      "data-voice-token-ready-ms",
      "data-voice-provider-connected-ms",
      "data-voice-first-audio-ms",
      "data-voice-speech-started-ms",
      "data-voice-first-transcript-ms",
      "data-voice-stop-final-ms",
    ]) {
      expect(button).toContain(metric);
    }
    expect(button).not.toMatch(/console\.(log|info|warn|error)/);
  });

  it("voice UI and streaming transport still have no clinical mutation authority", async () => {
    for (const file of [
      "src/features/dictation/provider.ts",
      "src/features/dictation/deepgram-token-cache.ts",
      "src/features/dictation/use-dictation.ts",
      "src/features/dictation/components/dictate-button.tsx",
      "src/features/dictation/deepgram-stream.ts",
    ]) {
      const src = codeOnly(await source(file));
      expect(src).not.toMatch(/from\s+["'][^"']*actions["']/);
      expect(src).not.toMatch(/\bfinalizePrescription|finishConsultation|finish_consultation|addMedicine|addDiagnosis|addInvestigation/i);
      expect(src).not.toMatch(/\.rpc\(|supabase/);
    }
  });
});
