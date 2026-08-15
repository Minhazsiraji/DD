"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { emptyState } from "@/features/auth/schema";
import { Field, FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { updateDoctorProfileAction } from "../actions";
import type { DoctorIdentity } from "../queries";

/**
 * Doctor identity. Everything here prints on a prescription, which is why the
 * BMDC number carries a plain warning rather than a checkmark — the number is
 * typed by the doctor and verified by nobody (ADR 0003).
 */
export function ProfileForm({ identity }: { identity: DoctorIdentity }) {
  const [state, formAction] = useActionState(updateDoctorProfileAction, emptyState);
  const router = useRouter();

  React.useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <form action={formAction} className="space-y-4 p-4 sm:p-5" noValidate>
      <Field
        label="Full name"
        name="fullName"
        defaultValue={identity.fullName}
        autoComplete="name"
        errors={state.fieldErrors?.fullName}
        hint="Printed at the top of your prescription and under your signature."
      />

      <Field
        label="Qualifications"
        name="qualification"
        required={false}
        defaultValue={identity.qualification ?? ""}
        errors={state.fieldErrors?.qualification}
        hint="e.g. MBBS, FCPS (Medicine)"
      />

      <Field
        label="Specialty"
        name="specialization"
        required={false}
        defaultValue={identity.specialization ?? ""}
        errors={state.fieldErrors?.specialization}
        hint="e.g. Cardiology"
      />

      <Field
        label="Designation"
        name="designation"
        required={false}
        defaultValue={identity.designation ?? ""}
        errors={state.fieldErrors?.designation}
        hint="e.g. Associate Professor, Consultant"
      />

      <Field
        label="BMDC registration number"
        name="bmdcRegistrationNo"
        required={false}
        defaultValue={identity.bmdcRegistrationNo ?? ""}
        errors={state.fieldErrors?.bmdcRegistrationNo}
        hint="Doctor's Diary does not verify this with the Council — it prints exactly what you type."
      />

      <Field
        label="Your phone"
        name="phone"
        type="tel"
        required={false}
        defaultValue={identity.phone ?? ""}
        autoComplete="tel"
        errors={state.fieldErrors?.phone}
      />

      <Field
        label="Patient number prefix"
        name="patientNumberPrefix"
        defaultValue={identity.patientNumberPrefix}
        errors={state.fieldErrors?.patientNumberPrefix}
        hint={`Letters only. Your next patient will be ${identity.patientNumberPrefix}-${String(
          identity.patientNumberSeq + 1,
        ).padStart(6, "0")}. Changing this does not renumber existing patients.`}
      />

      <FormMessage state={state} />

      <div className="sm:max-w-48">
        <SubmitButton>Save details</SubmitButton>
      </div>
    </form>
  );
}
