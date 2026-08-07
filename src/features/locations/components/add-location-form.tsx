"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { addLocationAction } from "../actions";
import { emptyState } from "@/features/auth/schema";
import { Field, FormMessage, SubmitButton } from "@/features/auth/components/form-parts";

const TYPES = [
  { value: "PERSONAL_CHAMBER", label: "My own chamber" },
  { value: "CLINIC", label: "Clinic" },
  { value: "HOSPITAL", label: "Hospital" },
  { value: "TELEMEDICINE", label: "Telemedicine only" },
] as const;

export function AddLocationForm() {
  const [state, formAction] = useActionState(addLocationAction, emptyState);
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);

  // Reset and refresh the list once a clinic is added.
  React.useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state.ok, router]);

  if (!open) {
    return (
      <div className="border-t border-hairline p-4 sm:p-5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-brand bg-white px-4 text-sm font-semibold text-brand transition-[background-color,transform] duration-200 hover:bg-brand-soft active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a place you practise
        </button>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4 border-t border-hairline p-4 sm:p-5"
      noValidate
    >
      <Field label="Name" name="name" errors={state.fieldErrors?.name} />

      <div className="space-y-1.5">
        <label
          htmlFor="field-type"
          className="block text-[13px] font-medium text-ink"
        >
          Type
        </label>
        <select
          id="field-type"
          name="type"
          defaultValue="CLINIC"
          className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <Field label="Address" name="address" required={false} />
      <Field label="District" name="district" required={false} />
      <Field label="Phone" name="phone" type="tel" required={false} />

      <label className="flex items-center gap-2.5 text-[13px] text-ink">
        <input
          type="checkbox"
          name="makeActive"
          className="size-4 rounded border-hairline text-brand focus-visible:focus-ring"
        />
        Switch to this one now
      </label>

      <FormMessage state={state} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <SubmitButton>Add</SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}


