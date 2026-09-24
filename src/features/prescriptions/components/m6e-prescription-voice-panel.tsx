"use client";

import * as React from "react";
import { Mic2, ShieldAlert, Square, Waves } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { useDictation } from "@/features/dictation/use-dictation";
import {
  LIVE_VOICE_ENABLED,
  useVoiceLanguage,
  VoiceLanguageControl,
} from "@/features/dictation/voice-language";

const M6E_NORMALIZE_TIMEOUT_MS = 9_000;
const M6E_TRANSIENT_NORMALIZE_STATUSES = new Set([502, 503, 504]);

type NormalizeResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
};

type NormalizeRequest = (input: string, init: RequestInit) => Promise<NormalizeResponse>;

const defaultNormalizeRequest: NormalizeRequest = (input, init) => fetch(input, init);

async function requestMixedNormalization(
  transcript: string,
  language: string,
  request: NormalizeRequest,
): Promise<{ transcript: string; retryable: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), M6E_NORMALIZE_TIMEOUT_MS);
  try {
    const response = await request("/api/voice/normalize", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ transcript, language }),
    });
    const payload = (await response.json().catch(() => ({}))) as { transcript?: unknown };
    const normalized = typeof payload.transcript === "string" ? payload.transcript.trim() : "";
    if (response.ok && normalized) return { transcript: normalized, retryable: false };
    return {
      transcript,
      retryable:
        typeof response.status === "number" && M6E_TRANSIENT_NORMALIZE_STATUSES.has(response.status),
    };
  } catch {
    return { transcript, retryable: !controller.signal.aborted };
  } finally {
    clearTimeout(timeout);
  }
}

export async function normalizeM6EHearing(
  transcript: string,
  language: string,
  request: NormalizeRequest = defaultNormalizeRequest,
  isCurrent: () => boolean = () => true,
): Promise<string> {
  if (language !== "bn-BD-mixed") return transcript;

  const first = await requestMixedNormalization(transcript, language, request);
  if (!first.retryable || !isCurrent()) return first.transcript;

  const second = await requestMixedNormalization(transcript, language, request);
  return isCurrent() ? second.transcript : transcript;
}

export async function resolveM6EStableHearing(
  transcript: string,
  language: string,
  generation: number,
  currentGeneration: () => number,
  request: NormalizeRequest = defaultNormalizeRequest,
): Promise<string | null> {
  const normalized = await normalizeM6EHearing(
    transcript,
    language,
    request,
    () => currentGeneration() === generation,
  );
  return currentGeneration() === generation ? normalized : null;
}

export interface M6EHearingSequencer {
  beginSession: () => void;
  invalidateSession: () => void;
  onPreview: (text: string) => void;
  onStable: (text: string, language: string) => Promise<void>;
}

export function createM6EHearingSequencer({
  display,
  request = defaultNormalizeRequest,
}: {
  display: (text: string) => void;
  request?: NormalizeRequest;
}): M6EHearingSequencer {
  let sessionEpoch = 0;
  let stableSequence = 0;

  function invalidateSession() {
    sessionEpoch += 1;
    stableSequence = 0;
  }

  return {
    beginSession: invalidateSession,
    invalidateSession,
    onPreview(text) {
      if (text) display(text);
    },
    async onStable(text, language) {
      if (!text.trim()) return;
      const epoch = sessionEpoch;
      const sequence = ++stableSequence;
      const isCurrent = () => sessionEpoch === epoch && stableSequence === sequence;
      display(text);
      const normalized = await normalizeM6EHearing(text, language, request, isCurrent);
      if (isCurrent()) display(normalized);
    },
  };
}

/**
 * M6E-A only: route-local Prescription voice shell.
 *
 * This component deliberately has no prescription mutation, Autopilot, Review,
 * or Finalize dependency. Speech is preview-only in this phase. The existing
 * M6 `useDictation` hook remains the sole owner of microphone/provider session
 * lifecycle, including its global active-voice lease and unmount cleanup.
 */
export function M6EPrescriptionVoicePanel({ disabled }: { disabled: boolean }) {
  const voiceLanguage = useVoiceLanguage();
  const [preview, setPreview] = React.useState("");
  const [status, setStatus] = React.useState(
    "Prescription context ready. Start Voice when you want to use the assistant.",
  );
  const hearingSequencer = React.useMemo(
    () => createM6EHearingSequencer({ display: setPreview }),
    [],
  );

  React.useLayoutEffect(() => {
    hearingSequencer.invalidateSession();
  }, [hearingSequencer, voiceLanguage.lang]);

  React.useEffect(
    () => () => {
      hearingSequencer.invalidateSession();
    },
    [hearingSequencer],
  );

  async function showStableHearing(text: string) {
    if (!text.trim()) return;
    setStatus("Speech heard in Prescription context. No clinical field was changed.");
    await hearingSequencer.onStable(text, voiceLanguage.lang);
  }

  const dictation = useDictation({
    language: voiceLanguage.providerLanguage,
    providerMode: LIVE_VOICE_ENABLED ? "deepgram" : "mock",
    continuous: true,
    onPreview: (text) => {
      hearingSequencer.onPreview(text);
    },
    onUtteranceEnd: (text) => {
      void showStableHearing(text);
    },
    onFinal: (text) => {
      hearingSequencer.invalidateSession();
      setStatus(
        text.trim()
          ? "Voice session ended. Final speech was not written to the prescription."
          : "Voice session ended.",
      );
    },
    onCancel: () => {
      hearingSequencer.invalidateSession();
      setPreview("");
      setStatus("Voice session ended. No clinical field was changed.");
    },
  });

  const active = ["connecting", "listening", "finalizing"].includes(dictation.state);

  function start() {
    if (disabled || active) return;
    hearingSequencer.beginSession();
    setPreview("");
    setStatus(
      "Listening in Prescription context. M6E-A is preview-only; speech cannot add, edit, remove, apply, review, or finalize anything.",
    );
    dictation.start();
  }

  function end() {
    if (!active) return;
    hearingSequencer.invalidateSession();
    setStatus("Ending Prescription voice session…");
    dictation.stop();
  }

  return (
    <SectionCard
      className="min-w-0 overflow-hidden"
      data-m6e-prescription-voice
      data-voice-mode={LIVE_VOICE_ENABLED ? "live" : "mock"}
    >
      <SectionHeader
        title="Voice Assistant"
        icon={<Mic2 className="size-4" />}
        action={
          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[10px] font-semibold text-ink-secondary">
            Prescription · M6E-A
          </span>
        }
      />

      <div className="min-w-0 space-y-3 p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <VoiceLanguageControl disabled={disabled || active} />

          {active ? (
            <button
              type="button"
              onClick={end}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#a81c1c] px-4 text-[13px] font-semibold text-white focus-visible:focus-ring sm:w-auto"
            >
              <Square className="size-3.5 fill-current" aria-hidden="true" />
              End Voice
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={disabled || !dictation.supported}
              className="dd-primary inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
            >
              <Waves className="size-4" aria-hidden="true" />
              Start Voice
            </button>
          )}
        </div>

        {preview ? (
          <p role="status" className="min-w-0 break-words rounded-xl bg-surface-muted px-3 py-2 text-[12px] text-ink-secondary">
            <strong className="font-semibold text-ink">Hearing:</strong> {preview}
          </p>
        ) : null}

        {dictation.error ? (
          <p role="alert" className="min-w-0 break-words rounded-xl bg-danger-soft px-3 py-2 text-[12px] font-medium text-[#a81c1c]">
            {dictation.error}
          </p>
        ) : null}

        <p role="status" aria-live="polite" className="min-w-0 break-words text-[12px] font-medium text-ink-secondary">
          {status}
        </p>

        <p className="min-w-0 break-words text-[10px] text-ink-muted">
          {dictation.providerNotice}
        </p>

        <p className="flex min-w-0 items-start gap-1.5 break-words text-[10px] text-ink-muted">
          <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            M6E-A is transport integration only. Speech is not connected to medicine mutations,
            Autopilot, Review, or Finalize.
          </span>
        </p>
      </div>
    </SectionCard>
  );
}
