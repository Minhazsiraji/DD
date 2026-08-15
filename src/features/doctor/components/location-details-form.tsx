"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Lock } from "lucide-react";
import { emptyState } from "@/features/auth/schema";
import { Field, FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { updateLocationDetailsAction } from "../actions";
import type { LocationDetails } from "../queries";

const TYPES = [
  { value: "PERSONAL_CHAMBER", label: "My own chamber" },
  { value: "CLINIC", label: "Clinic" },
  { value: "HOSPITAL", label: "Hospital" },
  { value: "TELEMEDICINE", label: "Telemedicine only" },
  { value: "OTHER", label: "Other" },
] as const;

/**
 * Chamber contact details — the address and phone that print on a prescription
 * header. Expanded one at a time so a doctor with four locations is not shown
 * four identical forms at once.
 */
export function LocationDetailsForm({ location }: { location: LocationDetails }) {
  const [state, formAction] = useActionState(updateLocationDetailsAction, emptyState);
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  const summary = [location.address, location.district, location.phone]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="px-4 py-3.5 sm:px-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left focus-visible:focus-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{location.name}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">
            {summary || "No address or phone yet — it will be blank on your prescription"}
          </span>
        </span>
        {location.canEdit ? (
          <ChevronDown
            className={`size-4 shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        ) : (
          <Lock className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        )}
      </button>

      {!location.canEdit ? (
        <p className="mt-2 text-xs text-ink-muted">
          Someone else administers this place, so its details are theirs to
          change.
        </p>
      ) : null}

      {open && location.canEdit ? (
        <form action={formAction} className="mt-4 space-y-4" noValidate>
          <input type="hidden" name="locationId" value={location.id} />

          <Field
            label="Name"
            name="name"
            defaultValue={location.name}
            errors={state.fieldErrors?.name}
          />

          <div className="space-y-1.5">
            <label
              htmlFor={`type-${location.id}`}
              className="block text-[13px] font-medium text-ink"
            >
              Type
            </label>
            <select
              id={`type-${location.id}`}
              name="type"
              defaultValue={location.type}
              className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
            >
              {TYPES.map((t) => (
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
            defaultValue={location.address ?? ""}
            hint="Prints in the prescription header."
          />
          <Field
            label="District"
            name="district"
            required={false}
            defaultValue={location.district ?? ""}
          />
          <Field
            label="Chamber phone"
            name="phone"
            type="tel"
            required={false}
            defaultValue={location.phone ?? ""}
            hint="The number patients should call for an appointment here."
          />

          <FormMessage state={state} />

          <div className="sm:max-w-48">
            <SubmitButton>Save</SubmitButton>
          </div>
        </form>
      ) : null}
    </li>
  );
}
