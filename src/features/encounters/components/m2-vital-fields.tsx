"use client";

import * as React from "react";
import { Activity, ChevronDown } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { cn } from "@/lib/utils";
import { VITALS, type DraftKey, type DraftValues, type VitalField, type VitalKey } from "../schema";

const BY_KEY = new Map(VITALS.map((vital) => [vital.key, vital]));
const CORE: VitalKey[] = [
  "vitalTemperatureC",
  "vitalPulseBpm",
  "vitalSpo2",
  "vitalWeightKg",
];
const MORE: VitalKey[] = ["vitalHeightCm", "vitalRespRate"];

/**
 * M2 vitals: the numbers a doctor reaches for repeatedly stay visible; height
 * and respiratory rate remain one disclosure away. Nothing is prefilled and
 * every input is still the existing encounter vital field.
 */
export function M2VitalFields({
  values,
  dirtyKeys,
  errors,
  disabled,
  onChange,
  previous,
  shownBecauseFilled = false,
}: {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  errors: Partial<Record<VitalKey, string>>;
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  previous?: { heightCm: string | null; weightKg: string | null };
  shownBecauseFilled?: boolean;
}) {
  const pending = VITALS.filter((v) => dirtyKeys.includes(v.key)).length;
  const moreOpen = MORE.some(
    (key) => values[key] !== "" || dirtyKeys.includes(key) || Boolean(errors[key]),
  );

  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Vitals"
        icon={<Activity className="size-4" />}
        action={
          pending > 0 ? (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
              {pending} pending
            </span>
          ) : (
            <span className="text-[11px] text-ink-muted">Optional · blank means not recorded</span>
          )
        }
      />
      {shownBecauseFilled ? (
        <p className="border-b border-white/45 px-4 py-2 text-[11px] text-ink-muted sm:px-5">
          Shown because this visit already contains information.
        </p>
      ) : null}

      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <BloodPressure
            values={values}
            dirtyKeys={dirtyKeys}
            errors={errors}
            disabled={disabled}
            onChange={onChange}
          />
          {CORE.map((key) => (
            <VitalInput
              key={key}
              vital={BY_KEY.get(key)!}
              value={values[key]}
              dirty={dirtyKeys.includes(key)}
              error={errors[key]}
              disabled={disabled}
              previous={key === "vitalWeightKg" ? previous?.weightKg ?? null : null}
              onChange={onChange}
            />
          ))}
        </div>

        <details className="dd-material-record dd-record-pearl rounded-2xl" open={moreOpen || undefined}>
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-[13px] font-semibold text-ink focus-visible:focus-ring">
            <ChevronDown className="size-4 text-ink-muted" aria-hidden="true" />
            More vitals
            <span className="ml-auto text-[11px] font-normal text-ink-muted">Height · respiratory rate</span>
          </summary>
          <div className="grid grid-cols-2 gap-3 border-t border-white/45 p-3 sm:max-w-xl">
            {MORE.map((key) => (
              <VitalInput
                key={key}
                vital={BY_KEY.get(key)!}
                value={values[key]}
                dirty={dirtyKeys.includes(key)}
                error={errors[key]}
                disabled={disabled}
                previous={key === "vitalHeightCm" ? previous?.heightCm ?? null : null}
                onChange={onChange}
              />
            ))}
          </div>
        </details>
      </div>
    </SectionCard>
  );
}

function BloodPressure({
  values,
  dirtyKeys,
  errors,
  disabled,
  onChange,
}: {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  errors: Partial<Record<VitalKey, string>>;
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
}) {
  return (
    <fieldset className="col-span-2 min-w-0 lg:col-span-1">
      <legend className="text-[12px] font-semibold text-ink-secondary">Blood pressure <span className="font-normal text-ink-muted">mmHg</span></legend>
      <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
        <VitalBareInput
          vital={BY_KEY.get("vitalSystolic")!}
          label="Systolic"
          value={values.vitalSystolic}
          dirty={dirtyKeys.includes("vitalSystolic")}
          error={errors.vitalSystolic}
          disabled={disabled}
          onChange={onChange}
        />
        <span className="text-lg text-ink-muted" aria-hidden="true">/</span>
        <VitalBareInput
          vital={BY_KEY.get("vitalDiastolic")!}
          label="Diastolic"
          value={values.vitalDiastolic}
          dirty={dirtyKeys.includes("vitalDiastolic")}
          error={errors.vitalDiastolic}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
      {(errors.vitalSystolic || errors.vitalDiastolic) ? (
        <p role="status" className="mt-1 text-[11px] font-medium text-danger">
          {errors.vitalSystolic ?? errors.vitalDiastolic}
        </p>
      ) : null}
    </fieldset>
  );
}

function VitalInput({
  vital,
  value,
  dirty,
  error,
  disabled,
  previous,
  onChange,
}: {
  vital: VitalField;
  value: string;
  dirty: boolean;
  error?: string;
  disabled: boolean;
  previous: string | null;
  onChange: (key: DraftKey, value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={vital.key} className="flex items-baseline justify-between gap-1 text-[12px] font-semibold text-ink-secondary">
        <span className="truncate">{vital.label}</span>
        <span className="shrink-0 font-normal text-ink-muted">{vital.unit}</span>
      </label>
      <VitalBareInput
        vital={vital}
        label={vital.label}
        value={value}
        dirty={dirty}
        error={error}
        disabled={disabled}
        onChange={onChange}
        className="mt-1"
      />
      {error ? <p role="status" className="mt-1 text-[11px] font-medium text-danger">{error}</p> : null}
      {previous && value === "" ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(vital.key, previous)}
          className="mt-1 inline-flex min-h-11 items-center text-[11px] font-semibold text-brand hover:underline disabled:opacity-45 focus-visible:focus-ring"
        >
          Use previous {previous} {vital.unit}
        </button>
      ) : null}
    </div>
  );
}

function VitalBareInput({
  vital,
  label,
  value,
  dirty,
  error,
  disabled,
  onChange,
  className,
}: {
  vital: VitalField;
  label: string;
  value: string;
  dirty: boolean;
  error?: string;
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  className?: string;
}) {
  return (
    <input
      id={vital.key}
      name={vital.key}
      aria-label={label}
      type="number"
      inputMode="decimal"
      step={vital.step}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(vital.key, e.target.value)}
      aria-invalid={error ? true : undefined}
      className={cn(
        "h-11 w-full rounded-xl border bg-white/90 px-2.5 text-[15px] text-ink tabular-nums focus-visible:focus-ring disabled:bg-surface-muted",
        error ? "border-danger" : dirty ? "border-warning/70" : "border-hairline",
        className,
      )}
    />
  );
}
