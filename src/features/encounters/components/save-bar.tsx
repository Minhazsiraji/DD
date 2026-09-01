"use client";

import * as React from "react";
import { Check, CircleAlert, Loader2, Pencil, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInstantTime } from "@/lib/format";
import type { SaveState } from "../use-draft";

/**
 * The save state, said out loud. The bar remains sticky rather than fixed, so
 * the mobile visual viewport/keyboard can move it without a second overlay
 * fighting the browser keyboard.
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
      data-mobile-save-bar
      className="glass-strong sticky bottom-0 z-30 -mx-4 mt-4 flex min-w-0 flex-col items-stretch gap-2 border-t border-glass-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:px-6"
    >
      <p
        role="status"
        aria-live="polite"
        className={cn("flex min-w-0 items-start gap-2 text-[13px] font-medium sm:items-center", status.tone)}
      >
        {status.icon}
        <span className="min-w-0 break-words">{status.text}</span>
      </p>

      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:active:scale-100 focus-visible:focus-ring sm:w-auto"
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
  if (state.kind === "saved" && dirtyCount > 0) {
    return describe({ kind: "dirty" }, dirtyCount);
  }

  switch (state.kind) {
    case "saving":
      return {
        icon: <Loader2 className="mt-px size-4 shrink-0 animate-spin sm:mt-0" aria-hidden="true" />,
        text: "Saving…",
        tone: "text-ink-secondary",
      };
    case "saved":
      return {
        icon: <Check className="mt-px size-4 shrink-0 sm:mt-0" aria-hidden="true" />,
        text: `Saved at ${formatInstantTime(state.at)}`,
        tone: "text-success",
      };
    case "error":
      return {
        icon: <CircleAlert className="mt-px size-4 shrink-0 sm:mt-0" aria-hidden="true" />,
        text: state.message,
        tone: "text-danger",
      };
    case "conflict":
      return {
        icon: <TriangleAlert className="mt-px size-4 shrink-0 sm:mt-0" aria-hidden="true" />,
        text: "Not saved — choose which version to keep.",
        tone: "text-warning",
      };
    case "dirty":
      return {
        icon: <Pencil className="mt-px size-4 shrink-0 sm:mt-0" aria-hidden="true" />,
        text:
          dirtyCount === 1
            ? "1 unsaved change on this screen"
            : `${dirtyCount} unsaved changes on this screen`,
        tone: "text-ink-secondary",
      };
    default:
      return {
        icon: <Check className="mt-px size-4 shrink-0 sm:mt-0" aria-hidden="true" />,
        text: "No unsaved changes",
        tone: "text-ink-muted",
      };
  }
}
