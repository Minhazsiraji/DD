"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";

/**
 * Controlled form controls for the template editor.
 *
 * Controlled on purpose: the A4 preview updates as the doctor types, and the
 * same value is what the form posts — so what they see is what gets saved.
 */

export function ToggleRow({
  label,
  hint,
  name,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  name: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = `toggle-${name}`;
  return (
    <div className={disabled ? "opacity-50" : undefined}>
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-1"
      >
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-ink">{label}</span>
          {hint ? <span className="block text-xs text-ink-muted">{hint}</span> : null}
        </span>
        <input
          id={id}
          type="checkbox"
          name={disabled ? undefined : name}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="size-5 shrink-0 rounded border-hairline text-brand focus-visible:focus-ring"
        />
      </label>
      {/*
        A disabled checkbox posts nothing, which the server would read as "off" —
        so switching the header off would quietly wipe every header setting
        underneath it. The hidden field preserves the choice for when it comes back.
      */}
      {disabled ? <input type="hidden" name={name} value={checked ? "on" : "off"} /> : null}
    </div>
  );
}

export function TextRow({
  label,
  name,
  value,
  onChange,
  hint,
  placeholder,
  maxLength,
  errors,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  errors?: string[];
}) {
  const id = `field-${name}`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={hasError || undefined}
        className={`h-11 w-full rounded-xl border bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:focus-ring ${
          hasError ? "border-danger" : "border-hairline"
        }`}
      />
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      {hasError ? (
        <p className="text-xs font-medium text-danger">{errors![0]}</p>
      ) : null}
    </div>
  );
}

export function SelectRow({
  label,
  name,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: string;
}) {
  const id = `field-${name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function NumberRow({
  label,
  name,
  value,
  onChange,
  min,
  max,
  unit,
  hint,
}: {
  label: string;
  name: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  unit: string;
  hint?: string;
}) {
  const id = `field-${name}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        <span className="text-[13px] tabular-nums text-ink-secondary">
          {value} {unit}
        </span>
      </div>
      {/*
        A slider AND steppers, because they fail in opposite directions: the
        slider is quick but imprecise — especially with a thumb on a phone —
        and "20 mm" versus "21 mm" is the kind of thing a doctor sets once and
        expects to hold. The steppers make an exact value reachable; the range
        keeps it inside the validated bounds either way.
      */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-hairline bg-white text-ink hover:bg-surface-muted disabled:opacity-40 focus-visible:focus-ring"
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>

        <input
          id={id}
          name={name}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-11 min-w-0 flex-1 accent-brand focus-visible:focus-ring"
        />

        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-hairline bg-white text-ink hover:bg-surface-muted disabled:opacity-40 focus-visible:focus-ring"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
