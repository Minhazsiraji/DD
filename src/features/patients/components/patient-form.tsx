"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { UserPlus, TriangleAlert, ChevronDown, ChevronRight, Save } from "lucide-react";
import { createPatientAction, updatePatientAction, type PatientActionState } from "../actions";
import { Field, FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { SEXES, SEX_LABEL, BLOOD_GROUPS, BLOOD_GROUP_LABEL } from "../schema";
import { cn } from "@/lib/utils";

const initial: PatientActionState = { ok: false };

interface Defaults {
  patientId?: string;
  fullName?: string;
  phone?: string;
  sex?: string;
  bloodGroup?: string;
  approxAgeYears?: number | null;
  dob?: string | null;
  email?: string | null;
  address?: string | null;
  district?: string | null;
  weightKg?: string | null;
  heightCm?: string | null;
  notes?: string | null;
}

/**
 * New/edit patient.
 *
 * The fast path is four fields — name, age, sex, phone — because a chamber
 * registers a patient while they are standing at the desk. Everything else is
 * behind "More details" and can be filled in during the consultation.
 */
export function PatientForm({
  mode = "create",
  defaults = {},
  todayLocal,
}: {
  mode?: "create" | "edit";
  defaults?: Defaults;
  todayLocal?: string;
}) {
  const action = mode === "edit" ? updatePatientAction : createPatientAction;
  const [state, formAction] = useActionState(action, initial);
  const [showMore, setShowMore] = React.useState(mode === "edit");

  const duplicates = state.duplicates ?? [];

  /**
   * React resets an uncontrolled form once its action completes, so anything
   * the doctor typed is gone by the time a duplicate warning or a validation
   * error renders. The action echoes the submitted values back, and they take
   * precedence over the initial defaults here.
   */
  const submitted = state.values;
  const val = React.useCallback(
    (name: string, fallback?: string | number | null) =>
      submitted?.[name] ?? (fallback == null ? undefined : String(fallback)),
    [submitted],
  );

  /**
   * Derived, not synced. Mirroring these into state inside an effect causes a
   * cascading render on every action result; deriving gives the same behaviour
   * with one pass.
   */
  const [ageOverride, setAgeOverride] = React.useState<"AGE" | "DOB" | null>(null);
  const submittedAgeMode =
    submitted?.ageMode === "AGE" || submitted?.ageMode === "DOB"
      ? submitted.ageMode
      : null;
  const ageMode = ageOverride ?? submittedAgeMode ?? (defaults.dob ? "DOB" : "AGE");

  // Never leave a validation error hidden behind a collapsed section.
  const hasHiddenError = Boolean(
    state.fieldErrors &&
      ["email", "weightKg", "heightCm"].some((f) => state.fieldErrors?.[f]),
  );
  const detailsOpen = showMore || hasHiddenError;

  return (
    <form action={formAction} className="space-y-4 sm:space-y-5" noValidate>
      {mode === "edit" ? (
        <input type="hidden" name="patientId" value={defaults.patientId} />
      ) : null}
      <input type="hidden" name="ageMode" value={ageMode} />

      {/* ---- Possible duplicates. Warn, never block, never auto-merge. ---- */}
      {duplicates.length > 0 ? (
        <SectionCard className="overflow-hidden border-l-4 border-l-warning">
          <SectionHeader
            title="This may already be your patient"
            icon={<TriangleAlert className="size-4 text-warning" />}
          />
          <ul className="divide-y divide-hairline">
            {duplicates.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{d.fullName}</p>
                  <p className="text-xs text-ink-secondary tabular-nums">
                    <span className="font-mono">{d.patientNumber}</span>
                    {d.ageYears != null ? ` · ${d.ageYears}y` : ""} · {d.reason}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    d.confidence === "high"
                      ? "bg-danger-soft text-[#a81c1c]"
                      : d.confidence === "medium"
                        ? "bg-warning-soft text-[#8a3f07]"
                        : "bg-surface-muted text-ink-secondary",
                  )}
                >
                  {d.confidence}
                </span>
                <Link
                  href={`/patients/${d.id}`}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-brand hover:bg-brand-soft focus-visible:focus-ring"
                >
                  Use this patient
                </Link>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2.5 border-t border-hairline p-4 text-[13px] text-ink sm:p-5">
            <input
              type="checkbox"
              name="confirmedNotDuplicate"
              className="mt-0.5 size-4 shrink-0 rounded border-hairline text-brand focus-visible:focus-ring"
            />
            <span>
              I checked — this is a different person
              <span className="block text-xs text-ink-muted">
                Records are never merged automatically. Two people can share a name
                and a household phone.
              </span>
            </span>
          </label>
        </SectionCard>
      ) : null}

      {/* ---- Fast path ---- */}
      <SectionCard className="overflow-hidden">
        <SectionHeader title="Patient" icon={<UserPlus className="size-4" />} />
        <div className="space-y-4 p-4 sm:p-5">
          <Field
            label="Full name"
            name="fullName"
            autoComplete="off"
            defaultValue={val("fullName", defaults.fullName)}
            errors={state.fieldErrors?.fullName}
          />

          <div className="space-y-1.5">
            <span className="block text-[13px] font-medium text-ink">Age</span>
            <div
              role="radiogroup"
              aria-label="How is age recorded?"
              className="mb-2 inline-flex rounded-xl border border-hairline p-0.5"
            >
              {(["AGE", "DOB"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={ageMode === m}
                  onClick={() => setAgeOverride(m)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:focus-ring",
                    ageMode === m
                      ? "bg-brand text-white"
                      : "text-ink-secondary hover:text-ink",
                  )}
                >
                  {m === "AGE" ? "Approximate age" : "Exact date of birth"}
                </button>
              ))}
            </div>

            {ageMode === "AGE" ? (
              <>
                <input
                  id="field-approxAgeYears"
                  name="approxAgeYears"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={130}
                  defaultValue={val("approxAgeYears", defaults.approxAgeYears)}
                  aria-label="Approximate age in years"
                  className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-base text-ink focus-visible:focus-ring"
                />
                <p className="text-xs text-ink-muted">
                  Recorded as an estimate and aged forward automatically. Shown
                  with a “~” so it is never mistaken for an exact age.
                </p>
              </>
            ) : (
              <input
                id="field-dob"
                name="dob"
                type="date"
                max={todayLocal}
                defaultValue={val("dob", defaults.dob)}
                aria-label="Date of birth"
                className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-base text-ink focus-visible:focus-ring"
              />
            )}
            {state.fieldErrors?.approxAgeYears || state.fieldErrors?.dob ? (
              <p className="text-xs font-medium text-danger">
                {state.fieldErrors?.approxAgeYears?.[0] ?? state.fieldErrors?.dob?.[0]}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="field-sex" className="block text-[13px] font-medium text-ink">
                Sex
              </label>
              <select
                id="field-sex"
                name="sex"
                defaultValue={val("sex", defaults.sex) ?? "UNKNOWN"}
                className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-base text-ink focus-visible:focus-ring"
              >
                {SEXES.map((s) => (
                  <option key={s} value={s}>
                    {SEX_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Phone"
              name="phone"
              type="tel"
              required={false}
              defaultValue={val("phone", defaults.phone)}
              hint="Used to spot duplicates."
              errors={state.fieldErrors?.phone}
            />
          </div>
        </div>
      </SectionCard>

      {/* ---- Everything else ---- */}
      <SectionCard className="overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={detailsOpen}
          className="flex w-full items-center gap-2 px-4 py-3.5 text-left focus-visible:focus-ring sm:px-5"
        >
          {detailsOpen ? (
            <ChevronDown className="size-4 text-ink-muted" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4 text-ink-muted" aria-hidden="true" />
          )}
          <span className="text-[15px] font-semibold text-ink">More details</span>
          <span className="ml-auto text-xs text-ink-muted">
            Safety info, contact, address
          </span>
        </button>

        {detailsOpen ? (
          <div className="space-y-4 border-t border-hairline p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="field-bloodGroup"
                  className="block text-[13px] font-medium text-ink"
                >
                  Blood group
                </label>
                <select
                  id="field-bloodGroup"
                  name="bloodGroup"
                  defaultValue={val("bloodGroup", defaults.bloodGroup) ?? "UNKNOWN"}
                  className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-base text-ink focus-visible:focus-ring"
                >
                  {BLOOD_GROUPS.map((b) => (
                    <option key={b} value={b}>
                      {BLOOD_GROUP_LABEL[b]}
                    </option>
                  ))}
                </select>
              </div>
              <Field
                label="Weight (kg)"
                name="weightKg"
                type="number"
                required={false}
                defaultValue={val("weightKg", defaults.weightKg)}
                hint="Needed for weight-based dosing later."
              />
            </div>

            <Field label="Height (cm)" name="heightCm" type="number" required={false}
              defaultValue={val("heightCm", defaults.heightCm)} />

            {mode === "create" ? (
              <>
                <TextArea
                  name="allergies"
                  label="Allergies"
                  hint="One per line, or comma separated. These appear as a red banner on every screen."
                />
                <TextArea name="conditions" defaultValue={val("conditions")} label="Chronic conditions" />
                <TextArea
                  name="medications"
                  label="Current medicines (as reported)"
                  hint="What the patient says they take. Not a prescription."
                />
                <TextArea name="alerts" defaultValue={val("alerts")} label="Important alerts" />
              </>
            ) : null}

            <Field label="Email" name="email" type="email" required={false}
              defaultValue={val("email", defaults.email)} errors={state.fieldErrors?.email} />
            <Field label="Address" name="address" required={false}
              defaultValue={val("address", defaults.address)} />
            <Field label="District" name="district" required={false}
              defaultValue={val("district", defaults.district)} />

            {mode === "create" ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Emergency contact" name="emergencyContactName" required={false} defaultValue={val("emergencyContactName")} />
                <Field label="Their phone" name="emergencyContactPhone" type="tel" required={false} defaultValue={val("emergencyContactPhone")} />
                <Field label="Relationship" name="emergencyContactRelationship" required={false} defaultValue={val("emergencyContactRelationship")} />
              </div>
            ) : null}

            <TextArea name="notes" label="Notes" defaultValue={val("notes", defaults.notes) ?? ""} />
          </div>
        ) : null}
      </SectionCard>

      <FormMessage state={state} />

      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-10 lg:static">
        <SubmitButton>
          {mode === "edit" ? (
            <>
              <Save className="size-4" aria-hidden="true" />
              Save changes
            </>
          ) : (
            <>
              <UserPlus className="size-4" aria-hidden="true" />
              Register patient
            </>
          )}
        </SubmitButton>
      </div>
    </form>
  );
}

function TextArea({
  name,
  label,
  hint,
  defaultValue,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
}) {
  const id = `field-${name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={2}
        defaultValue={defaultValue}
        className="w-full rounded-xl border border-hairline bg-white px-3 py-2 text-base text-ink focus-visible:focus-ring"
      />
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}


