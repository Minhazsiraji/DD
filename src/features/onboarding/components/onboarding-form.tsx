"use client";

import * as React from "react";
import { useActionState } from "react";
import { completeOnboardingAction } from "../actions";
import { emptyState } from "@/features/auth/schema";
import { Field, FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { Stethoscope, Building2 } from "lucide-react";

const CLINIC_TYPES = [
  { value: "PERSONAL_CHAMBER", label: "My own chamber" },
  { value: "CLINIC", label: "Clinic" },
  { value: "HOSPITAL", label: "Hospital" },
  { value: "TELEMEDICINE", label: "Telemedicine only" },
] as const;

export function OnboardingForm() {
  const [state, formAction] = useActionState(completeOnboardingAction, emptyState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <SectionCard className="overflow-hidden">
        <SectionHeader title="About you" icon={<Stethoscope className="size-4" />} />
        <div className="space-y-4 p-4 sm:p-5">
          <Field
            label="Qualification"
            name="qualification"
            required={false}
            hint="For example: MBBS, FCPS (Medicine)"
            errors={state.fieldErrors?.qualification}
          />
          <Field
            label="Specialization"
            name="specialization"
            required={false}
            errors={state.fieldErrors?.specialization}
          />
          <Field
            label="BMDC registration number"
            name="bmdcRegistrationNo"
            required={false}
            hint="Printed on your prescriptions later. You can add it now or in Settings."
            errors={state.fieldErrors?.bmdcRegistrationNo}
          />
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader
          title="Where you practise"
          icon={<Building2 className="size-4" />}
        />
        <div className="space-y-4 p-4 sm:p-5">
          <Field
            label="Name"
            name="locationName"
            hint="You can add more chambers and clinics later."
            errors={state.fieldErrors?.locationName}
          />

          <div className="space-y-1.5">
            <label
              htmlFor="field-locationType"
              className="block text-[13px] font-medium text-ink"
            >
              Type
            </label>
            <select
              id="field-locationType"
              name="locationType"
              defaultValue="PERSONAL_CHAMBER"
              className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
            >
              {CLINIC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <Field
            label="Address"
            name="address"
            required={false}
            errors={state.fieldErrors?.address}
          />
          <Field
            label="District"
            name="district"
            required={false}
            errors={state.fieldErrors?.district}
          />
          <Field
            label="Phone"
            name="phone"
            type="tel"
            required={false}
            errors={state.fieldErrors?.phone}
          />
        </div>
      </SectionCard>

      <FormMessage state={state} />
      <SubmitButton>Finish setup</SubmitButton>

      <p className="text-center text-xs text-ink-muted">
        You&apos;ll be both the doctor and the administrator of this chamber.
      </p>
    </form>
  );
}


