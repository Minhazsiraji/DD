import * as React from "react";
import type { ModularView } from "../modular-view";
import {
  MedicineList,
  PatientIdentity,
  PrescriptionFooter,
  PrescriptionHeader,
  type Units,
} from "./prescription-parts";
import { SectionBlock } from "./section-parts";

/**
 * THE V4 DOCUMENT — Prescription V2, on a Bangladesh chamber pad.
 *
 *     ┌──────────────────────────────────────────────┐
 *     │ doctor · chamber                             │
 *     │ Doctor's Diary brand                         │
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
      <PrescriptionBrand u={u} />
      <PatientIdentity view={view} u={u} />

      <div className="flex flex-1 flex-col">
        {hasColumns ?
          <div
            data-rx-columns={view.layout}
            style={{ display: "table", width: "100%", tableLayout: "fixed" }}
          >
            <div style={{ display: "table-row" }}>
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
                <div aria-hidden="true" style={{ visibility: "hidden" }}>
                  <p className="font-serif italic" style={{ fontSize: u.pt(view.baseFontPt * 1.6) }}>
                    R<span style={{ fontSize: u.pt(view.baseFontPt) }}>x</span>
                  </p>
                  <div style={{ height: u.mm(2) }} />
                </div>
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

/** Owner-supplied canonical mark, printed directly with no background tile. */
function PrescriptionBrand({ u }: { u: Units }) {
  return (
    <div
      data-rx-brand="doctors-diary"
      className="flex items-center justify-center"
      style={{ marginBottom: u.mm(2.5) }}
      aria-label="Doctor's Diary"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/dd-logo-mark-canonical.webp"
        alt="Doctor's Diary"
        style={{ width: u.mm(17), height: u.mm(17), objectFit: "contain" }}
      />
    </div>
  );
}

/**
 * V4 layout correction only. The frozen signature image still comes from the
 * attested prescription bundle; this changes only its alignment on the current
 * print layout. Legacy v3 remains untouched. Keeping the component name
 * `SignatureBlock` preserves the document-composition invariant checked by the
 * renderer regression suite: the growing clinical body and one signature stay
 * siblings in the page column.
 */
function SignatureBlock({
  view,
  u,
  signatureUrl,
}: {
  view: ModularView;
  u: Units;
  signatureUrl?: string | null;
}) {
  if (view.signature.kind === "hidden") return null;

  return (
    <section
      data-rx-signature="centered"
      className="flex justify-center"
      style={{ marginTop: u.mm(10), breakInside: "avoid", pageBreakInside: "avoid" }}
    >
      <div className="text-center" style={{ width: u.mm(45) }}>
        {view.signature.kind === "frozen" && signatureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signatureUrl}
            alt="The signature fixed to this prescription"
            style={{
              height: u.mm(16),
              maxWidth: "100%",
              marginLeft: "auto",
              marginRight: "auto",
              marginBottom: u.mm(1),
              objectFit: "contain",
            }}
          />
        ) : (
          <div style={{ height: u.mm(16) }} aria-hidden="true" />
        )}
        <div className="border-t border-ink/40" style={{ width: "100%", marginBottom: u.mm(1) }} />
        <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>
          {view.header?.doctorName ?? "Signature"}
        </p>
      </div>
    </section>
  );
}
