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
  React.useEffect(() => {
    insertionCaret.current = caretAt;
  }, [caretAt]);

  const {
    state,
    transcript,
    error,
    supported,
    providerNotice,
    start,
    stop,
    cancel,
  } = useDictation({
    language: voiceLanguage.providerLanguage,
    providerId: voiceLanguage.provider,
    onFinal: (said) => {
      const result = insertTranscript(value, said, insertionCaret.current);
      insertionCaret.current = result.caret;
      onInsert(result.text, result.caret);
    },
  });

  if (!supported) return null;

  const busy = state === "recording" || state === "transcribing";
  const label = DICTATION_LABEL[state];

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {state === "recording" ? (
          <>
            <button
              type="button"
              onClick={stop}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#a81c1c] px-3 text-[13px] font-semibold text-white focus-visible:focus-ring"
            >
              <Square className="size-3.5 shrink-0 fill-current" aria-hidden="true" />
              Stop
            </button>
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
            onClick={start}
            disabled={disabled || state === "transcribing"}
            aria-label={`${state === "error" ? "Try dictation again for" : "Dictate"} ${fieldLabel}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
          >
            {state === "transcribing" ? (
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <Mic className="size-4 shrink-0" aria-hidden="true" />
            )}
            {state === "error" ? "Try again" : label}
          </button>
        )}

        {busy && (
          <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                state === "recording" ? "animate-pulse bg-[#a81c1c]" : "bg-ink-muted",
              )}
            />
            {label}{state === "recording" ? "…" : ""}
          </span>
        )}
      </div>

      {busy && transcript && (
        <p className="mt-2 min-w-0 rounded-xl bg-surface-muted px-3 py-2 text-[13px] break-words whitespace-pre-wrap text-ink-secondary">
          {transcript}
        </p>
      )}

      {state === "error" && error && (
        <p role="alert" className="mt-2 flex min-w-0 items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[12px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}

      {state === "recording" && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          {providerNotice} Nothing is added to the clinical record until you explicitly save or add it.
        </p>
      )}
    </div>
  );
}
