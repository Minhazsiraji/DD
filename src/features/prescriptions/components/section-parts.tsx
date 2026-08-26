import * as React from "react";
import type { ModularSection } from "../modular-view";
import type { DocumentChrome } from "../review-view";
import type { Units } from "./prescription-parts";

/**
 * ONE FROZEN MODULE, AS IT PRINTS.
 *
 * The heading is `section.label` — the doctor's own wording at the moment they
 * approved it, never `rx_module_label()` re-resolved today and never a constant
 * in this file. A doctor who renames a module changes tomorrow's prescriptions;
 * this one still says what it said.
 *
 * Three shapes, and the section itself declares which:
 *
 *     text   free prose, wrapped, never clipped, never shrunk
 *     list   diagnoses, tests, allergies — one line each, with an optional note
 *     pairs  vitals, compact and inline, each value carrying its own unit
 *
 * `section.module` is used ONLY as a data attribute for the print harness and
 * for placement. Nothing printed is chosen from it, so an unfamiliar module
 * still prints correctly under its own heading rather than vanishing.
 */
export function SectionBlock({
  section,
  view,
  u,
}: {
  section: ModularSection;
  view: DocumentChrome;
  u: Units;
}) {
  return (
    <section
      data-rx-section={section.module}
      /*
        `break-inside: avoid` keeps a short section whole. It is a REQUEST, not
        a guarantee — a section taller than a page still has to break, and the
        browser is right to break it rather than lose it.
      */
      style={{ marginTop: u.mm(3.5), breakInside: "avoid", pageBreakInside: "avoid" }}
    >
      <p
        className="font-semibold uppercase"
        style={{ fontSize: u.pt(view.baseFontPt * 0.78), letterSpacing: "0.04em" }}
      >
        {section.label}
      </p>

      <div style={{ marginTop: u.mm(1) }}>
        <SectionBody section={section} view={view} u={u} />
      </div>
    </section>
  );
}

function SectionBody({
  section,
  view,
  u,
}: {
  section: ModularSection;
  view: DocumentChrome;
  u: Units;
}) {
  switch (section.kind) {
    case "text":
      /**
       * Exactly as typed. Bangla, line breaks and long words all pass through:
       * wrapped, never truncated, never scaled down to fit.
       */
      return <p className="break-words whitespace-pre-wrap">{section.text}</p>;

    case "list":
      return (
        <ul>
          {section.items.map((item, i) => (
            <li
              key={i}
              className="flex"
              style={{ gap: u.mm(1.5), marginTop: u.mm(0.8), breakInside: "avoid" }}
            >
              <span aria-hidden="true">•</span>
              <span className="min-w-0 flex-1 break-words">
                {item.text}
                {/* Reasoning or detail — never a finding, and never a status. */}
                {item.note ? <span className="italic"> — {item.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      );

    case "pairs":
      /**
       * COMPACT AND INLINE, exactly as recorded.
       *
       * A measurement that was not taken is simply absent — no "BP —", which
       * would claim someone measured it and found nothing. The value string is
       * printed verbatim, units included: nothing here rounds, rescales or
       * reformats a clinical number.
       */
      return (
        <div className="flex flex-wrap" style={{ gap: `${u.mm(0.6)} ${u.mm(3)}` }}>
          {section.pairs.map((pair, i) => (
            <span key={i} className="whitespace-nowrap">
              <span style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>{pair.label} </span>
              <span className="font-semibold tabular-nums">{pair.value}</span>
            </span>
          ))}
        </div>
      );
  }
}
