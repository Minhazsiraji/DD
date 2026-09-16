"use client";

import * as React from "react";
import { CircleAlert, Loader2, Mic, Square, Trash2, Check } from "lucide-react";
import { insertTranscript } from "../dictation";
import { normalizeClinicalTranscript } from "../normalize";
import { useDictation } from "../use-dictation";
import { useVoiceLanguage, VoiceLanguageControl } from "../voice-language";

export function M6ADictationReview({
  fieldLabel,
  value,
  disabled = false,
  onAccept,
}: {
  fieldLabel: string;
  value: string;
  disabled?: boolean;
  onAccept: (next: string) => void;
}) {
  const language = useVoiceLanguage();
  const [raw, setRaw] = React.useState("");
  const [edited, setEdited] = React.useState("");
  const [reviewing, setReviewing] = React.useState(false);

  const dictation = useDictation({
    language: language.lang === "bn-BD-mixed" ? "mixed" : language.providerLanguage,
    providerMode: "mock",
    onPreview: (text) => setRaw(text),
    onFinal: (text) => {
      const next = normalizeClinicalTranscript(text);
      setRaw(next.raw);
      setEdited(next.normalized);
      setReviewing(true);
    },
    onCancel: () => {
      setRaw("");
      setEdited("");
      setReviewing(false);
    },
  });

  const active = ["connecting", "listening", "finalizing"].includes(dictation.state);
  const failed = dictation.state === "error" || dictation.state === "provider-unavailable";

  function discard() {
    dictation.cancel();
    dictation.reset();
    setRaw("");
    setEdited("");
    setReviewing(false);
  }

  function accept() {
    const text = edited.trim();
    if (!text) return;
    onAccept(insertTranscript(value, text).text);
    setRaw("");
    setEdited("");
    setReviewing(false);
    dictation.reset();
  }

  return (
    <div className="mt-2 min-w-0 rounded-xl border border-hairline bg-white/55 p-2.5" data-m6a-dictation data-voice-mode="mock">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <VoiceLanguageControl disabled={disabled || active || reviewing} />
        {active ? (
          <>
            {dictation.state === "finalizing" ? (
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline px-3 text-[12px] font-semibold text-ink-secondary">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Finalizing
              </span>
            ) : (
              <button type="button" onClick={dictation.stop} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#a81c1c] px-3 text-[12px] font-semibold text-white focus-visible:focus-ring">
                <Square className="size-3.5 fill-current" aria-hidden="true" /> Stop
              </button>
            )}
            <button type="button" onClick={discard} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink focus-visible:focus-ring">
              <Trash2 className="size-4" aria-hidden="true" /> Discard
            </button>
          </>
        ) : reviewing ? null : (
          <button
            type="button"
            disabled={disabled}
            onClick={dictation.start}
            aria-label={`Dictate ${fieldLabel}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink-secondary hover:bg-surface-muted disabled:opacity-50 focus-visible:focus-ring"
          >
            <Mic className="size-4" aria-hidden="true" /> {failed ? "Try again" : "Dictate"}
          </button>
        )}
      </div>

      {active && raw ? (
        <p role="status" aria-live="polite" className="mt-2 break-words text-[12px] text-ink-secondary">
          <span className="font-semibold">Live transcript:</span> {raw}
        </p>
      ) : null}

      {failed && dictation.error ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{dictation.error}</span>
        </p>
      ) : null}

      {reviewing ? (
        <div className="mt-2 rounded-xl border border-brand/25 bg-white p-2.5" data-m6a-transcript-review>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">Review before adding</p>
          <p className="mt-1 text-[11px] text-ink-muted">Raw transcript is shown for comparison. Nothing is added to the clinical draft until Accept.</p>
          <p className="mt-2 break-words rounded-lg bg-surface-muted px-2.5 py-2 text-[12px] text-ink-secondary"><span className="font-semibold">Raw:</span> {raw}</p>
          <label className="mt-2 block text-[12px] font-semibold text-ink" htmlFor={`m6a-${fieldLabel.replace(/\W+/g, "-").toLowerCase()}`}>Editable transcript</label>
          <textarea
            id={`m6a-${fieldLabel.replace(/\W+/g, "-").toLowerCase()}`}
            rows={3}
            value={edited}
            onChange={(event) => setEdited(event.target.value)}
            className="mt-1 w-full resize-y rounded-xl border border-hairline bg-white px-3 py-2.5 text-[15px] leading-relaxed text-ink focus-visible:focus-ring"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={accept} disabled={!edited.trim()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-[12px] font-semibold text-white disabled:opacity-50 focus-visible:focus-ring">
              <Check className="size-4" aria-hidden="true" /> Accept
            </button>
            <button type="button" onClick={discard} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[12px] font-semibold text-ink focus-visible:focus-ring">
              <Trash2 className="size-4" aria-hidden="true" /> Discard
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[10px] text-ink-muted">Mock mode · no microphone audio or external provider is used in this M6A development candidate.</p>
      )}
    </div>
  );
}
