"use client";

import * as React from "react";
import { CircleAlert, Loader2, Mic, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DICTATION_LABEL, insertTranscript } from "../dictation";
import { useDictation } from "../use-dictation";
import { useVoiceLanguage } from "../voice-language";

export function DictateButton({
  fieldLabel,
  disabled = false,
  value,
  caretAt,
  onInsert,
  className,
}: {
  fieldLabel: string;
  disabled?: boolean;
  value: string;
  caretAt?: number;
  onInsert: (next: string, caret: number) => void;
  className?: string;
}) {
  const voiceLanguage = useVoiceLanguage();
  const insertionCaret = React.useRef<number | undefined>(caretAt);
  const runBaseValue = React.useRef<string | null>(null);
  const runBaseCaret = React.useRef<number | undefined>(caretAt);
  const previewApplied = React.useRef(false);

  React.useEffect(() => {
    insertionCaret.current = caretAt;
  }, [caretAt]);

  const applyRunTranscript = React.useCallback(
    (said: string) => {
      const base = runBaseValue.current ?? value;
      const result = insertTranscript(base, said, runBaseCaret.current);
      previewApplied.current = said.trim() !== "";
      insertionCaret.current = result.caret;
      onInsert(result.text, result.caret);
    },
    [onInsert, value],
  );

  const revertRunPreview = React.useCallback(() => {
    const base = runBaseValue.current;
    if (base !== null && previewApplied.current) {
      const caret = runBaseCaret.current ?? base.length;
      insertionCaret.current = caret;
      onInsert(base, caret);
    }
    previewApplied.current = false;
    runBaseValue.current = null;
  }, [onInsert]);

  const {
    state,
    error,
    diagnosticCode,
    supported,
    providerNotice,
    latency,
    start,
    stop,
    cancel,
  } = useDictation({
    language: voiceLanguage.providerLanguage,
    providerId: voiceLanguage.provider,
    onPreview: applyRunTranscript,
    onFinal: (said) => {
      applyRunTranscript(said);
      previewApplied.current = false;
      runBaseValue.current = null;
    },
    onCancel: revertRunPreview,
  });

  if (!supported) return null;

  const active = state === "connecting" || state === "listening" || state === "finalizing";
  const canStop = state === "connecting" || state === "listening";
  const failed = state === "error" || state === "provider-unavailable";
  const label = DICTATION_LABEL[state];

  const startDictation = () => {
    runBaseValue.current = value;
    runBaseCaret.current = insertionCaret.current;
    previewApplied.current = false;
    start();
  };

  return (
    <div
      className={cn("min-w-0", className)}
      data-voice-provider={voiceLanguage.provider}
      data-voice-diagnostic={diagnosticCode ?? undefined}
      data-voice-mic-ready-ms={latency.micReadyMs}
      data-voice-token-ready-ms={latency.tokenReadyMs}
      data-voice-provider-connected-ms={latency.providerConnectedMs}
      data-voice-first-audio-ms={latency.firstAudioSentMs}
      data-voice-speech-started-ms={latency.speechStartedMs}
      data-voice-first-transcript-ms={latency.firstTranscriptMs}
      data-voice-stop-final-ms={latency.stopToFinalMs}
    >
      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          <>
            {canStop ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#a81c1c] px-3 text-[13px] font-semibold text-white focus-visible:focus-ring"
              >
                <Square className="size-3.5 shrink-0 fill-current" aria-hidden="true" />
                Stop
              </button>
            ) : (
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-surface-muted px-3 text-[13px] font-semibold text-ink-secondary">
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                Finalizing
              </span>
            )}
            <button
              type="button"
              onClick={cancel}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
            >
              <X className="size-4 shrink-0" aria-hidden="true" />
              Discard
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={startDictation}
            disabled={disabled}
            aria-label={`${failed ? "Try dictation again for" : "Dictate"} ${fieldLabel}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
          >
            <Mic className="size-4 shrink-0" aria-hidden="true" />
            {failed ? "Try again" : label}
          </button>
        )}

        {active && (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                state === "listening" ? "animate-pulse bg-[#a81c1c]" : "bg-ink-muted",
              )}
            />
            {label}{state === "listening" ? "…" : ""}
          </span>
        )}
      </div>

      {failed && error && (
        <p role="alert" className="mt-1.5 flex min-w-0 items-start gap-1.5 text-[11px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}

      {failed && diagnosticCode && (
        <p className="mt-1 text-[10px] font-mono text-ink-muted" data-voice-qa-diagnostic>
          QA: {diagnosticCode}
        </p>
      )}

      {state === "listening" && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          {providerNotice} Speech appears here as an editable draft; nothing enters the clinical record until you explicitly save or add it.
        </p>
      )}
    </div>
  );
}
