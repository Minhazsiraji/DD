"use client";

import * as React from "react";
import { useActionState } from "react";
import { Archive, ArchiveRestore, TriangleAlert, X } from "lucide-react";
import { archiveDocumentAction, restoreDocumentAction } from "../actions";
import { emptyDocumentState } from "../schema";

/**
 * Remove a document from the working record, and put it back.
 *
 * "Remove", never "Delete", because nothing is deleted: the row and the stored
 * file both survive (ADR 0015). The word has to match what actually happens, or
 * a doctor will either be afraid to use it or surprised by it.
 *
 * The reason is REQUIRED and the confirmation is inline rather than a dialog —
 * Base UI popups are strict about composition and a broken one in a list row
 * would take out the whole page. A disclosure that is just markup cannot.
 */
export function DocumentRowActions({
  documentId,
  archived,
  title,
}: {
  documentId: string;
  archived: boolean;
  title: string;
}) {
  const [asked, setAsked] = React.useState(false);
  const [archiveState, archive, archivePending] = useActionState(
    archiveDocumentAction,
    emptyDocumentState,
  );
  const [restoreState, restore, restorePending] = useActionState(
    restoreDocumentAction,
    emptyDocumentState,
  );

  /**
   * DERIVED, not closed by an effect.
   *
   * The confirmation disappears the moment the server accepts, and that is a
   * fact about the action's result — not a second piece of state to keep in
   * sync with it. Syncing it in an effect adds a render in which the form is
   * still open over a document that is already archived.
   */
  const confirming = asked && !archiveState.ok;

  if (archived) {
    return (
      <form action={restore} className="w-full sm:w-auto">
        <input type="hidden" name="documentId" value={documentId} />
        <button
          type="submit"
          disabled={restorePending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-hairline px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring disabled:opacity-60 sm:h-10 sm:w-auto"
        >
          <ArchiveRestore className="size-4" aria-hidden="true" />
          {restorePending ? "Restoring…" : "Put back"}
        </button>
        {restoreState.message && !restoreState.ok ? (
          <p className="mt-1.5 text-[13px] text-danger">{restoreState.message}</p>
        ) : null}
      </form>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setAsked(true)}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-hairline px-3 text-[13px] font-semibold text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink focus-visible:focus-ring sm:h-10 sm:w-auto"
      >
        <Archive className="size-4" aria-hidden="true" />
        Remove
      </button>
    );
  }

  return (
    <form
      action={archive}
      data-mobile-document-remove
      className="clinical-surface w-full min-w-0 rounded-glass border border-hairline p-3 sm:w-auto sm:min-w-[22rem]"
    >
      <input type="hidden" name="documentId" value={documentId} />

      <p className="flex items-start gap-2 text-[13px] font-semibold text-ink">
        <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="min-w-0 break-words">Remove “{title}” from the record?</span>
      </p>
      <p className="mt-1 text-[13px] text-ink-secondary">
        It is kept and can be put back. Say why, so the record can answer that
        question later.
      </p>

      <label htmlFor={`reason-${documentId}`} className="sr-only">
        Why this document is being removed
      </label>
      <input
        id={`reason-${documentId}`}
        name="reason"
        type="text"
        required
        maxLength={500}
        autoComplete="off"
        placeholder="e.g. attached to the wrong patient"
        /* text-base: a 16px font stops iOS zooming the page on focus. */
        className="mt-2.5 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-base text-ink placeholder:text-ink-muted focus-visible:focus-ring"
      />

      {archiveState.fieldErrors?.reason ? (
        <p className="mt-1.5 text-[13px] text-danger">{archiveState.fieldErrors.reason[0]}</p>
      ) : null}
      {archiveState.message && !archiveState.ok ? (
        <p className="mt-1.5 text-[13px] text-danger">{archiveState.message}</p>
      ) : null}

      <div className="mt-3 flex w-full flex-col items-stretch gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={archivePending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-danger px-4 text-[13px] font-semibold text-white transition-colors hover:opacity-90 focus-visible:focus-ring disabled:opacity-60 sm:w-auto"
        >
          <Archive className="size-4" aria-hidden="true" />
          {archivePending ? "Removing…" : "Remove"}
        </button>
        <button
          type="button"
          onClick={() => setAsked(false)}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-hairline px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:w-auto"
        >
          <X className="size-4" aria-hidden="true" />
          Keep it
        </button>
      </div>
    </form>
  );
}
