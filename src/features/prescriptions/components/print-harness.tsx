"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { PRINT_SCENARIOS } from "../print-fixtures";
import { toPrescriptionView } from "../prescription-view";
import { PrintSheet } from "./print-sheet";
import { ReviewSheet } from "./review-sheet";
import { UnsupportedSnapshot } from "./unsupported-snapshot";

/**
 * THE PERMANENT PRINT HARNESS — development only.
 *
 * It renders known bundles through the real renderer, so a change to the
 * prescription document can be SEEN before it reaches paper a patient carries.
 * The two-column layout, the page anchor and the pagination are all things that
 * look correct in a diff and wrong on A4; this is where that gets caught.
 *
 * IT TOUCHES NOTHING. No database, no Storage, no server action, no login state
 * — every scenario is a hand-written bundle in `print-fixtures.ts`. Running it
 * cannot create a record, and cannot leave anything behind.
 *
 * ONE SHEET IS PRINTABLE AT A TIME, deliberately: print hides every direct
 * child of `<body>` except `[data-print-only]`, so two mounted print sheets
 * would both go to the printer.
 */
export function PrintHarness() {
  const [selected, setSelected] = React.useState<string | null>(null);
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const active = PRINT_SCENARIOS.find((s) => s.id === selected) ?? null;
  const activeRender = active ? toPrescriptionView(active.bundle) : null;

  return (
    <div className="space-y-6 pb-10">
      <div data-print-hidden className="clinical-surface rounded-glass px-4 py-3 text-[13px]">
        <p className="font-semibold text-ink">Prescription print harness — development only.</p>
        <p className="mt-1 text-ink-secondary">
          Synthetic fixtures rendered through the real renderer. Nothing here reads or writes the
          database. Choose a scenario, then print to PDF and check the page count, the column
          continuation and the foot of every page.
        </p>
      </div>

      {PRINT_SCENARIOS.map((scenario) => {
        const render = toPrescriptionView(scenario.bundle);
        return (
          <section key={scenario.id} data-harness-scenario={scenario.id} className="space-y-2">
            <div data-print-hidden className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-ink">
                  {scenario.title}
                  <span className="ml-2 font-mono text-[11px] font-normal text-ink-muted">
                    schema {scenario.bundle.schemaVersion} ·{" "}
                    {render.ok ? render.view.renderer : "no renderer"}
                  </span>
                </h2>
                <p className="mt-0.5 max-w-[70ch] text-[13px] text-ink-secondary">
                  {scenario.purpose}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelected(scenario.id)}
                disabled={!render.ok}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
              >
                <Printer className="size-4" aria-hidden="true" />
                {selected === scenario.id ? "Loaded — press Print" : "Load for printing"}
              </button>
            </div>

            {render.ok ?
              <ReviewSheet view={render.view} />
            : <UnsupportedSnapshot found={render.found} />}
          </section>
        );
      })}

      {/*
        The selected sheet, portalled to be a direct child of <body> — the same
        placement the real print path uses, and the reason `display: none` on
        its siblings produces a document exactly as tall as the paper.
      */}
      {mounted && activeRender?.ok ?
        createPortal(
          <div data-print-only aria-hidden="true">
            <PrintSheet view={activeRender.view} />
          </div>,
          document.body,
        )
      : null}
    </div>
  );
}
