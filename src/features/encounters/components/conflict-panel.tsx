"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { SECTIONS, VITALS, type DraftValues, type DraftKey } from "../schema";

const LABEL: Record<string, string> = {
  ...Object.fromEntries(SECTIONS.map((s) => [s.key, s.label])),
  ...Object.fromEntries(VITALS.map((v) => [v.key, `${v.label} (${v.unit})`])),
};

/**
 * Two versions of one consultation, and a decision only the doctor can make.
 *
 * The database refused the save because someone else's landed first — another
 * tab, a phone, a second device. NOTHING is resolved automatically here: an
 * automatic merge of clinical prose produces sentences nobody wrote, and
 * last-write-wins silently deletes whichever set of notes lost the race.
 *
 * So both versions are shown, field by field, and the doctor chooses. Their
 * typed text is untouched throughout — it is still in the boxes behind this
 * panel, and neither button can lose it without them pressing it.
 */
export function ConflictPanel({
  message,
  mine,
  theirs,
  touched,
  onKeepMine,
  onTakeTheirs,
}: {
  message: string;
  mine: DraftValues;
  theirs: DraftValues;
  /** Fields typed into on THIS screen — the only ones "keep mine" asserts. */
  touched: ReadonlySet<DraftKey>;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  const differing = (Object.keys(LABEL) as DraftKey[]).filter(
    (key) => (mine[key] ?? "").trim() !== (theirs[key] ?? "").trim(),
  );

  return (
    <section
      aria-labelledby="conflict-title"
      className="clinical-surface rounded-glass-lg border-l-4 border-l-warning shadow-soft"
    >
      <div className="flex items-start gap-2.5 px-4 pt-4 sm:px-5">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="conflict-title" className="text-[15px] font-semibold text-ink">
            This consultation changed somewhere else
          </h2>
          <p className="mt-1 text-[13px] text-ink-secondary">{message}</p>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto border-t border-hairline">
        <table className="w-full min-w-[34rem] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-hairline bg-surface-muted">
              <th scope="col" className="px-4 py-2 font-semibold text-ink-secondary">
                Field
              </th>
              <th scope="col" className="px-4 py-2 font-semibold text-ink">
                On this screen
              </th>
              <th scope="col" className="px-4 py-2 font-semibold text-ink">
                Already saved
              </th>
              <th scope="col" className="px-4 py-2 font-semibold text-ink-secondary">
                If you keep yours
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {differing.map((key) => (
              <tr key={key} className="align-top">
                <th scope="row" className="px-4 py-2.5 text-left font-medium text-ink-secondary">
                  {LABEL[key]}
                </th>
                <td className="px-4 py-2.5 whitespace-pre-wrap text-ink">
                  {mine[key]?.trim() || <span className="text-ink-muted">— empty —</span>}
                </td>
                <td className="px-4 py-2.5 whitespace-pre-wrap text-ink">
                  {theirs[key]?.trim() || <span className="text-ink-muted">— empty —</span>}
                </td>
                {/*
                  Spelled out per field, because "keep mine" is not a blanket
                  overwrite: a section this screen never typed into keeps the
                  newer text, whichever button is pressed.
                */}
                <td className="px-4 py-2.5 text-[12px] font-medium text-ink-secondary">
                  {touched.has(key) ? "Yours is kept" : "Saved version is kept"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-hairline px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onKeepMine}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover focus-visible:focus-ring"
        >
          Keep what I typed
        </button>
        <button
          type="button"
          onClick={onTakeTheirs}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          Use the saved version
        </button>
      </div>

      {/*
        Said plainly, because "keep mine" sounds more destructive than it is:
        only the fields this screen actually typed into are re-sent. Anything
        the other device wrote elsewhere survives either way.
      */}
      <p className="px-4 pb-4 text-[12px] text-ink-muted sm:px-5">
        Keeping your text re-sends only the fields you typed into here; everything else takes the
        saved version. Using the saved version discards what you typed on this screen.
      </p>
    </section>
  );
}
