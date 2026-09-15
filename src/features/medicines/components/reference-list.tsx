"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Pill, Loader } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { addDoctorMedicine } from "../actions";
import {
  draftFromReference,
  findSaved,
  provenanceLines,
  type DoctorMedicine,
  type MedicineReference,
} from "../medicine";

/**
 * The shared catalogue, as a list of what a medicine IS.
 *
 * Every row shows its own provenance. A doctor deciding whether to trust an
 * entry needs to know where it came from and whether anyone has checked it
 * lately, and "unverified" is stated rather than left to be inferred from a
 * blank space.
 */
export function ReferenceList({
  results,
  library,
  query,
}: {
  results: MedicineReference[];
  library: DoctorMedicine[];
  query: string;
}) {
  if (!query) {
    return (
      <SectionCard>
        <EmptyState
          icon={<Pill className="size-6" aria-hidden="true" />}
          title="Search the medicine catalogue"
          description="Find a medicine by generic name, brand or strength, then save your own defaults for it."
        />
      </SectionCard>
    );
  }

  if (results.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          icon={<Pill className="size-6" aria-hidden="true" />}
          title="Not in the catalogue"
          /*
            The honest answer, and the safe one. We will not offer a
            similar-looking molecule to fill the silence — a doctor who wanted
            Metformin must not be shown Metronidazole because the letters
            nearly line up.
          */
          description="No medicine matches that exactly. You can still add it to My Medicines yourself — the catalogue does not limit what you can prescribe."
        />
      </SectionCard>
    );
  }

  return (
    <ul className="grid min-w-0 gap-3" data-medicine-reference-list>
      {results.map((m) => (
        <ReferenceRow key={m.id} medicine={m} saved={findSaved(library, m)} />
      ))}
    </ul>
  );
}

function ReferenceRow({
  medicine,
  saved,
}: {
  medicine: MedicineReference;
  saved: DoctorMedicine | undefined;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [added, setAdded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isSaved = Boolean(saved) || added;
  const provenance = provenanceLines(medicine);

  function add() {
    setError(null);
    start(async () => {
      const result = await addDoctorMedicine({
        ...draftFromReference(medicine),
        medicineReferenceId: medicine.id,
      });
      if (result.ok) {
        // Local state answers this row immediately; the refresh is for the
        // "My Medicines (n)" count and the saved state of every OTHER row.
        setAdded(true);
        router.refresh();
      } else {
        setError(result.message ?? "That did not save.");
      }
    });
  }

  return (
    <li>
      <SectionCard className="min-w-0">
        <div className="grid min-w-0 gap-3 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <p className="break-words text-[15px] font-semibold text-ink">
              {medicine.brandName ?? medicine.genericName}
              {medicine.strengthText ? (
                <span className="tabular-nums"> {medicine.strengthText}</span>
              ) : null}
            </p>

            {/* The molecule is never hidden behind the brand. */}
            {medicine.brandName ? (
              <p className="mt-0.5 break-words text-sm text-ink-secondary">
                {medicine.genericName}
              </p>
            ) : null}

            {/*
              FACTS ONLY, and no regulator here.

              Built by filtering and joining, not by prefixing each part with a
              separator: a leading "·" is what you get when the first optional
              field is absent, and it reads as a missing value rather than as a
              medicine with fewer facts recorded.

              The regulator used to sit at the end of this list — "Tablet · BD ·
              DGDA" — which put an authority beside the facts and read as
              attribution. It has its own line below, where it can say what it
              actually means.
            */}
            <p className="mt-1 break-words text-xs text-ink-muted">
              {[medicine.dosageForm, medicine.manufacturer, medicine.countryCode]
                .filter(Boolean)
                .join(" · ")}
            </p>

            {/*
              Provenance, always stated. `last_verified_at` being null is a
              fact about this row, not a gap to paper over: an entry nobody has
              checked should not look like one somebody has.
            */}
            <p className="mt-1 break-words text-xs text-ink-muted" data-medicine-provenance>
              {provenance.source}
            </p>

            {provenance.regulator ? (
              <p
                className="mt-0.5 break-words text-xs text-ink-muted"
                data-medicine-regulator
              >
                {provenance.regulator}
              </p>
            ) : null}
          </div>

          <div className="min-w-0 md:w-auto">
            {isSaved ? (
              <p
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-hairline px-4 text-sm font-semibold text-ink-secondary md:w-auto"
                data-medicine-saved
              >
                <Check className="size-4" aria-hidden="true" />
                In My Medicines
              </p>
            ) : (
              <button
                type="button"
                onClick={add}
                disabled={pending}
                data-medicine-add
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring disabled:opacity-60 md:w-auto"
              >
                {pending ? (
                  <Loader className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                Add to My Medicines
              </button>
            )}
          </div>
        </div>

        {error ? (
          <p role="alert" className="border-t border-hairline px-4 py-3 text-sm text-danger sm:px-5">
            {error}
          </p>
        ) : null}
      </SectionCard>
    </li>
  );
}
