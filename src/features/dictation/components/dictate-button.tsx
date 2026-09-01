"use client";

import * as React from "react";
import { CircleAlert, Loader2, Mic, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DICTATION_LABEL, insertTranscript } from "../dictation";
import { useDictation } from "../use-dictation";

/**
 * ONE dictation control, used by every field that has one.
 *
 * It captures speech and hands the words to `onInsert`. It does not save, does
 * not know what field it is beside, and cannot reach a clinical write path —
 * the doctor reviews the text and presses the same explicit Save/Add control
 * they already use.
 *
 * ABSENT, NOT BROKEN, where the browser has no speech engine. Firefox users get
 * no control at all rather than one that fails when pressed, and typing is
 * exactly as it was.
 */
export function DictateButton({
  fieldLabel,
  disabled = false,
  value,
  caretAt,
  onInsert,
  className,
}: {
  /** Named in the button's accessible label — "Dictate examination". */
  fieldLabel: string;
  disabled?: boolean;
  /** The draft as it stands. Dictation adds to this; it never replaces it. */
  value: string;
  /** Where the doctor's cursor is, if it is in this field. */
  caretAt?: number;
  onInsert: (next: string, caret: number) => void;
  className?: string;
}) {
  /**
   * The form owns the caret while the doctor is typing. Once dictation inserts
   * text the microphone button has focus, so the textarea may not emit another
   * selection event. Remember the returned insertion caret here so a second
   * dictation continues after the first instead of jumping back to the old
   * cursor position.
   */
  const insertionCaret = React.useRef<number | undefined>(caretAt);
  React.useEffect(() => {
    insertionCaret.current = caretAt;
  }, [caretAt]);

  const { state, transcript, error, supported, start, stop, cancel } = useDictation({
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

        {/* STATE IN WORDS, never colour alone. */}
        {busy && (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                state === "recording" ? "animate-pulse bg-[#a81c1c]" : "bg-ink-muted",
              )}
            />
            {label}
            {state === "recording" ? "…" : ""}
          </span>
        )}
      </div>

      {/* What was heard, before it lands anywhere. */}
      {busy && transcript && (
        <p className="mt-2 min-w-0 rounded-xl bg-surface-muted px-3 py-2 text-[13px] break-words whitespace-pre-wrap text-ink-secondary">
          {transcript}
        </p>
      )}

      {state === "error" && error && (
        <p
          role="alert"
          className="mt-2 flex min-w-0 items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[12px] font-medium text-[#a81c1c]"
        >
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}

      {/*
        Said where it is acted on, not buried in a policy page. Browser speech
        engines may use a vendor-hosted recognition service; Doctor's Diary's
        narrower promise is only that DD itself does not store the audio.
      */}
      {state === "recording" && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          Speech is transcribed by your browser&rsquo;s speech service. No audio is stored by
          Doctor&rsquo;s Diary, and nothing is added to the clinical record until you explicitly
          save or add it.
        </p>
      )}
    </div>
  );
}
