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

/**
 * Approving a prescription — the irreversible act.
 *
 * Two deliberate frictions, and neither is decoration:
 *
 *   1. the consequence is stated BEFORE the button, in the sentence a doctor is
 *      most likely to actually read;
 *   2. the button is not the confirmation. A single click cannot produce a
 *      permanent clinical record.
 *
 * The control renders only when the caller says every precondition holds — still
 * DRAFT, signature frozen where required, a fresh post-freeze bundle on screen,
 * and the digest shown below being exactly the one that will be submitted.
 */
/** The last finalisation attempt: what it was, and what to say about it. */
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
  /**
   * Every precondition the caller is responsible for: still DRAFT, signature
   * settled, and a FRESH post-freeze bundle on screen. False means the control
   * must not exist — not that it should be disabled.
   */
  ready: boolean;
  state: FinalizeState | null;
  busy: boolean;
  onFinalize: () => void;
  onRecover: () => void;
  onFreshReview: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const policy = state ? finalizePolicy(state.kind) : null;

  /**
   * Any attempt that is not an ordinary refusal takes the control away — which
   * is the entire safety design, expressed once.
   */
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

  /**
   * Not ready is not "disabled". A prescription that is pre-freeze, stale or no
   * longer a draft has no approval control at all — there is nothing to grey
   * out, because there is nothing that could be approved.
   */
  if (!ready) return null;

  return (
    <SectionCard>
      <div className="space-y-3 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-ink">Approve this prescription</h2>

        {/*
          Stated before the control, not inside a dialog the doctor has already
          decided to dismiss. "cannot be edited afterwards" is the part that
          changes behaviour.
        */}
        <p className="text-[13px] text-ink-secondary">
          This prescription will become part of the patient&rsquo;s clinical record and{" "}
          <strong className="font-semibold text-ink">cannot be edited afterwards</strong>. A
          correction requires a new prescription.
        </p>

        {state?.kind === "error" ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
          >
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            Nothing was approved. Try again, or reload if this keeps happening.
          </p>
        ) : null}

        {confirming ? (
          <div className="rounded-xl border border-hairline bg-surface-muted/60 p-3 sm:p-4">
            <p className="text-[15px] font-semibold text-ink">Finalize prescription?</p>
            <p className="mt-1 text-[13px] text-ink-secondary">
              You are approving exactly what is shown above. It goes onto the patient&rsquo;s record
              and cannot be edited afterwards.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onFinalize}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
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
                className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-55 focus-visible:focus-ring"
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
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            Finalize prescription
          </button>
        )}

      </div>
    </SectionCard>
  );
}

/**
 * What happened, and what may be done about it.
 *
 * Each outcome gets its own words. What every branch has in common is that NONE
 * offers Finalize again — recovery goes through a read, never a resubmit,
 * because a second approval would be a second permanent record.
 */
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

  const detail: Record<FinalizeKind, { title: string; action: string; run: () => void }> =
    {
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
        "clinical-surface rounded-glass-lg border-l-4 p-4 shadow-soft sm:p-5",
        committed ? "border-l-success" : "border-l-warning",
      )}
    >
      <div className="flex items-start gap-2.5">
        {committed ? (
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
        ) : kind === "finalization-unconfirmed" ? (
          <CloudAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        ) : (
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{shown.title}</h2>
          {/* The sentence comes from the SERVER, so screen and log agree. */}
          <p className="mt-1 text-[13px] text-ink-secondary">{state.message}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={shown.run}
        disabled={busy}
        className="mt-3 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover disabled:opacity-55 focus-visible:focus-ring"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        {busy ? "Checking…" : shown.action}
      </button>
    </div>
  );
}
