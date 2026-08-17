"use client";

import * as React from "react";
import {
  Check, CircleAlert, CloudAlert, Loader2, Lock, Pill, Plus, RefreshCw, TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { ConsultationIdentity } from "@/features/encounters/components/consultation-identity";
import { UnsavedGuard } from "@/features/encounters/components/unsaved-guard";
import { usePrescription } from "../use-prescription";
import { RX_TITLE_UNKNOWN } from "../errors";
import type { PrescriptionDetail } from "../queries";
import { MedicineForm } from "./medicine-form";
import { MedicineList } from "./medicine-list";

/**
 * The prescription composer — a DRAFT workflow.
 *
 * Nothing here finalises. Review and approval are Stage 7C, and this screen
 * deliberately has no path to them: a composer that looks finished is not a
 * doctor's approval, and treating it as one is how a prescription gets signed
 * without being read.
 *
 * Every mutation carries the PRESCRIPTION's own version (ADR 0011 §1) and goes
 * through the accepted Stage 7A RPCs. The save states are Stage 6C's, reused
 * rather than relearned.
 */
export function PrescriptionComposer({
  prescription,
  locationName,
}: {
  prescription: PrescriptionDetail;
  locationName: string;
}) {
  const readOnly = prescription.status !== "DRAFT";
  const rx = usePrescription(
    prescription.id,
    prescription.version,
    prescription.items,
    readOnly,
  );

  const status = describe(rx.state, rx.busy, readOnly);

  return (
    <div className="space-y-4 pb-2">
      {/* An unfinished medicine is unsaved clinical text like any other. */}
      <UnsavedGuard dirty={rx.dirty && !readOnly} />

      {/*
        The same identity strip the consultation uses, not a second version of
        it. Allergies must read identically wherever a doctor is deciding what
        to give — this is the screen where getting that wrong does the damage.
      */}
      <ConsultationIdentity patient={prescription.patient} locationName={locationName} />

      {readOnly ? (
        <p
          role="status"
          className="clinical-surface flex items-center gap-2 rounded-glass px-4 py-3 text-[13px] font-medium text-ink-secondary"
        >
          <Lock className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          This prescription has been approved and can no longer be edited. A correction is a new
          prescription.
        </p>
      ) : null}

      {/*
        Refused, or unknown. Kept apart because the right response is opposite:
        one preserves the form below, the other closed it so the medicine
        cannot be entered a second time.
      */}
      {rx.state.kind === "conflict" || rx.state.kind === "unknown" ? (
        <div
          role="alert"
          className="clinical-surface rounded-glass-lg border-l-4 border-l-warning p-4 shadow-soft sm:p-5"
        >
          <div className="flex items-start gap-2.5">
            <CloudAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-ink">
                {rx.state.kind === "conflict"
                  ? "This prescription changed somewhere else"
                  : RX_TITLE_UNKNOWN}
              </h2>
              <p className="mt-1 text-[13px] text-ink-secondary">{rx.state.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void rx.resync()}
            disabled={rx.busy}
            className="mt-3 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover disabled:opacity-55 focus-visible:focus-ring"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {rx.busy ? "Loading…" : "Reload the prescription"}
          </button>
        </div>
      ) : null}

      <SectionCard>
        <SectionHeader
          title="Medicines"
          icon={<Pill className="size-4" />}
          count={rx.items.length}
          action={
            readOnly || rx.editor ? null : (
              <button
                type="button"
                onClick={rx.openAdd}
                disabled={rx.blocked}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
              >
                <Plus className="size-4" aria-hidden="true" />
                Add medicine
              </button>
            )
          }
        />

        <div className="space-y-3 p-4 sm:p-5">
          {rx.state.kind === "error" ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
            >
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
              {rx.state.message}
            </p>
          ) : null}

          {rx.items.length === 0 && !rx.editor ? (
            <p className="text-[13px] text-ink-muted">
              No medicines yet{readOnly ? "" : " — add the first one when you are ready"}.
            </p>
          ) : null}

          {rx.items.length > 0 ? <MedicineList rx={rx} readOnly={readOnly} /> : null}

          {rx.editor?.mode === "add" ? (
            <MedicineForm
              value={rx.draft}
              busy={rx.busy}
              blocked={rx.blocked && !rx.busy}
              submitLabel="Add medicine"
              onChange={rx.setDraft}
              onSubmit={() => void rx.submit()}
              onCancel={rx.closeEditor}
              onApplySuggestion={rx.applySuggestion}
            />
          ) : null}
        </div>
      </SectionCard>

      {/*
        The status strip. Every medicine is saved to the record the moment it is
        added — there is no separate "save the prescription" step to forget, and
        no state here that claims more than it knows.
      */}
      <div
        data-print-hidden
        className="glass-strong sticky bottom-0 z-30 -mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-glass-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6"
      >
        <p
          role="status"
          aria-live="polite"
          className={cn("flex min-w-0 items-center gap-2 text-[13px] font-medium", status.tone)}
        >
          {status.icon}
          <span className="min-w-0">{status.text}</span>
        </p>
        <p className="text-[12px] text-ink-muted">
          {readOnly
            ? "Approved — part of the patient's permanent record."
            : "Draft — approval and printing come later."}
        </p>
      </div>
    </div>
  );
}

/**
 * Never claims more than is known.
 *
 * "Saved" appears only after the database returned a new version; a refusal
 * says the change was NOT saved; an unknown outcome says so plainly rather than
 * guessing in either direction.
 */
function describe(
  state: ReturnType<typeof usePrescription>["state"],
  busy: boolean,
  readOnly: boolean,
) {
  /**
   * An approved prescription is not "a saved draft". Nothing on this screen may
   * describe a signed record as work in progress.
   */
  if (readOnly) {
    return {
      icon: <Lock className="size-4 shrink-0" aria-hidden="true" />,
      text: "Approved. This prescription is now part of the record.",
      tone: "text-ink-secondary",
    };
  }
  if (busy || state.kind === "saving") {
    return {
      icon: <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />,
      text: "Saving…",
      tone: "text-ink-secondary",
    };
  }
  switch (state.kind) {
    case "saved":
      return {
        icon: <Check className="size-4 shrink-0" aria-hidden="true" />,
        text: "Draft saved.",
        tone: "text-success",
      };
    case "conflict":
      return {
        icon: <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />,
        text: "Not saved — this prescription changed elsewhere.",
        tone: "text-warning",
      };
    case "unknown":
      return {
        icon: <CloudAlert className="size-4 shrink-0" aria-hidden="true" />,
        text: "Your change may have been saved. Do not enter it again until this reloads.",
        tone: "text-warning",
      };
    case "error":
      return {
        icon: <CircleAlert className="size-4 shrink-0" aria-hidden="true" />,
        text: state.message,
        tone: "text-danger",
      };
    default:
      return {
        icon: <Check className="size-4 shrink-0" aria-hidden="true" />,
        text: "Draft saved.",
        tone: "text-ink-muted",
      };
  }
}
