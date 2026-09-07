"use client";

import * as React from "react";
import { Check, ChevronDown, History, Loader2, X } from "lucide-react";
import type { RxResult } from "../actions";
import {
  newReuseIdempotencyKey,
  type PrescriptionReuseSource,
  type PrescriptionReuseSourceDetail,
} from "../m3-history";

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

export function PrescriptionReuse({
  prescriptionId,
  targetItemCount,
  disabled,
  onReuse,
}: {
  prescriptionId: string;
  targetItemCount: number;
  disabled: boolean;
  onReuse: (input: {
    sourcePrescriptionId: string;
    mode: "ALL" | "SELECTED";
    selectedItemIds?: string[];
    appendConfirmed: boolean;
    idempotencyKey: string;
  }) => Promise<RxResult | null>;
}) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [sources, setSources] = React.useState<PrescriptionReuseSource[]>([]);
  const [source, setSource] = React.useState<PrescriptionReuseSourceDetail | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [appendConfirmed, setAppendConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestKey = React.useRef<string | null>(null);

  async function loadSources() {
    setOpen(true);
    if (sources.length > 0) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/prescription-reuse?target=${encodeURIComponent(prescriptionId)}`, { cache: "no-store" });
      const body = (await response.json()) as { ok: boolean; sources?: PrescriptionReuseSource[]; message?: string };
      if (!body.ok) throw new Error(body.message || "Previous prescriptions could not be loaded.");
      setSources(body.sources ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Previous prescriptions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function choose(next: PrescriptionReuseSource) {
    setLoading(true);
    setError(null);
    setSource(null);
    setSelected(new Set());
    setAppendConfirmed(false);
    requestKey.current = null;
    try {
      const params = new URLSearchParams({ target: prescriptionId, source: next.prescriptionId });
      const response = await fetch(`/api/prescription-reuse?${params}`, { cache: "no-store" });
      const body = (await response.json()) as { ok: boolean; source?: PrescriptionReuseSourceDetail; message?: string };
      if (!body.ok || !body.source) throw new Error(body.message || "That prescription could not be verified.");
      setSource(body.source);
      setSelected(new Set(body.source.items.map((item) => item.itemId)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That prescription could not be verified.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(itemId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
    requestKey.current = null;
  }

  async function commit(mode: "ALL" | "SELECTED") {
    if (!source) return;
    if (mode === "SELECTED" && selected.size === 0) {
      setError("Select at least one medicine to reuse.");
      return;
    }
    if (targetItemCount > 0 && !appendConfirmed) {
      setError("Confirm that you want to append history to the medicines already on this prescription.");
      return;
    }
    setLoading(true);
    setError(null);
    requestKey.current ??= newReuseIdempotencyKey();
    const result = await onReuse({
      sourcePrescriptionId: source.prescriptionId,
      mode,
      selectedItemIds: mode === "SELECTED" ? [...selected] : undefined,
      appendConfirmed,
      idempotencyKey: requestKey.current,
    });
    setLoading(false);
    if (!result) {
      setError("Finish or cancel the medicine you are editing before reusing history.");
      return;
    }
    if (result.ok) {
      setOpen(false);
      setSource(null);
      setSources([]);
      requestKey.current = null;
      return;
    }
    if (result.kind === "error" || result.kind === "conflict") {
      setError(result.message);
      if (result.kind === "error") requestKey.current = null;
    } else {
      // Unknown/advanced outcomes are handled by the global coordinator; do not invite retry.
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => void loadSources()}
        className="dd-secondary inline-flex min-h-11 items-center gap-1.5 px-3.5 text-[13px] font-semibold disabled:opacity-50 focus-visible:focus-ring"
      >
        <History className="size-4" aria-hidden="true" />
        Reuse previous prescription
      </button>
    );
  }

  return (
    <section className="dd-material-panel dd-panel-pearl dd-panel-rim rounded-glass p-4" aria-label="Reuse previous prescription">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">Reuse signed prescription history</h3>
          <p className="mt-0.5 text-[11px] text-ink-muted">Nothing is copied until you choose the whole prescription or selected medicines and confirm.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-white/30 focus-visible:focus-ring" aria-label="Close history reuse"><X className="size-4" /></button>
      </div>

      {error ? <p role="status" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">{error}</p> : null}
      {loading ? <p className="mt-3 flex min-h-11 items-center gap-2 text-[12px] text-ink-muted"><Loader2 className="size-4 animate-spin" />Loading…</p> : null}

      {!source && !loading ? (
        <div className="mt-3 space-y-2">
          {sources.length === 0 ? <p className="text-[12px] text-ink-muted">No eligible finalized prescription history is available for this patient.</p> : sources.map((item) => (
            <button
              key={item.prescriptionId}
              type="button"
              onClick={() => void choose(item)}
              className="dd-material-record dd-record-pearl dd-record-interactive flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left focus-visible:focus-ring"
            >
              <History className="size-4 shrink-0 text-brand" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink">{dateLabel(item.finalizedAt)} · {item.itemCount} medicine{item.itemCount === 1 ? "" : "s"}</span>
                <span className="block text-[11px] text-ink-muted">{item.locationName ?? "Previous location"}{item.isCorrection ? " · corrected prescription" : ""}{item.isSuperseded ? " · superseded" : ""}</span>
              </span>
              <ChevronDown className="size-4 -rotate-90 text-ink-muted" />
            </button>
          ))}
        </div>
      ) : null}

      {source ? (
        <div className="mt-3 space-y-3">
          <button type="button" onClick={() => { setSource(null); setError(null); }} className="inline-flex min-h-11 items-center text-[12px] font-semibold text-brand hover:underline focus-visible:focus-ring">Choose another prescription</button>
          <div className="space-y-2">
            {source.items.map((item) => (
              <label key={item.itemId} className="dd-material-record dd-record-pearl flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl px-3 py-2.5">
                <input type="checkbox" checked={selected.has(item.itemId)} onChange={() => toggle(item.itemId)} className="mt-1 size-4 accent-[var(--color-brand)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink">{item.displayName}{item.strengthText ? ` ${item.strengthText}` : ""}</span>
                  <span className="block text-[11px] text-ink-secondary">{[item.doseText, item.scheduleText, item.durationText].filter(Boolean).join(" · ")}</span>
                </span>
              </label>
            ))}
          </div>

          {targetItemCount > 0 ? (
            <label className="flex min-h-11 items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-[12px] text-ink">
              <input type="checkbox" checked={appendConfirmed} onChange={(event) => { setAppendConfirmed(event.target.checked); requestKey.current = null; }} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
              <span>This prescription already has {targetItemCount} medicine{targetItemCount === 1 ? "" : "s"}. Append the reused medicines after them.</span>
            </label>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" disabled={loading || disabled} onClick={() => void commit("SELECTED")} className="dd-primary inline-flex min-h-11 items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:opacity-50 focus-visible:focus-ring"><Check className="size-4" />Reuse {selected.size} selected</button>
            <button type="button" disabled={loading || disabled} onClick={() => void commit("ALL")} className="dd-secondary inline-flex min-h-11 items-center justify-center px-4 text-[13px] font-semibold disabled:opacity-50 focus-visible:focus-ring">Reuse whole prescription</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
