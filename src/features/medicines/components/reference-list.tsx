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
  if (results.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          icon={<Pill className="size-6" aria-hidden="true" />}
          title={query ? "Not in the catalogue" : "No catalogue medicines available"}
          description={
            query
              ? "No medicine matches that exactly. You can still add it to My Medicines yourself — the catalogue does not limit what you can prescribe."
              : "The shared reference catalogue is currently empty or unavailable. My Medicines remains separate."
          }
        />
      </SectionCard>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      {!query ? (
        <p className="text-sm text-ink-secondary" data-medicine-browse-helper>
          Browse the medicine catalogue or search by generic, brand or strength.
        </p>
      ) : null}
      <ul className="grid min-w-0 gap-3" data-medicine-reference-list>
        {results.map((m) => (
          <ReferenceRow key={m.id} medicine={m} saved={findSaved(library, m)} />
        ))}
      </ul>
    </div>
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

            <p className="mt-1 break-words text-xs text-ink-muted">
              {[medicine.dosageForm, medicine.manufacturer, medicine.countryCode]
                .filter(Boolean)
                .join(" · ")}
            </p>

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
