"use client";

import * as React from "react";
import { CircleAlert, CloudAlert, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/common/section-card";
import { finalizePolicy, type FinalizeKind } from "../finalize-outcome";
import {
  RX_FINALIZE_ALREADY_TITLE,
  RX_FINALIZE_REJECTED_TITLE,
  RX_FINALIZE_STALE_TITLE,
  RX_FINALIZE_UNCONFIRMED_TITLE,
} from "../errors";

export interface FinalizeState {
  kind: FinalizeKind;
  message: string;
}

export function FinalizePanel({
  ready,
  state,
  busy,
  onFinalize,
  onRecover,
  onFreshReview,
}: {
  ready: boolean;
  state: FinalizeState | null;
  busy: boolean;
  onFinalize: () => void;
  onRecover: () => void;
  onFreshReview: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const policy = state ? finalizePolicy(state.kind) : null;

  if (state && policy && !policy.offersFinalize) {
    return (
      <FinalizeOutcomePanel
        state={state}
        busy={busy}
        onRecover={onRecover}
        onFreshReview={onFreshReview}
      />
    );
  }

  if (!ready) return null;

  return (
    <SectionCard>
      <div className="min-w-0 space-y-3 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-ink">Approve this prescription</h2>
        <p className="break-words text-[13px] text-ink-secondary">
          This prescription will become part of the patient&rsquo;s clinical record and{" "}
          <strong className="font-semibold text-ink">cannot be edited afterwards</strong>. A
          correction requires a new prescription.
        </p>

        {state?.kind === "error" ? (
          <p
            role="alert"
            className="flex min-w-0 items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
          >
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">Nothing was approved. Try again, or reload if this keeps happening.</span>
          </p>
        ) : null}

        {confirming ? (
          <div data-mobile-finalize-confirmation className="min-w-0 rounded-xl border border-hairline bg-surface-muted/60 p-3 sm:p-4">
            <p className="text-[15px] font-semibold text-ink">Finalize prescription?</p>
            <p className="mt-1 break-words text-[13px] text-ink-secondary">
              You are approving exactly what is shown above. It goes onto the patient&rsquo;s record
              and cannot be edited afterwards.
            </p>
            <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={onFinalize}
                disabled={busy}
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                {busy ? "Finalizing…" : "Finalize prescription"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
              >
                Keep reading
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            Finalize prescription
          </button>
        )}
      </div>
    </SectionCard>
  );
}

function FinalizeOutcomePanel({
  state,
  busy,
  onRecover,
  onFreshReview,
}: {
  state: FinalizeState;
  busy: boolean;
  onRecover: () => void;
  onFreshReview: () => void;
}) {
  const kind = state.kind;
  const policy = finalizePolicy(kind);
  const committed = policy.committed === "yes";

  const detail: Record<FinalizeKind, { title: string; action: string; run: () => void }> = {
    "review-stale": {
      title: RX_FINALIZE_STALE_TITLE,
      action: "Read the updated prescription",
      run: onFreshReview,
    },
    "conflict-rejected": {
      title: RX_FINALIZE_REJECTED_TITLE,
      action: "Read the updated prescription",
      run: onFreshReview,
    },
    "already-finalized": {
      title: RX_FINALIZE_ALREADY_TITLE,
      action: "Open the approved prescription",
      run: onRecover,
    },
    "finalization-unconfirmed": {
      title: RX_FINALIZE_UNCONFIRMED_TITLE,
      action: "Check whether it was approved",
      run: onRecover,
    },
    finalized: {
      title: "Approved",
      action: "Open the approved prescription",
      run: onRecover,
    },
    error: { title: "", action: "", run: onFreshReview },
  };

  const shown = detail[kind];

  return (
    <div
      role="alert"
      className={cn(
        "clinical-surface min-w-0 rounded-glass-lg border-l-4 p-4 shadow-soft sm:p-5",
        committed ? "border-l-success" : "border-l-warning",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {committed ? (
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
        ) : kind === "finalization-unconfirmed" ? (
          <CloudAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        ) : (
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <h2 className="break-words text-[15px] font-semibold text-ink">{shown.title}</h2>
          <p className="mt-1 break-words text-[13px] text-ink-secondary">{state.message}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={shown.run}
        disabled={busy}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        {busy ? "Checking…" : shown.action}
      </button>
    </div>
  );
}
