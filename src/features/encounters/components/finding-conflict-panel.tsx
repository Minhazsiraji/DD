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
type Kind = FindingConflict["kind"];

const TITLE: Record<Kind, (noun: string) => string> = {
  changed: (n) => `This ${n} changed somewhere else`,
  removed: (n) => `This ${n} was removed somewhere else`,
  interrupted: (n) => `Your unfinished ${n} was not saved`,
  "removal-stale": (n) => `The ${n} was not removed`,
  "removal-changed": (n) => `That ${n} changed before it could be removed`,
  "removal-gone": (n) => `That ${n} was already removed`,
};

const BODY: Record<Kind, (noun: string) => string> = {
  changed: () => "Compare the two before choosing — nothing is merged for you.",
  removed: () =>
    "Someone deleted it while you were editing. What you typed is below and has not been lost.",
  interrupted: () =>
    "The consultation moved on before you finished. Your text is still in the form; carry on and add it when you are ready.",
  /**
   * A refused removal always asks again. The doctor agreed to delete a
   * particular finding; the record has moved since, so that agreement no
   * longer covers what is there now.
   */
  "removal-stale": (n) =>
    `The consultation changed before the delete went through, so nothing was removed. The ${n} is unchanged — confirm again if you still want it gone.`,
  "removal-changed": () =>
    "Nothing was removed. Someone edited it in the meantime, so read what is stored now before deciding again.",
  "removal-gone": () =>
    "Someone else deleted it first. Nothing more needs doing — it is already out of the record.",
};

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
            {TITLE[conflict.kind](noun)}
          </h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {BODY[conflict.kind](noun)}
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

      {/* What is stored NOW, so the second confirmation is an informed one. */}
      {conflict.kind === "removal-changed" || conflict.kind === "removal-stale" ? (
        <div className="mt-3 border-t border-hairline px-4 py-3 sm:px-5">
          <p className="text-[12px] font-semibold text-ink-secondary">Currently saved</p>
          <p className="mt-1 text-[15px] text-ink">
            {(conflict.kind === "removal-changed" ? conflict.theirs : conflict.base).title}
          </p>
          {conflict.kind === "removal-changed" && conflict.theirs.certainty ? (
            <p className="mt-0.5 text-[12px] font-semibold text-brand">
              {certaintyLabel(conflict.theirs.certainty)}
            </p>
          ) : null}
          {(conflict.kind === "removal-changed" ? conflict.theirs.note : conflict.base.note) ? (
            <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-secondary">
              {conflict.kind === "removal-changed" ? conflict.theirs.note : conflict.base.note}
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

        {/*
          A refused removal never deletes on acknowledgement. It restores the
          confirmation against the CURRENT finding, so the doctor presses
          Remove again knowing what is actually there.
        */}
        {conflict.kind === "removal-stale" || conflict.kind === "removal-changed" ? (
          <>
            <button type="button" onClick={() => onResolve("acknowledge")} className={primary}>
              Review it again
            </button>
            <button type="button" onClick={() => onResolve("discard")} className={secondary}>
              Keep it after all
            </button>
          </>
        ) : null}

        {conflict.kind === "removal-gone" ? (
          <button type="button" onClick={() => onResolve("acknowledge")} className={primary}>
            Understood
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
