"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, CircleAlert, Loader2, Printer, Save } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { saveRxModulesAction } from "../rx-module-actions";
import {
  PATIENT_LEVEL_MODULES,
  RX_MODULE_LABEL,
  RX_MODULE_SOURCE,
  labelProblem,
  type RxModuleSetting,
} from "../rx-modules";

/**
 * WHAT YOUR PRESCRIPTION CONTAINS.
 *
 * Twelve sections, in the doctor's own order, each with two independent
 * questions and an optional heading of their own. The whole screen saves in ONE
 * write: reordering twelve sections must not be twelve clinical writes, and a
 * half-applied reorder is a state nobody asked for.
 *
 * THIS CHANGES FUTURE PRESCRIPTIONS ONLY. Every finalised prescription carries
 * its own frozen copy of these settings and is not affected by anything on this
 * screen — which the page says out loud, because "will this rewrite what I
 * already signed?" is the first thing a doctor should be able to answer.
 *
 * Order is moved with buttons rather than dragged. Drag-and-drop needs a mouse
 * or a long-press that fights scrolling on the phone this is often used on, and
 * every control here has to stay at 44px.
 */

type Draft = RxModuleSetting[];

export function RxModuleSettings({ initial }: { initial: Draft }) {
  const [rows, setRows] = React.useState<Draft>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  /**
   * Compared against what the server last confirmed, not a boolean flipped on
   * every keystroke — so undoing a change back to where it started correctly
   * stops offering to save it.
   */
  const [baseline, setBaseline] = React.useState<Draft>(initial);
  const dirty = React.useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(baseline),
    [rows, baseline],
  );

  /** Every heading problem, so the doctor sees all of them, not the first. */
  const labelErrors = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const r of rows) {
      const problem = labelProblem(r.printLabel ?? "");
      if (problem) out.set(r.module, problem);
    }
    return out;
  }, [rows]);

  function update(index: number, patch: Partial<RxModuleSetting>) {
    setSaved(false);
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    setSaved(false);
    setRows((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function save() {
    if (labelErrors.size > 0) return;
    setSaving(true);
    setError(null);
    const result = await saveRxModulesAction(
      rows.map((r) => ({
        module: r.module,
        useDuringConsultation: r.useDuringConsultation,
        showOnPrint: r.showOnPrint,
        printLabel: (r.printLabel ?? "").trim() === "" ? null : (r.printLabel ?? "").trim(),
      })),
    );
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    /**
     * The baseline moves only on a CONFIRMED save. A screen that cleared its
     * dirty state optimistically would tell the doctor their layout was stored
     * when it was not.
     */
    setBaseline(rows);
    setSaved(true);
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {rows.map((row, i) => (
          <li key={row.module}>
            <ModuleRow
              row={row}
              index={i}
              total={rows.length}
              problem={labelErrors.get(row.module) ?? null}
              busy={saving}
              onChange={(patch) => update(i, patch)}
              onMove={(d) => move(i, d)}
            />
          </li>
        ))}
      </ol>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
        >
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-2 flex flex-wrap items-center gap-3 rounded-glass glass-flat px-3 py-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty || labelErrors.size > 0}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          {saving ? "Saving…" : "Save layout"}
        </button>

        <p className="min-w-0 flex-1 text-[12px] text-ink-muted" aria-live="polite">
          {labelErrors.size > 0
            ? "Fix the headings above before saving."
            : dirty
              ? "Not saved yet."
              : saved
                ? "Saved. New prescriptions use this layout."
                : "Nothing to save."}
        </p>
      </div>
    </div>
  );
}

function ModuleRow({
  row,
  index,
  total,
  problem,
  busy,
  onChange,
  onMove,
}: {
  row: RxModuleSetting;
  index: number;
  total: number;
  problem: string | null;
  busy: boolean;
  onChange: (patch: Partial<RxModuleSetting>) => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const builtIn = RX_MODULE_LABEL[row.module];
  const patientLevel = PATIENT_LEVEL_MODULES.includes(row.module);
  const labelId = `label-${row.module}`;

  return (
    <SectionCard>
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <div className="flex shrink-0 flex-col">
          <MoveButton
            direction={-1}
            disabled={busy || index === 0}
            label={`Move ${builtIn} up`}
            onClick={() => onMove(-1)}
          />
          <MoveButton
            direction={1}
            disabled={busy || index === total - 1}
            label={`Move ${builtIn} down`}
            onClick={() => onMove(1)}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-[15px] font-semibold text-ink">
              {builtIn}
              {row.showOnPrint ? (
                <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] font-medium text-ink-secondary">
                  <Printer className="size-3" aria-hidden="true" />
                  prints
                </span>
              ) : null}
            </p>
            <p className="text-[12px] text-ink-muted">{RX_MODULE_SOURCE[row.module]}</p>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {/*
              PATIENT-LEVEL SECTIONS HAVE NOTHING TO WRITE HERE.

              Allergies and long-term medicines live on the patient's record and
              are edited there. Offering "Use while writing" would promise a
              consultation field that does not exist — and building one would be
              a SECOND place to record an allergy, which is how two places to
              record one clinical fact end up disagreeing.

              The stored value is left exactly as it is; nothing on this row
              changes it, so an existing setting is neither shown as something
              it is not nor quietly rewritten.
            */}
            {patientLevel ? (
              <p className="text-[13px] text-ink-secondary">
                Edited on the patient&rsquo;s record — there is nothing to write for this during a
                consultation.
              </p>
            ) : (
              <Check
                id={`use-${row.module}`}
                label="Use while writing"
                checked={row.useDuringConsultation}
                disabled={busy}
                onChange={(v) => onChange({ useDuringConsultation: v })}
              />
            )}
            <Check
              id={`print-${row.module}`}
              label="Print on the prescription"
              checked={row.showOnPrint}
              disabled={busy}
              onChange={(v) => onChange({ showOnPrint: v })}
            />
          </div>

          {/*
            PRINTING A PATIENT-LEVEL FACT FREEZES IT.

            A patient's allergy list changes after the prescription is signed.
            Printing it copies TODAY'S list onto the paper permanently, and the
            doctor should be told that before they turn it on — not discover it
            when an old prescription disagrees with the record.
          */}
          {patientLevel && row.showOnPrint ? (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-[12px] text-ink">
              Printing this copies the patient&rsquo;s current list onto the paper and keeps it
              there. Later changes to their record will not change a prescription already signed.
            </p>
          ) : null}

          {/*
            A section that prints but is never written stays empty — and an
            empty section is left off the paper entirely, so the doctor would
            see no effect and no explanation.
          */}
          {!patientLevel && row.showOnPrint && !row.useDuringConsultation ? (
            <p className="rounded-xl bg-surface-muted px-3 py-2 text-[12px] text-ink-secondary">
              You have turned off writing this, so it will usually be empty — and an empty section
              is left off the paper rather than printed as a bare heading.
            </p>
          ) : null}

          {row.showOnPrint ? (
            <div>
              <label htmlFor={labelId} className="block text-[12px] font-medium text-ink-secondary">
                Heading on the prescription
              </label>
              <input
                id={labelId}
                type="text"
                value={row.printLabel ?? ""}
                disabled={busy}
                maxLength={80}
                placeholder={builtIn}
                onChange={(e) => onChange({ printLabel: e.target.value })}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `${labelId}-error` : undefined}
                className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-[14px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
              />
              {problem ? (
                <p id={`${labelId}-error`} role="alert" className="mt-1 text-[12px] text-[#a81c1c]">
                  {problem}
                </p>
              ) : (
                <p className="mt-1 text-[12px] text-ink-muted">
                  Leave it blank to print &ldquo;{builtIn}&rdquo;.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}

function MoveButton({
  direction,
  disabled,
  label,
  onClick,
}: {
  direction: -1 | 1;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === -1 ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex size-11 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 focus-visible:focus-ring"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

function Check({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 shrink-0 rounded border-hairline text-brand focus-visible:focus-ring"
      />
      <span className="text-[13px] font-medium text-ink">{label}</span>
    </label>
  );
}
