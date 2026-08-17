"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { certaintyLabel } from "../list-schema";
import type { FindingConflict } from "../finding-conflict";
import type { FindingDraft, FindingRow } from "../finding-types";

/**
 * A decision about a FINDING, asked as a question about that finding.
 *
 * The encounter's version boundary is shared, so a diagnosis edit can be
 * refused because a note moved — but the doctor is then owed a comparison of
 * the two DIAGNOSES, not of two examination notes. Answering a finding
 * conflict through the notes panel and then letting the stale finding through
 * is last-write-wins with an unrelated dialog in front of it.
 */
export function FindingConflictPanel({
  conflict,
  onResolve,
}: {
  conflict: FindingConflict;
  onResolve: (choice: "mine" | "theirs" | "discard" | "as-new" | "acknowledge") => void;
}) {
  const noun = conflict.list === "diagnosis" ? "diagnosis" : "investigation";

  return (
    <section
      aria-labelledby={`finding-conflict-${conflict.kind}-${conflict.list}`}
      className="clinical-surface rounded-glass-lg border-l-4 border-l-warning shadow-soft"
    >
      <div className="flex items-start gap-2.5 px-4 pt-4 sm:px-5">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0">
          <h2
            id={`finding-conflict-${conflict.kind}-${conflict.list}`}
            className="text-[15px] font-semibold text-ink"
          >
            {conflict.kind === "removed"
              ? `This ${noun} was removed somewhere else`
              : conflict.kind === "changed"
                ? `This ${noun} changed somewhere else`
                : `Your unfinished ${noun} was not saved`}
          </h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {conflict.kind === "removed"
              ? `Someone deleted it while you were editing. What you typed is below and has not been lost.`
              : conflict.kind === "changed"
                ? `Compare the two before choosing — nothing is merged for you.`
                : `The consultation moved on before you finished. Your text is still in the form; carry on and add it when you are ready.`}
          </p>
        </div>
      </div>

      {conflict.kind === "changed" ? (
        <Comparison mine={conflict.mine} theirs={conflict.theirs} list={conflict.list} />
      ) : null}

      {conflict.kind === "removed" ? (
        <div className="mt-3 border-t border-hairline px-4 py-3 sm:px-5">
          <p className="text-[12px] font-semibold text-ink-secondary">What you typed</p>
          <p className="mt-1 text-[15px] text-ink">{conflict.mine.title || "— empty —"}</p>
          {conflict.mine.note.trim() ? (
            <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-secondary">
              {conflict.mine.note}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-hairline px-4 py-3 sm:px-5">
        {conflict.kind === "changed" ? (
          <>
            <button type="button" onClick={() => onResolve("mine")} className={primary}>
              Keep my version
            </button>
            <button type="button" onClick={() => onResolve("theirs")} className={secondary}>
              Use the saved version
            </button>
          </>
        ) : null}

        {conflict.kind === "removed" ? (
          <>
            {/*
              Re-creating it under the old id would be a fiction — the row is
              gone. Adding it as a new finding is the honest equivalent, and it
              is still the doctor who presses Add afterwards.
            */}
            <button type="button" onClick={() => onResolve("as-new")} className={primary}>
              Add it as a new {noun}
            </button>
            <button type="button" onClick={() => onResolve("discard")} className={secondary}>
              Discard what I typed
            </button>
          </>
        ) : null}

        {conflict.kind === "interrupted" ? (
          <button type="button" onClick={() => onResolve("acknowledge")} className={primary}>
            Continue
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Comparison({
  mine,
  theirs,
  list,
}: {
  mine: FindingDraft;
  theirs: FindingRow;
  list: FindingConflict["list"];
}) {
  const rows: { label: string; mine: string; theirs: string }[] = [
    {
      label: list === "diagnosis" ? "Diagnosis" : "Investigation",
      mine: mine.title.trim(),
      theirs: theirs.title.trim(),
    },
  ];

  if (list === "diagnosis") {
    rows.push({
      label: "How certain",
      mine: certaintyLabel(mine.certainty),
      theirs: certaintyLabel(theirs.certainty ?? ""),
    });
  }

  rows.push({ label: "Note", mine: mine.note.trim(), theirs: (theirs.note ?? "").trim() });

  return (
    <div className="mt-3 overflow-x-auto border-t border-hairline">
      <table className="w-full min-w-[30rem] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-hairline bg-surface-muted">
            <th scope="col" className="px-4 py-2 font-semibold text-ink-secondary">Field</th>
            <th scope="col" className="px-4 py-2 font-semibold text-ink">Yours</th>
            <th scope="col" className="px-4 py-2 font-semibold text-ink">Already saved</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((row) => {
            const differs = row.mine !== row.theirs;
            return (
              <tr key={row.label} className="align-top">
                <th scope="row" className="px-4 py-2.5 text-left font-medium text-ink-secondary">
                  {row.label}
                </th>
                <td className={cellClass(differs)}>
                  {row.mine || <span className="text-ink-muted">— empty —</span>}
                </td>
                <td className={cellClass(differs)}>
                  {row.theirs || <span className="text-ink-muted">— empty —</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Differing rows carry weight AND a marker, never colour alone.
const cellClass = (differs: boolean) =>
  `px-4 py-2.5 whitespace-pre-wrap text-ink${differs ? " font-semibold" : ""}`;

const primary =
  "inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover focus-visible:focus-ring";
const secondary =
  "inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring";
