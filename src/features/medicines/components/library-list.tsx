"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Star, Archive, ArchiveRestore, Pencil, Pill } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import {
  setDoctorMedicineArchived,
  setDoctorMedicineFavorite,
} from "../actions";
import {
  SAVED_DEFAULTS_DISCLAIMER,
  SAVED_DEFAULTS_LABEL,
  sortLibrary,
  type DoctorMedicine,
} from "../medicine";
import { DefaultsForm } from "./defaults-form";

/**
 * The doctor's own library.
 *
 * The defaults on every row are labelled with `SAVED_DEFAULTS_LABEL` and
 * nothing else. They are this doctor's saved habit, shown back to them — not a
 * recommendation, and the page must never read as though Doctor's Diary has an
 * opinion about what anyone should take.
 */
export function LibraryList({
  rows,
  showArchived,
}: {
  rows: DoctorMedicine[];
  showArchived: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<DoctorMedicine | null>(null);
  const [changedAt, setChangedAt] = React.useState(0);
  const visible = sortLibrary(rows.filter((r) => r.isActive === !showArchived));

  /**
   * THE ONE PLACE THIS LIST RE-FETCHES, for every write in it.
   *
   * `revalidatePath` in a server action invalidates the SERVER cache; it does
   * not re-render a client component that never navigates. So a refresh is
   * needed — and WHERE it is issued turns out to matter more than that it is.
   *
   * Two earlier attempts looked correct and changed nothing on screen:
   * `router.refresh()` inside the sheet (saving unmounts the sheet in the same
   * tick, taking the scheduled refresh with it), and then the same call moved
   * up here but still invoked from inside the sheet's `useTransition` callback.
   * Archiving failed the same way from the row's own transition.
   *
   * An effect runs after the commit, from a component that stays mounted,
   * outside any transition. `changedAt` is a counter rather than a boolean so
   * a second write re-triggers it.
   *
   * The write was NEVER the problem: the database held the new value every
   * time while the row on screen showed the old one. That is the failure mode
   * worth three attempts — a doctor who believes a save failed saves again, and
   * one who believes an archive failed presses Archive again.
   */
  React.useEffect(() => {
    if (changedAt > 0) router.refresh();
  }, [changedAt, router]);

  if (visible.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          icon={<Pill className="size-6" aria-hidden="true" />}
          title={showArchived ? "Nothing archived" : "No saved medicines yet"}
          description={
            showArchived
              ? "Medicines you remove from your library are kept here, with their defaults, so you can restore them."
              : "Find a medicine under All Medicines and add it — then save the dose, schedule and duration you normally write."
          }
        />
      </SectionCard>
    );
  }

  return (
    <>
      <p className="text-xs text-ink-muted" data-medicine-defaults-disclaimer>
        {SAVED_DEFAULTS_DISCLAIMER}
      </p>

      <ul className="mt-3 grid min-w-0 gap-3" data-medicine-library-list>
        {visible.map((row) => (
          <LibraryRow
            key={row.id}
            row={row}
            onEdit={() => setEditing(row)}
            onChanged={() => setChangedAt(Date.now())}
          />
        ))}
      </ul>

      {editing ? (
        <DefaultsForm
          medicine={editing}
          onClose={() => setEditing(null)}
          /* Closing and refreshing are both this component's job — see the
             effect above for why the refresh cannot happen inside the sheet. */
          onSaved={() => {
            setEditing(null);
            setChangedAt(Date.now());
          }}
        />
      ) : null}
    </>
  );
}

function LibraryRow({
  row,
  onEdit,
  onChanged,
}: {
  row: DoctorMedicine;
  onEdit: () => void;
  /** A write landed. The PARENT re-fetches — see the effect in LibraryList. */
  onChanged: () => void;
}) {
  const [pending, start] = React.useTransition();
  const [favorite, setFavorite] = React.useState(row.isFavorite);

  const defaults = [
    row.defaultDoseText,
    row.defaultScheduleText,
    row.defaultDurationText,
    row.defaultFoodRelation,
  ].filter(Boolean);

  return (
    <li>
      <SectionCard className="min-w-0">
        <div className="grid min-w-0 gap-3 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="min-w-0">
            <p className="break-words text-[15px] font-semibold text-ink">
              {row.displayName}
            </p>
            {row.genericName && row.genericName !== row.displayName ? (
              <p className="mt-0.5 break-words text-sm text-ink-secondary">
                {row.genericName}
              </p>
            ) : null}
            {row.dosageForm ? (
              <p className="mt-0.5 text-xs text-ink-muted">{row.dosageForm}</p>
            ) : null}

            {defaults.length > 0 ? (
              <div className="mt-3 rounded-xl bg-surface-muted px-3 py-2">
                {/*
                  The label is a constant, not a string typed here. "My saved
                  defaults" is a claim about the doctor's own past behaviour and
                  is true; "recommended dose" would be a clinical claim we have
                  no source for.
                */}
                <p className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                  {SAVED_DEFAULTS_LABEL}
                </p>
                <p className="mt-1 break-words text-sm text-ink tabular-nums">
                  {defaults.join(" · ")}
                  {row.defaultIsPrn ? " · PRN" : ""}
                </p>
                {row.defaultInstructions ? (
                  <p className="mt-1 break-words text-sm text-ink-secondary">
                    {row.defaultInstructions}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                No defaults saved yet.
              </p>
            )}

            {row.usageCount > 0 ? (
              <p className="mt-2 text-xs text-ink-muted tabular-nums">
                Used {row.usageCount} {row.usageCount === 1 ? "time" : "times"}
              </p>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 md:w-auto md:flex-nowrap">
            {row.isActive ? (
              <button
                type="button"
                aria-pressed={favorite}
                aria-label={favorite ? "Remove from favourites" : "Mark as favourite"}
                disabled={pending}
                onClick={() => {
                  const next = !favorite;
                  setFavorite(next);
                  start(async () => {
                    const r = await setDoctorMedicineFavorite(row.id, next);
                    // Put the star back if the write did not land, rather than
                    // leaving the screen claiming something the record denies.
                    if (!r.ok) setFavorite(!next);
                    // Favourites sort first, so the ORDER is stale until the
                    // server component re-renders.
                    else onChanged();
                  });
                }}
                data-medicine-favorite
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-hairline text-ink-muted transition-colors hover:bg-surface-muted focus-visible:focus-ring disabled:opacity-60"
              >
                <Star
                  className={favorite ? "size-4 fill-brand text-brand" : "size-4"}
                  aria-hidden="true"
                />
              </button>
            ) : null}

            {row.isActive ? (
              <button
                type="button"
                onClick={onEdit}
                data-medicine-edit
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-hairline px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
              >
                <Pencil className="size-4" aria-hidden="true" />
                Edit defaults
              </button>
            ) : null}

            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await setDoctorMedicineArchived(row.id, row.isActive);
                  // An archived row must LEAVE the active list. Without this
                  // it sits there looking un-archived, and the doctor presses
                  // Archive again.
                  if (r.ok) onChanged();
                })
              }
              data-medicine-archive
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-hairline px-4 text-sm font-semibold text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:focus-ring disabled:opacity-60"
            >
              {row.isActive ? (
                <>
                  <Archive className="size-4" aria-hidden="true" />
                  Archive
                </>
              ) : (
                <>
                  <ArchiveRestore className="size-4" aria-hidden="true" />
                  Restore
                </>
              )}
            </button>
          </div>
        </div>
      </SectionCard>
    </li>
  );
}
