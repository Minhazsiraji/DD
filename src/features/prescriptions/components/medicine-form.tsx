"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MEDICINE_FIELDS,
  type FieldSpec,
  type MedicineDraft,
  type MedicineField,
} from "../schema";

const MEDICINE_EDITOR_ORDER: readonly MedicineField[] = [
  "displayName", "strengthText", "doseText", "scheduleText", "durationText",
  "brandName", "genericName", "dosageForm", "route", "quantityText",
  "foodRelation", "instructions",
];
const MEDICINE_EDITOR_FIELDS = MEDICINE_EDITOR_ORDER.map((key) =>
  MEDICINE_FIELDS.find((field) => field.key === key),
).filter((field): field is FieldSpec => Boolean(field));

type MedicineVariantMatch = {
  key: string;
  label: string;
  source: "favorite" | "mine" | "catalogue";
  draft: MedicineDraft;
  manufacturer: string | null;
};

function variantSourceLabel(source: MedicineVariantMatch["source"]): string {
  if (source === "favorite") return "Favorite";
  if (source === "mine") return "My Medicines";
  return "Catalogue";
}

function spanClass(field: FieldSpec): string {
  if (field.key === "displayName") return "col-span-12 sm:col-span-6";
  if (field.key === "strengthText") return "col-span-6 sm:col-span-3";
  if (field.key === "doseText") return "col-span-6 sm:col-span-3";
  if (field.key === "scheduleText" || field.key === "durationText") {
    return "col-span-6 sm:col-span-3";
  }
  if (field.span === 12) return "col-span-12";
  if (field.span === 6) return "col-span-12 sm:col-span-6";
  if (field.span === 4) return "col-span-6 sm:col-span-4";
  return "col-span-6 sm:col-span-3";
}

export function MedicineForm({
  value,
  busy,
  blocked,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
  onApplySuggestion,
}: {
  value: MedicineDraft;
  busy: boolean;
  blocked: boolean;
  submitLabel: string;
  onChange: (next: MedicineDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onApplySuggestion: (s: MedicineDraft) => void;
}) {
  const id = React.useId();
  const canSubmit = value.displayName.trim() !== "" && !busy && !blocked;
  const [variantMatches, setVariantMatches] = React.useState<MedicineVariantMatch[]>([]);
  const [variantPending, setVariantPending] = React.useState(false);
  const [showVariants, setShowVariants] = React.useState(false);
  const query = value.displayName;

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setVariantPending(true);
      const params = new URLSearchParams({ scope: "all", q, limit: "10" });
      void fetch(`/api/m6e-medicine-lookup?${params.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as { matches?: MedicineVariantMatch[] };
          setVariantMatches(Array.isArray(body.matches) ? body.matches : []);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setVariantPending(false);
        });
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const visibleVariants = query.trim().length < 2 ? [] : variantMatches;
  const set = (key: keyof MedicineDraft, next: string | boolean) =>
    onChange({ ...value, [key]: next } as MedicineDraft);

  const primaryFields = MEDICINE_EDITOR_FIELDS.slice(0, 3);
  const remainingFields = MEDICINE_EDITOR_FIELDS.slice(3);

  const renderField = (field: FieldSpec) => {
    const isName = field.key === "displayName";
    return (
      <div key={field.key} className={cn(spanClass(field), "relative min-w-0")}>
        <label
          htmlFor={`${id}-${field.key}`}
          className="text-[12px] font-semibold text-ink-secondary"
        >
          {field.label}
        </label>
        {field.multiline ? (
          <textarea
            id={`${id}-${field.key}`}
            data-medicine-field={field.key}
            rows={2}
            value={value[field.key]}
            disabled={busy}
            onChange={(event) => set(field.key, event.target.value)}
            placeholder={field.placeholder}
            className="mt-1 w-full resize-y rounded-xl border border-hairline bg-white/90 px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
          />
        ) : (
          <input
            id={`${id}-${field.key}`}
            data-medicine-field={field.key}
            type="text"
            autoComplete="off"
            value={value[field.key]}
            disabled={busy}
            onChange={(event) => {
              set(field.key, event.target.value);
              if (isName) setShowVariants(true);
            }}
            onFocus={() => isName && setShowVariants(true)}
            onBlur={() => isName && window.setTimeout(() => setShowVariants(false), 180)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (canSubmit) onSubmit();
              }
              if (event.key === "Escape" && isName) setShowVariants(false);
            }}
            placeholder={field.placeholder}
            className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white/90 px-3 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
          />
        )}
        {field.hint ? <p className="mt-1 text-[10px] text-ink-muted">{field.hint}</p> : null}

        {field.options ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {field.options.map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy}
                onClick={() => set(field.key, value[field.key] === option ? "" : option)}
                className={cn(
                  "min-h-11 rounded-xl border px-2.5 text-[11px] disabled:opacity-55 focus-visible:focus-ring",
                  value[field.key] === option
                    ? "border-brand bg-brand-soft font-semibold text-brand"
                    : "border-hairline bg-white/70 text-ink-secondary hover:bg-white",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const variantPanel = showVariants && query.trim().length >= 2 ? (
    <div
      data-medicine-variant-panel
      className="mt-3 rounded-2xl border border-hairline bg-white/70 p-3 sm:p-4"
      role="region"
      aria-label="Available medicine variants"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-ink">Available medicine variants</p>
          <p className="mt-0.5 text-[10px] text-ink-muted">
            Exact matches from My Medicines and the shared medicine catalogue. Choose one to fill this staged form; nothing is added until you press Add medicine.
          </p>
        </div>
        {variantPending ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-ink-muted">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Searching...
          </span>
        ) : null}
      </div>

      {!variantPending && visibleVariants.length === 0 ? (
        <p className="mt-3 rounded-xl bg-surface-muted/70 px-3 py-2 text-[11px] text-ink-muted">
          No matching saved/catalogue variant found. You can keep the medicine name exactly as typed.
        </p>
      ) : null}

      {visibleVariants.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibleVariants.map((match) => (
            <button
              key={match.key}
              type="button"
              data-medicine-variant={match.key}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onApplySuggestion(match.draft);
                setShowVariants(false);
              }}
              className="min-h-16 rounded-xl border border-hairline bg-white/80 px-3 py-2 text-left hover:bg-white focus-visible:focus-ring"
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-semibold text-ink">{match.label}</span>
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[9px] font-semibold text-brand">
                  {variantSourceLabel(match.source)}
                </span>
              </span>
              <span className="mt-1 block text-[10px] text-ink-muted">
                {[match.draft.genericName, match.draft.dosageForm, match.manufacturer]
                  .filter(Boolean)
                  .join(" | ") || "Medicine reference"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <form
      data-medicine-form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className="dd-material-panel dd-panel-pearl dd-panel-rim space-y-4 rounded-glass p-3 sm:p-4"
    >
      <div data-medicine-editor-section>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[12px] font-semibold text-ink">Medicine details</p>
          <span className="text-[10px] text-ink-muted">
            medicine · strength · dose · schedule · duration · brand · generic · form · route · quantity · food · instructions
          </span>
        </div>
        <div className="grid grid-cols-12 gap-3">{primaryFields.map(renderField)}</div>
        {variantPanel}
        <div className="mt-3 grid grid-cols-12 gap-3">{remainingFields.map(renderField)}</div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[12px] text-ink">
            <input
              type="checkbox"
              checked={value.isPrn}
              disabled={busy}
              onChange={(event) => set("isPrn", event.target.checked)}
              className="size-4 accent-[var(--color-brand)]"
            />
            As needed (PRN)
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[12px] text-ink">
            <input
              type="checkbox"
              checked={value.substitutionAllowed}
              disabled={busy}
              onChange={(event) => set("substitutionAllowed", event.target.checked)}
              className="size-4 accent-[var(--color-brand)]"
            />
            Substitution allowed
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="submit"
          disabled={!canSubmit}
          className="dd-primary inline-flex min-h-11 items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
          {busy ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="dd-secondary inline-flex min-h-11 items-center justify-center px-4 text-[13px] font-semibold disabled:opacity-55 focus-visible:focus-ring"
        >
          Cancel
        </button>
        <p className="basis-full text-[10px] text-ink-muted">
          Medicine name is the only required field. Press Enter from a single-line field to add quickly.
        </p>
      </div>
    </form>
  );
}
