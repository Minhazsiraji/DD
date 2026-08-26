import * as React from "react";
import type { ModularView } from "../modular-view";
import {
  MedicineList,
  PatientIdentity,
  PrescriptionFooter,
  PrescriptionHeader,
  SignatureBlock,
  type Units,
} from "./prescription-parts";
import { SectionBlock } from "./section-parts";

/**
 * THE V4 DOCUMENT — Prescription V2, on a Bangladesh chamber pad.
 *
 *     ┌──────────────────────────────────────────────┐
 *     │ doctor · chamber                             │
 *     ├──────────────────────────────────────────────┤
 *     │ patient · age/sex · id · date                │
 *     ├───────────────┬──────────────────────────────┤
 *     │ the doctor's  │ Rx                           │
 *     │ own modules,  │ the medicines                │
 *     │ in their own  │                              │
 *     │ order, under  │                              │
 *     │ their own     │                              │
 *     │ labels        │                              │
 *     ├───────────────┴──────────────────────────────┤
 *     │ signature · footer                           │
 *     └──────────────────────────────────────────────┘
 *
 * WHAT DECIDES WHAT
 *
 * The FROZEN SNAPSHOT decides which sections exist, their order, their labels
 * and their content. The LAYOUT TOKEN in that same snapshot decides which
 * column each lands in (`placeSections`). Today's module configuration decides
 * nothing at all — it is not read on this path, and a build that read it would
 * reprint signed prescriptions differently every time a doctor changed a
 * setting.
 *
 * WHY A TABLE AND NOT FLEX OR MULTI-COLUMN
 *
 * This band has to survive PAGE FRAGMENTATION. `column-count` reflows the two
 * columns into each other, which would run medicines into the clinical column;
 * a flex row fragments unevenly across engines. A two-cell table row is the one
 * construct browsers have paginated reliably since printing existed: each cell
 * continues on the next page in its own column, and nothing is duplicated.
 * Measured in Chromium through the print harness, not assumed.
 */
export function ModularDocument({
  view,
  u,
  signatureUrl,
}: {
  view: ModularView;
  u: Units;
  signatureUrl?: string | null;
}) {
  /**
   * Every module off, or every module empty: there is no clinical column to
   * draw. Printing an empty 34 mm strip with a rule down it would ask the
   * reader what is missing, so the medicines simply take the full width.
   */
  const hasColumns = view.left.length > 0 || view.right.length > 0;

  return (
    <>
      <PrescriptionHeader view={view} u={u} />
      <PatientIdentity view={view} u={u} />

      {/*
        The body takes the slack, exactly as in the v3 document, so a short
        prescription settles its signature at the foot of the page instead of
        stranding it mid-sheet.
      */}
      <div className="flex flex-1 flex-col">
        {hasColumns ?
          <div
            data-rx-columns={view.layout}
            style={{ display: "table", width: "100%", tableLayout: "fixed" }}
          >
            <div style={{ display: "table-row" }}>
              {/*
                THE CLINICAL COLUMN.

                Narrow on purpose: it carries short, scannable statements, and
                the prescription itself must dominate the page the way it does
                on a printed pad. `verticalAlign: top` is load-bearing — a table
                cell centres its content by default, which would float a short
                complaint into the middle of a long medicine list.
              */}
              <div
                data-rx-column="left"
                className="border-r border-ink/20"
                style={{
                  display: "table-cell",
                  width: "34%",
                  verticalAlign: "top",
                  paddingRight: u.mm(4),
                }}
              >
                {view.left.map((section) => (
                  <SectionBlock key={section.module} section={section} view={view} u={u} />
                ))}
              </div>

              <div
                data-rx-column="right"
                style={{ display: "table-cell", verticalAlign: "top", paddingLeft: u.mm(4) }}
              >
                <MedicineList view={view} u={u} />
                {view.right.map((section) => (
                  <SectionBlock key={section.module} section={section} view={view} u={u} />
                ))}
              </div>
            </div>
          </div>
        : <MedicineList view={view} u={u} />}
      </div>

      <SignatureBlock view={view} u={u} signatureUrl={signatureUrl} />
      <PrescriptionFooter view={view} u={u} />
    </>
  );
}
