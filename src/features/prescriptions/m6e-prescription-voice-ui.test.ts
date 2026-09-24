import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeM6EHearing, resolveM6EStableHearing } from "./components/m6e-prescription-voice-panel";

const requirePermission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requirePermission }));

import { POST as normalizeVoicePost } from "@/app/api/voice/normalize/route";

const root = process.cwd();
const voiceSource = readFileSync(
  resolve(root, "src/features/prescriptions/components/m6e-prescription-voice-panel.tsx"),
  "utf8",
);
const composerSource = readFileSync(
  resolve(root, "src/features/prescriptions/components/prescription-composer.tsx"),
  "utf8",
);
const dictationSource = readFileSync(
  resolve(root, "src/features/dictation/use-dictation.ts"),
  "utf8",
);

describe("M6E-A prescription voice shell", () => {
  it("reuses the existing M6 transport, language control, and continuous session", () => {
    expect(voiceSource).toContain('from "@/features/dictation/use-dictation"');
    expect(voiceSource).toContain("VoiceLanguageControl");
    expect(voiceSource).toContain('providerMode: LIVE_VOICE_ENABLED ? "deepgram" : "mock"');
    expect(voiceSource).toContain("continuous: true");
    expect(voiceSource).toContain("data-m6e-prescription-voice");
  });

  it("mounts only for an editable prescription and never auto-starts on render", () => {
    expect(composerSource).toContain("!readOnly ? <M6EPrescriptionVoicePanel disabled={rx.blocked} /> : null");
    expect(voiceSource).toContain("onClick={start}");
    expect(voiceSource.match(/dictation\.start\(\);/g)).toHaveLength(1);
    expect(voiceSource).not.toMatch(/useEffect[\s\S]{0,300}dictation\.start/);
  });

  it("keeps M6E-A speech preview-only with no clinical, Autopilot, Review, or Finalize mutation path", () => {
    for (const forbidden of [
      "addMedicineAction",
      "updateMedicineAction",
      "removeMedicineAction",
      "moveMedicineAction",
      "generateAutopilotPrescriptionProposalAction",
      "applyAutopilotProposalToDraftAction",
      "finalizePrescriptionAction",
      "openPrescriptionAction",
    ]) {
      expect(voiceSource).not.toContain(forbidden);
    }
    expect(voiceSource).not.toContain("router.push");
    expect(voiceSource).not.toContain("/review");
    expect(voiceSource).toContain("No clinical field was changed");
  });

  it("inherits the existing single-owner lease and unmount abort cleanup", () => {
    expect(dictationSource).toContain("let activeVoiceLease: ActiveVoiceLease | null = null");
    expect(dictationSource).toContain("if (activeVoiceLease && activeVoiceLease.owner !== owner) activeVoiceLease.cancel()");
    expect(dictationSource).toContain("current?.abort();");
  });

  it("keeps the shell mobile-contained", () => {
    expect(voiceSource).toContain('className="min-w-0 overflow-hidden"');
    expect(voiceSource).toContain("flex min-w-0 flex-col");
    expect(voiceSource).toContain("w-full shrink-0");
    expect(voiceSource).toContain("break-words");
  });
});


describe("M6E-A1 mixed Hearing normalization", () => {
  it("keeps English and Bangla provider-faithful without normalize calls", async () => {
    const request = vi.fn(async () => ({ ok: true, json: async () => ({ transcript: "unused" }) }));
    await expect(normalizeM6EHearing("Patient has fever", "en-US", request)).resolves.toBe("Patient has fever");
    await expect(normalizeM6EHearing("\u09b0\u09cb\u0997\u09c0\u09b0 \u099c\u09cd\u09ac\u09b0", "bn-BD", request)).resolves.toBe("\u09b0\u09cb\u0997\u09c0\u09b0 \u099c\u09cd\u09ac\u09b0");
    expect(request).not.toHaveBeenCalled();
  });

  it("normalizes mixed mode exactly once and sends the mixed language contract", async () => {
    let body: unknown;
    const request = vi.fn(async (_input: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return { ok: true, json: async () => ({ transcript: "Patient fever and CBC" }) };
    });
    await expect(normalizeM6EHearing("raw mixed transcript", "bn-BD-mixed", request)).resolves.toBe("Patient fever and CBC");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/voice/normalize", expect.objectContaining({ method: "POST" }));
    expect(body).toEqual({ transcript: "raw mixed transcript", language: "bn-BD-mixed" });
  });

  it("falls back to the original provider transcript on failure, non-200, or empty output", async () => {
    const raw = "raw provider transcript";
    const networkFailure = vi.fn(async () => { throw new Error("network"); });
    const non200 = vi.fn(async () => ({ ok: false, json: async () => ({ code: "provider-error" }) }));
    const empty = vi.fn(async () => ({ ok: true, json: async () => ({ transcript: "   " }) }));
    await expect(normalizeM6EHearing(raw, "bn-BD-mixed", networkFailure)).resolves.toBe(raw);
    await expect(normalizeM6EHearing(raw, "bn-BD-mixed", non200)).resolves.toBe(raw);
    await expect(normalizeM6EHearing(raw, "bn-BD-mixed", empty)).resolves.toBe(raw);
  });

  it("falls back to raw Hearing when the normalize request times out", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn((_input: string, init: RequestInit) => new Promise<{ ok: boolean; json: () => Promise<unknown> }>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
      const pending = normalizeM6EHearing("raw timeout transcript", "bn-BD-mixed", request);
      await vi.advanceTimersByTimeAsync(9_000);
      await expect(pending).resolves.toBe("raw timeout transcript");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an older async normalization result after a newer utterance generation begins", async () => {
    type Result = { ok: boolean; json: () => Promise<unknown> };
    let release: ((value: Result) => void) | undefined;
    const request = vi.fn(() => new Promise<Result>((resolve) => { release = resolve; }));
    let generation = 1;
    const pending = resolveM6EStableHearing("old raw", "bn-BD-mixed", 1, () => generation, request);
    generation = 2;
    release?.({ ok: true, json: async () => ({ transcript: "stale normalized" }) });
    await expect(pending).resolves.toBeNull();
  });

  it("shows raw interim immediately, replaces only stable current Hearing, and invalidates on end/unmount", () => {
    const stableStart = voiceSource.indexOf("async function showStableHearing");
    const stableEnd = voiceSource.indexOf("const dictation = useDictation", stableStart);
    const stable = voiceSource.slice(stableStart, stableEnd);
    expect(voiceSource).toContain("onPreview: (text) => {");
    expect(voiceSource).toContain("hearingGenerationRef.current += 1;\n      setPreview(text);");
    expect(stable.indexOf("setPreview(text);")).toBeLessThan(stable.indexOf("await resolveM6EStableHearing"));
    expect(stable.indexOf("setPreview(normalized);")).toBeGreaterThan(stable.indexOf("await resolveM6EStableHearing"));
    expect(voiceSource).toContain("onUtteranceEnd: (text) => {\n      void showStableHearing(text);");
    expect(voiceSource).toContain("onFinal: (text) => {\n      void showStableHearing(text, true);");
    expect(voiceSource).toContain("mountedRef.current = false;\n      hearingGenerationRef.current += 1;");
    expect(voiceSource).toContain("React.useLayoutEffect(() => {\n    hearingGenerationRef.current += 1;\n  }, [voiceLanguage.lang]);");
    expect(voiceSource).toContain("onCancel: () => {\n      hearingGenerationRef.current += 1;");
    const endStart = voiceSource.indexOf("function end()");
    const endBlock = voiceSource.slice(endStart, voiceSource.indexOf("return (", endStart));
    expect(endBlock).toContain("hearingGenerationRef.current += 1;");
  });

  it("keeps normalization display-only with zero clinical/action imports", () => {
    expect(voiceSource).toContain('request("/api/voice/normalize"');
    expect(voiceSource.match(/normalizeM6EHearing\(/g)).toHaveLength(2);
    for (const forbidden of [
      "addMedicineAction",
      "updateMedicineAction",
      "removeMedicineAction",
      "moveMedicineAction",
      "generateAutopilotPrescriptionProposalAction",
      "applyAutopilotProposalToDraftAction",
      "finalizePrescriptionAction",
      "openPrescriptionAction",
      "router.push",
      "/review",
    ]) expect(voiceSource).not.toContain(forbidden);
  });
});


describe("existing /api/voice/normalize mixed-language route", () => {
  const origin = "http://localhost:3200";

  function request(transcript: string, language: string) {
    return new NextRequest(`${origin}/api/voice/normalize`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ transcript, language }),
    });
  }

  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    requirePermission.mockResolvedValue({ user: { id: "doctor-test" } });
  });

  afterEach(() => {
    requirePermission.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps English and Bangla identity responses off the OpenAI provider", async () => {
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const english = await normalizeVoicePost(request("Patient has fever", "en-US"));
    const bangla = await normalizeVoicePost(request("\u09b0\u09cb\u0997\u09c0\u09b0 \u099c\u09cd\u09ac\u09b0", "bn-BD"));
    await expect(english.json()).resolves.toMatchObject({ transcript: "Patient has fever", provider: "identity" });
    await expect(bangla.json()).resolves.toMatchObject({ transcript: "\u09b0\u09cb\u0997\u09c0\u09b0 \u099c\u09cd\u09ac\u09b0", provider: "identity" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("normalizes mixed mode through the existing OpenAI-backed route", async () => {
    const provider = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: "Patient fever and CBC" }] }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", provider);
    const response = await normalizeVoicePost(request("raw mixed transcript", "bn-BD-mixed"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transcript: "Patient fever and CBC",
      provider: "openai",
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
