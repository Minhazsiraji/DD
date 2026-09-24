"use client";

import * as React from "react";
import { Mic2, Pause, Play, ShieldAlert, Square, Waves } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { useDictation } from "@/features/dictation/use-dictation";
import {
  LIVE_VOICE_ENABLED,
  useVoiceLanguage,
  VoiceLanguageControl,
} from "@/features/dictation/voice-language";
import { restoreM6EMixedContractTerms } from "../m6e-mixed-restoration";
import { parseM6EVoiceSessionControl } from "../m6e-prescription-voice-contract";

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
  if (!first.retryable || !isCurrent()) {
    return restoreM6EMixedContractTerms(first.transcript);
  }

  const second = await requestMixedNormalization(transcript, language, request);
  const authoritative = isCurrent() ? second.transcript : transcript;
  return restoreM6EMixedContractTerms(authoritative);
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

function comparableProviderText(text: string) {
  return text
    .normalize("NFC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isTrailingPreviewForStableUtterance(preview: string, stable: string) {
  const next = comparableProviderText(preview);
  const completed = comparableProviderText(stable);
  if (!next || !completed) return false;
  if (next === completed || next.startsWith(completed) || completed.startsWith(next)) return true;

  const shorter = Math.min(next.length, completed.length);
  if (shorter < 8) return false;
  let commonPrefix = 0;
  while (commonPrefix < shorter && next[commonPrefix] === completed[commonPrefix]) commonPrefix += 1;
  return commonPrefix / shorter >= 0.8;
}

export function isDuplicateM6ESessionFinal(finalText: string, lastUtteranceText: string | null) {
  return Boolean(
    finalText.trim() &&
      lastUtteranceText &&
      comparableProviderText(finalText) === comparableProviderText(lastUtteranceText),
  );
}

export interface M6EHearingSequencer {
  beginSession: () => void;
  invalidateSession: () => void;
  onPreview: (text: string) => void;
  onStable: (text: string, language: string) => Promise<string | null>;
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
  let lockedStableRaw: string | null = null;

  function invalidateSession() {
    sessionEpoch += 1;
    stableSequence = 0;
    lockedStableRaw = null;
  }

  return {
    beginSession: invalidateSession,
    invalidateSession,
    onPreview(text) {
      if (!text) return;
      if (lockedStableRaw && isTrailingPreviewForStableUtterance(text, lockedStableRaw)) return;
      lockedStableRaw = null;
      display(text);
    },
    async onStable(text, language) {
      if (!text.trim()) return null;
      const epoch = sessionEpoch;
      const sequence = ++stableSequence;
      const isCurrent = () => sessionEpoch === epoch && stableSequence === sequence;
      lockedStableRaw = null;
      display(text);
      const normalized = await normalizeM6EHearing(text, language, request, isCurrent);
      if (!isCurrent()) return null;
      display(normalized);
      if (language === "bn-BD-mixed" && normalized !== text) lockedStableRaw = text;
      return normalized;
    },
  };
}

type VoiceTargetOption = { value: string; label: string };

/**
 * Route-local Prescription voice shell. The existing M6 `useDictation` hook
 * remains the sole owner of microphone/provider lifecycle and active lease.
 * The exact final normalized Hearing transcript is the transcript passed to the
 * Prescription controller, so display and command parsing cannot diverge.
 */
export function M6EPrescriptionVoicePanel({
  disabled,
  target,
  targetValue,
  targetOptions,
  onTargetChange,
  onStableTranscript,
}: {
  disabled: boolean;
  target: string;
  targetValue: string;
  targetOptions: readonly VoiceTargetOption[];
  onTargetChange: (value: string) => void;
  onStableTranscript: (text: string) => Promise<string>;
}) {
  const voiceLanguage = useVoiceLanguage();
  const [preview, setPreview] = React.useState("");
  const [status, setStatus] = React.useState(
    "Prescription context ready. Start Voice when you want to use the assistant.",
  );
  const [paused, setPaused] = React.useState(false);
  const lastUtteranceRaw = React.useRef<string | null>(null);
  const onStableTranscriptRef = React.useRef(onStableTranscript);

  React.useLayoutEffect(() => {
    onStableTranscriptRef.current = onStableTranscript;
  });

  const hearingSequencer = React.useMemo(
    () => createM6EHearingSequencer({ display: setPreview }),
    [],
  );

  React.useLayoutEffect(() => {
    hearingSequencer.invalidateSession();
  }, [hearingSequencer, voiceLanguage.lang]);

  React.useLayoutEffect(() => {
    if (targetValue.startsWith("FIELD:")) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.dataset.medicineField) {
      activeElement.blur();
    }
  }, [targetValue]);

  React.useEffect(
    () => () => {
      hearingSequencer.invalidateSession();
    },
    [hearingSequencer],
  );

  async function showStableHearing(text: string, sessionEnded = false) {
    if (!text.trim()) return;
    const stable = await hearingSequencer.onStable(text, voiceLanguage.lang);
    if (!stable) return;

    const control = parseM6EVoiceSessionControl(stable);
    if (control === "PAUSE") {
      setPaused(true);
      setStatus(
        "Prescription Voice paused. Say Resume or use the Resume button; ordinary speech cannot change staged state while paused.",
      );
      return;
    }
    if (control === "RESUME") {
      setPaused(false);
      setStatus("Prescription Voice resumed.");
      return;
    }
    if (control === "END") {
      setStatus("Ending Prescription voice session…");
      dictation.stop();
      return;
    }
    if (paused) {
      setStatus("Prescription Voice is paused. Nothing changed. Say Resume to continue.");
      return;
    }

    const result = await onStableTranscriptRef.current(stable);
    setStatus(sessionEnded ? `Voice session ended. ${result}` : result);
  }

  const dictation = useDictation({
    language: voiceLanguage.providerLanguage,
    providerMode: LIVE_VOICE_ENABLED ? "deepgram" : "mock",
    continuous: true,
    onPreview: (text) => {
      hearingSequencer.onPreview(text);
    },
    onUtteranceEnd: (text) => {
      lastUtteranceRaw.current = text;
      void showStableHearing(text);
    },
    onFinal: (text) => {
      const duplicate = isDuplicateM6ESessionFinal(text, lastUtteranceRaw.current);
      hearingSequencer.invalidateSession();
      if (text.trim() && !duplicate) {
        void showStableHearing(text, true);
      } else {
        setStatus("Voice session ended.");
      }
      lastUtteranceRaw.current = null;
      setPaused(false);
    },
    onCancel: () => {
      hearingSequencer.invalidateSession();
      setPreview("");
      setPaused(false);
      lastUtteranceRaw.current = null;
      setStatus("Voice session ended. No pending Prescription voice action was applied.");
    },
  });

  const active = ["connecting", "listening", "finalizing"].includes(dictation.state);

  function start() {
    if (disabled || active) return;
    hearingSequencer.beginSession();
    setPreview("");
    setPaused(false);
    lastUtteranceRaw.current = null;
    setStatus(
      "Listening in Prescription context. Clinical writes still require the existing explicit Doctor confirmation controls.",
    );
    dictation.start();
  }

  function end() {
    if (!active) return;
    hearingSequencer.invalidateSession();
    setStatus("Ending Prescription voice session…");
    dictation.stop();
  }

  function togglePause() {
    if (!active) return;
    setPaused((current) => !current);
    setStatus(
      paused
        ? "Prescription Voice resumed."
        : "Prescription Voice paused. Ordinary speech cannot change staged state.",
    );
  }

  return (
    <div className="sticky top-2 z-40 min-w-0" data-m6e-voice-sticky>
      <SectionCard
        className="min-w-0 overflow-hidden"
        data-m6e-prescription-voice
        data-voice-mode={LIVE_VOICE_ENABLED ? "live" : "mock"}
      >
        <SectionHeader
          title="Voice Assistant"
          icon={<Mic2 className="size-4" />}
          action={
            <span className="max-w-[14rem] truncate rounded-full bg-surface-muted px-2.5 py-1 text-[10px] font-semibold text-ink-secondary">
              {target}
            </span>
          }
        />

        <div className="max-h-[42vh] min-w-0 overflow-x-hidden overflow-y-auto sm:max-h-none sm:overflow-visible">
          <div className="min-w-0 space-y-3 p-4 sm:p-5">
            <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
              <label className="min-w-0 text-[11px] font-semibold text-ink-secondary">
                Current voice target
                <select
                  aria-label="Current voice target"
                  value={targetValue}
                  disabled={disabled}
                  onChange={(event) => onTargetChange(event.target.value)}
                  className="mt-1 min-h-11 w-full min-w-0 max-w-full rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink focus-visible:focus-ring disabled:opacity-55"
                >
                  {targetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <VoiceLanguageControl disabled={disabled || active} />

              {active ? (
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:justify-end">
                  <button
                    type="button"
                    onClick={togglePause}
                    className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink focus-visible:focus-ring sm:w-auto"
                  >
                    {paused ? (
                      <Play className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Pause className="size-3.5" aria-hidden="true" />
                    )}
                    {paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    type="button"
                    onClick={end}
                    className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#a81c1c] px-4 text-[13px] font-semibold text-white focus-visible:focus-ring sm:w-auto"
                  >
                    <Square className="size-3.5 fill-current" aria-hidden="true" />
                    End Voice
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={start}
                  disabled={disabled || !dictation.supported}
                  className="dd-primary inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto lg:justify-self-end"
                >
                  <Waves className="size-4" aria-hidden="true" />
                  Start Voice
                </button>
              )}
            </div>

            {preview ? (
              <p
                role="status"
                className="min-w-0 break-words rounded-xl bg-surface-muted px-3 py-2 text-[12px] text-ink-secondary"
              >
                <strong className="font-semibold text-ink">Hearing:</strong> {preview}
              </p>
            ) : null}

            {dictation.error ? (
              <p
                role="alert"
                className="min-w-0 break-words rounded-xl bg-danger-soft px-3 py-2 text-[12px] font-medium text-[#a81c1c]"
              >
                {dictation.error}
              </p>
            ) : null}

            <p
              role="status"
              aria-live="polite"
              className="min-w-0 break-words text-[12px] font-medium text-ink-secondary"
            >
              {status}
            </p>

            <p className="min-w-0 break-words text-[10px] text-ink-muted">
              {dictation.providerNotice}
            </p>

            <p className="flex min-w-0 items-start gap-1.5 break-words text-[10px] text-ink-muted">
              <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Voice may stage editable medicine/proposal changes and navigate to Review. Add,
                Save, Apply, removal confirmation, and Finalize remain explicit Doctor-controlled
                boundaries.
              </span>
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
