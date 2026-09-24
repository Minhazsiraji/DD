import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createM6EHearingSequencer,
  normalizeM6EHearing,
  resolveM6EStableHearing,
} from "./components/m6e-prescription-voice-panel";

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

describe("M6E-A1/A2 mixed Hearing normalization runtime", () => {
  type Result = { ok: boolean; status?: number; json: () => Promise<unknown> };

  function deferredRequest() {
    const pending: Array<(value: Result) => void> = [];
    const request = vi.fn(() => new Promise<Result>((resolvePending) => pending.push(resolvePending)));
    return { request, pending };
  }

  it("keeps English and Bangla provider-faithful without normalize calls", async () => {
    const shown: string[] = [];
    const request = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ transcript: "unused" }) }));
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    await hearing.onStable("Patient has fever", "en-US");
    expect(shown.at(-1)).toBe("Patient has fever");
    await hearing.onStable("রোগীর জ্বর", "bn-BD");
    expect(shown.at(-1)).toBe("রোগীর জ্বর");
    expect(request).not.toHaveBeenCalled();
  });

  it("normalizes one current mixed stable utterance exactly once with the mixed-language contract", async () => {
    let body: unknown;
    const shown: string[] = [];
    const request = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe("/api/voice/normalize");
      body = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({ transcript: "Patient fever and CBC" }) };
    });
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    await hearing.onStable("raw mixed transcript", "bn-BD-mixed");

    expect(request).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ transcript: "raw mixed transcript", language: "bn-BD-mixed" });
    expect(shown.at(-1)).toBe("Patient fever and CBC");
  });

  it("CASE 1: trailing preview from the same utterance cannot discard successful mixed normalization", async () => {
    const raw = "পেশেন্টের ফিভার আছে, সিবিসি করতে হবে";
    const normalized = "Patient-এর fever আছে, CBC করতে হবে";
    const shown: string[] = [];
    const { request, pending } = deferredRequest();
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    hearing.onPreview(raw);
    const stable = hearing.onStable(raw, "bn-BD-mixed");
    hearing.onPreview(`${raw} `);
    pending[0]?.({ ok: true, status: 200, json: async () => ({ transcript: normalized }) });
    await stable;

    expect(request).toHaveBeenCalledTimes(1);
    expect(shown.at(-1)).toBe(normalized);
  });

  it("CASE 2: empty trailing preview does not blank or invalidate stable normalization", async () => {
    const raw = "প্রেসক্রিপশন এ পেশেন্ট এখন স্টেবল";
    const normalized = "Prescription এ patient এখন stable";
    const shown: string[] = [];
    const { request, pending } = deferredRequest();
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    const stable = hearing.onStable(raw, "bn-BD-mixed");
    hearing.onPreview("");
    expect(shown.at(-1)).toBe(raw);
    pending[0]?.({ ok: true, status: 200, json: async () => ({ transcript: normalized }) });
    await stable;

    expect(shown.at(-1)).toBe(normalized);
  });

  it("CASE 3: a genuinely newer stable utterance invalidates the older normalization result", async () => {
    const shown: string[] = [];
    const { request, pending } = deferredRequest();
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    const first = hearing.onStable("পেশেন্টের ফিভার", "bn-BD-mixed");
    const second = hearing.onStable("ফলো আপ দুই সপ্তাহ পরে", "bn-BD-mixed");
    pending[0]?.({ ok: true, status: 200, json: async () => ({ transcript: "Patient-এর fever" }) });
    await first;
    expect(shown.at(-1)).toBe("ফলো আপ দুই সপ্তাহ পরে");
    pending[1]?.({ ok: true, status: 200, json: async () => ({ transcript: "follow-up দুই সপ্তাহ পরে" }) });
    await second;

    expect(shown.at(-1)).toBe("follow-up দুই সপ্তাহ পরে");
  });

  it("CASE 4: End Voice invalidates pending normalization so old text cannot resurrect", async () => {
    const shown: string[] = [];
    const { request, pending } = deferredRequest();
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    const stable = hearing.onStable("পেশেন্ট এখন স্টেবল", "bn-BD-mixed");
    hearing.invalidateSession();
    pending[0]?.({ ok: true, status: 200, json: async () => ({ transcript: "patient এখন stable" }) });
    await stable;

    expect(shown).not.toContain("patient এখন stable");
    expect(shown.at(-1)).toBe("পেশেন্ট এখন স্টেবল");
  });

  it("CASE 5: language change invalidates pending mixed normalization", async () => {
    const shown: string[] = [];
    const { request, pending } = deferredRequest();
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    const stable = hearing.onStable("পেশেন্টের ফিভার", "bn-BD-mixed");
    hearing.invalidateSession();
    pending[0]?.({ ok: true, status: 200, json: async () => ({ transcript: "Patient-এর fever" }) });
    await stable;

    expect(shown).not.toContain("Patient-এর fever");
  });

  it("retries one transient 502 exactly once with the same transcript, language, and display authority", async () => {
    const raw = "প্রেসক্রিপশন এ পেশেন্ট এখন স্টেবল";
    const normalized = "Prescription এ patient এখন stable";
    const shown: string[] = [];
    const bodies: unknown[] = [];
    const request = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe("/api/voice/normalize");
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) {
        return { ok: false, status: 502, json: async () => ({ code: "openai-provider-error" }) };
      }
      return { ok: true, status: 200, json: async () => ({ transcript: normalized }) };
    });
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    await hearing.onStable(raw, "bn-BD-mixed");

    expect(request).toHaveBeenCalledTimes(2);
    expect(bodies).toEqual([
      { transcript: raw, language: "bn-BD-mixed" },
      { transcript: raw, language: "bn-BD-mixed" },
    ]);
    expect(shown.at(-1)).toBe(normalized);
  });

  it("does not retry unauthorized, forbidden, or invalid-request responses", async () => {
    for (const status of [400, 401, 403]) {
      const request = vi.fn(async () => ({ ok: false, status, json: async () => ({ code: "rejected" }) }));
      await expect(normalizeM6EHearing("raw mixed", "bn-BD-mixed", request)).resolves.toBe("raw mixed");
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it("does not retry a transient response once the stable utterance became stale", async () => {
    let current = true;
    const request = vi.fn(async () => {
      current = false;
      return { ok: false, status: 502, json: async () => ({ code: "provider-error" }) };
    });

    await expect(
      normalizeM6EHearing("raw mixed", "bn-BD-mixed", request, () => current),
    ).resolves.toBe("raw mixed");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("falls back to raw Hearing on non-transient failure, empty output, or timeout", async () => {
    const raw = "raw provider transcript";
    const nonTransient = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ code: "invalid-request" }) }));
    const empty = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ transcript: "   " }) }));
    await expect(normalizeM6EHearing(raw, "bn-BD-mixed", nonTransient)).resolves.toBe(raw);
    await expect(normalizeM6EHearing(raw, "bn-BD-mixed", empty)).resolves.toBe(raw);

    vi.useFakeTimers();
    try {
      const timeoutRequest = vi.fn((input: string, init: RequestInit) => {
        expect(input).toBe("/api/voice/normalize");
        return new Promise<Result>((resolvePending, reject) => {
          void resolvePending;
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      });
      const pending = normalizeM6EHearing(raw, "bn-BD-mixed", timeoutRequest);
      await vi.advanceTimersByTimeAsync(9_000);
      await expect(pending).resolves.toBe(raw);
      expect(timeoutRequest).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the previous stale-generation helper contract", async () => {
    let release: ((value: Result) => void) | undefined;
    const request = vi.fn(() => new Promise<Result>((resolvePending) => { release = resolvePending; }));
    let generation = 1;
    const pending = resolveM6EStableHearing("old raw", "bn-BD-mixed", 1, () => generation, request);
    generation = 2;
    release?.({ ok: true, status: 200, json: async () => ({ transcript: "stale normalized" }) });
    await expect(pending).resolves.toBeNull();
  });

  it("wires previews without authority invalidation and invalidates on language/end/cancel/unmount", () => {
    expect(voiceSource).toContain("hearingSequencer.onPreview(text);");
    expect(voiceSource).not.toContain("hearingGenerationRef");
    expect(voiceSource).toContain("await hearingSequencer.onStable(text, voiceLanguage.lang);");
    expect(voiceSource).toContain("hearingSequencer.beginSession();");
    expect(voiceSource).toContain("React.useLayoutEffect(() => {\n    hearingSequencer.invalidateSession();");
    expect(voiceSource).toContain("onCancel: () => {\n      hearingSequencer.invalidateSession();");
    expect(voiceSource).toContain("() => () => {\n      hearingSequencer.invalidateSession();");
    const endStart = voiceSource.indexOf("function end()");
    const endBlock = voiceSource.slice(endStart, voiceSource.indexOf("return (", endStart));
    expect(endBlock).toContain("hearingSequencer.invalidateSession();");
  });

  it("keeps normalization display-only with zero clinical/action imports", () => {
    expect(voiceSource).toContain('request("/api/voice/normalize"');
    expect(voiceSource).toContain("M6E_TRANSIENT_NORMALIZE_STATUSES");
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
    const bangla = await normalizeVoicePost(request("রোগীর জ্বর", "bn-BD"));
    await expect(english.json()).resolves.toMatchObject({ transcript: "Patient has fever", provider: "identity" });
    await expect(bangla.json()).resolves.toMatchObject({ transcript: "রোগীর জ্বর", provider: "identity" });
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
