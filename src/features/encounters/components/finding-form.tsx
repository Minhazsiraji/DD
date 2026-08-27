"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CERTAINTIES, CERTAINTY_HINT, CERTAINTY_LABEL } from "../list-schema";
import { enterOutcome } from "../finding-entry";
import type { FindingDraft, ListKind } from "../finding-types";

/**
 * The one form used to add a finding and to correct one.
 *
 * Two copies would be two places for the clear-the-note rule to drift, and that
 * rule is the reason the patch contract exists: emptying the note box CLEARS
 * it, which is a different instruction from leaving it alone.
 *
 * Nothing here is required except the title. A doctor mid-examination writes
 * "?dengue" and moves on.
 */
export function FindingForm({
  kind,
  value,
  busy,
  blocked = false,
  submitLabel,
  keepsGoing = false,
  refocusToken = 0,
  onChange,
  onSubmit,
  onCancel,
}: {
  kind: ListKind;
  value: FindingDraft;
  /** This form's own mutation is in flight. */
  busy: boolean;
  /**
   * Something else owns the encounter right now — another mutation in flight,
   * or an unresolved conflict. The typed text stays exactly where it is; only
   * the way to submit it closes, because submitting into a conflict the doctor
   * has not answered can only be refused.
   */
  blocked?: boolean;
  submitLabel: string;
  /** Adds only: the form stays open afterwards, so it says so. */
  keepsGoing?: boolean;
  /**
   * Bumped when a CONFIRMED add cleared this form for the next one. Saving
   * disables the input, and a disabled input is blurred by the browser — so
   * without this the doctor's cursor is gone after every add.
   */
  refocusToken?: number;
  onChange: (next: FindingDraft) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const id = React.useId();
  const isDiagnosis = kind === "diagnosis";
  const titleLabel = isDiagnosis ? "Diagnosis" : "Investigation";
  const canSubmit = value.title.trim().length > 0 && !busy && !blocked;
  const titleRef = React.useRef<HTMLInputElement>(null);

  /**
   * Take the cursor back after a confirmed add — from a LAYOUT EFFECT, never
   * from `requestAnimationFrame` or `setTimeout`. rAF does not fire in a tab
   * that is not compositing, and the failure is silent: the field clears and
   * the doctor's next word goes nowhere. Same rule Fast Entry Step 1 settled.
   *
   * Keyed on the token alone, so it fires exactly once per confirmed add and
   * never steals focus while the doctor is somewhere else on the screen.
   */
  React.useLayoutEffect(() => {
    if (refocusToken > 0) titleRef.current?.focus();
  }, [refocusToken]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className="space-y-3 rounded-xl border border-hairline bg-surface-muted/60 p-3 sm:p-4"
    >
      <div>
        <label htmlFor={`${id}-title`} className="text-[13px] font-medium text-ink-secondary">
          {titleLabel}
        </label>
        <input
          id={`${id}-title`}
          ref={titleRef}
          value={value.title}
          disabled={busy}
          autoComplete="off"
          /*
            ENTER ADDS, AND KEEPS GOING.

            Handled here rather than left to the form's implicit submission,
            because implicit submission cannot be told about an input method:
            a doctor composing Bangla or CJK presses Enter to CHOOSE A WORD,
            and that Enter belongs to the IME. `enterOutcome` decides; every
            outcome preventDefaults, so the browser never submits behind it.
          */
          onKeyDown={(e) => {
            const outcome = enterOutcome(
              {
                key: e.key,
                isComposing: e.nativeEvent.isComposing,
                keyCode: e.nativeEvent.keyCode,
                shiftKey: e.shiftKey,
              },
              { canSubmit },
            );
            if (outcome === "ignore") return;
            e.preventDefault();
            if (outcome === "submit") onSubmit();
          }}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder={isDiagnosis ? "Dengue fever" : "CBC with platelet count"}
          className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
        />
      </div>

      {isDiagnosis ? (
        <fieldset disabled={busy}>
          <legend className="text-[13px] font-medium text-ink-secondary">How certain</legend>
          {/*
            Radios, not a select: four options a doctor picks between constantly
            should be one tap, and the meaning of each is spelled out because
            "provisional" and "working" are used differently in different
            chambers.
          */}
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {CERTAINTIES.map((c) => (
              <label
                key={c}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-[13px] transition-colors",
                  value.certainty === c
                    ? "border-brand bg-brand-soft"
                    : "border-hairline bg-white hover:bg-surface-muted",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-certainty`}
                  value={c}
                  checked={value.certainty === c}
                  onChange={() => onChange({ ...value, certainty: c })}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{CERTAINTY_LABEL[c]}</span>
                  <span className="block text-[11px] text-ink-muted">{CERTAINTY_HINT[c]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div>
        <label htmlFor={`${id}-note`} className="text-[13px] font-medium text-ink-secondary">
          Note <span className="font-normal text-ink-muted">— optional</span>
        </label>
        <textarea
          id={`${id}-note`}
          rows={2}
          value={value.note}
          disabled={busy}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          placeholder={isDiagnosis ? "Platelets falling, review tomorrow" : "Fasting sample"}
          className="mt-1 w-full resize-y rounded-xl border border-hairline bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
        />
        {/* Says what emptying the box will do, because it is not obvious. */}
        <p className="mt-1 text-[11px] text-ink-muted">
          Emptying this removes the note.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-55 focus-visible:focus-ring"
          >
            {keepsGoing ? "Done" : "Cancel"}
          </button>
        ) : null}
      </div>

      {/*
        Said once, where the doctor is looking. The same sentence the medicine
        composer uses, because it is the same interaction — and a shortcut
        nobody is told about is a shortcut nobody uses.
      */}
      {keepsGoing ? (
        <p className="text-[11px] text-ink-muted">
          Only the {isDiagnosis ? "diagnosis" : "investigation"} is required. Press{" "}
          <kbd className="font-sans font-semibold">Enter</kbd> to add and keep going.
        </p>
      ) : null}
    </form>
  );
}
