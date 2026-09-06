"use client";

import * as React from "react";
import { Check, CircleAlert, Loader2, Pencil, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInstantTime } from "@/lib/format";
import type { SaveState } from "../draft-state";

/**
 * M2 autosave status. There is intentionally no routine "Save notes" action.
 * A button appears only after a definite save failure, where an explicit retry
 * is safer than silently looping against a failing connection or validation.
 */
export function SaveBar({
  state,
  dirtyCount,
  blocked,
  hasVitalErrors,
  onRetry,
}: {
  state: SaveState;
  dirtyCount: number;
  blocked: boolean;
  hasVitalErrors: boolean;
  onRetry: () => void;
}) {
  const status = describe(state, dirtyCount, blocked, hasVitalErrors);

  return (
    <div
      data-print-hidden
      data-mobile-save-bar
      className="dd-app-panel sticky bottom-0 z-30 -mx-4 mt-4 flex min-w-0 flex-col items-stretch gap-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:px-6"
    >
      <p
        role="status"
        aria-live="polite"
        className={cn("flex min-w-0 items-start gap-2 text-[13px] font-medium sm:items-center", status.tone)}
      >
        {status.icon}
        <span className="min-w-0 break-words">{status.text}</span>
      </p>

      {state.kind === "error" ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={blocked || hasVitalErrors}
          className="dd-secondary inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry save
        </button>
      ) : null}
    </div>
  );
}

function describe(
  state: SaveState,
  dirtyCount: number,
  blocked: boolean,
  hasVitalErrors: boolean,
) {
  if (state.kind === "saved" && dirtyCount > 0) {
    return describe({ kind: "dirty" }, dirtyCount, blocked, hasVitalErrors);
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
        text: `Not saved — ${state.message}`,
        tone: "text-danger",
      };
    case "conflict":
      return {
        icon: <TriangleAlert className="mt-px size-4 shrink-0 sm:mt-0" aria-hidden="true" />,
        text: "Not saved — choose which version to keep.",
        tone: "text-warning",
      };
    case "dirty":
      if (hasVitalErrors) {
        return {
          icon: <CircleAlert className="mt-px size-4 shrink-0 sm:mt-0" aria-hidden="true" />,
          text: "Changes pending — check the highlighted vitals before autosave can continue.",
          tone: "text-warning",
        };
      }
      return {
        icon: <Pencil className="mt-px size-4 shrink-0 sm:mt-0" aria-hidden="true" />,
        text: blocked
          ? "Changes pending — waiting for the current clinical update."
          : dirtyCount === 1
            ? "1 change pending — autosaving shortly…"
            : `${dirtyCount} changes pending — autosaving shortly…`,
        tone: "text-ink-secondary",
      };
    default:
      return {
        icon: <Check className="mt-px size-4 shrink-0 sm:mt-0" aria-hidden="true" />,
        text: "All changes saved",
        tone: "text-ink-muted",
      };
  }
}
