"use client";

import * as React from "react";
import { Check, CircleAlert, Loader2, Pencil, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInstantTime } from "@/lib/format";
import type { SaveState } from "../use-draft";

/**
 * The save state, said out loud.
 *
 * This bar exists because the alternative — a screen that looks the same
 * whether or not the work is stored — is the single most dangerous thing a
 * clinical editor can do. Every state below is distinguishable by ICON AND
 * TEXT, never by colour alone, and none of them lies:
 *
 *   clean     nothing to save, and we mean it
 *   dirty     changes exist only on this screen
 *   saving    in flight; not yet stored
 *   saved     stored, with the time it happened
 *   error     not stored, and the text is still here
 *   conflict  not stored, and there is a decision to make
 *
 * "Saved" is never shown optimistically. It appears only after the database
 * returns a new version.
 */
export function SaveBar({
  state,
  dirtyCount,
  disabled,
  onSave,
}: {
  state: SaveState;
  dirtyCount: number;
  disabled: boolean;
  onSave: () => void;
}) {
  const status = describe(state, dirtyCount);

  return (
    <div
      data-print-hidden
      className="glass-strong sticky bottom-0 z-30 -mx-4 mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-glass-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6"
    >
      {/*
        aria-live so a screen-reader user hears the outcome. polite, not
        assertive: it must not interrupt someone mid-sentence in a note.
      */}
      <p
        role="status"
        aria-live="polite"
        className={cn("flex min-w-0 items-center gap-2 text-[13px] font-medium", status.tone)}
      >
        {status.icon}
        <span className="min-w-0">{status.text}</span>
      </p>

      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:active:scale-100 focus-visible:focus-ring"
      >
        {state.kind === "saving" ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Saving…
          </>
        ) : (
          "Save notes"
        )}
      </button>
    </div>
  );
}

function describe(state: SaveState, dirtyCount: number) {
  switch (state.kind) {
    case "saving":
      return {
        icon: <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />,
        text: "Saving…",
        tone: "text-ink-secondary",
      };
    case "saved":
      return {
        icon: <Check className="size-4 shrink-0" aria-hidden="true" />,
        text: `Saved at ${formatInstantTime(state.at)}`,
        tone: "text-success",
      };
    case "error":
      return {
        icon: <CircleAlert className="size-4 shrink-0" aria-hidden="true" />,
        text: state.message,
        tone: "text-danger",
      };
    case "conflict":
      return {
        icon: <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />,
        text: "Not saved — choose which version to keep.",
        tone: "text-warning",
      };
    case "dirty":
      return {
        icon: <Pencil className="size-4 shrink-0" aria-hidden="true" />,
        text:
          dirtyCount === 1
            ? "1 unsaved change on this screen"
            : `${dirtyCount} unsaved changes on this screen`,
        tone: "text-ink-secondary",
      };
    default:
      return {
        icon: <Check className="size-4 shrink-0" aria-hidden="true" />,
        text: "No unsaved changes",
        tone: "text-ink-muted",
      };
  }
}
