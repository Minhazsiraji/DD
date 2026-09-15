import * as React from "react";
import type { ModularView } from "../modular-view";
import {
  MedicineList,
  PatientIdentity,
  PrescriptionFooter,
  SignatureBlock,
  type Units,
} from "./prescription-parts";
import { ClinicLogoHeader as PrescriptionHeader } from "./clinic-logo-header";
import { SectionBlock } from "./section-parts";

export function ModularDocument({
  view,
  u,
  signatureUrl,
}: {
  view: ModularView;
  u: Units;
  signatureUrl?: string | null;
  clinicLogoUrl?: string | null;
}) {
  const hasColumns = view.left.length > 0 || view.right.length > 0;

  return (
    <>
      <PrescriptionHeader view={view} u={u} reserveClinicLogoSlot />
      {/* Keep the signature BLOCK exactly where the accepted layout put it.
          Only center the bitmap inside its existing underline. */}
      <style>{`
        [data-review-sheet] img[alt="The signature fixed to this prescription"],
        [data-print-root] img[alt="The signature fixed to this prescription"] {
          margin-left: auto;
          margin-right: auto;
          max-width: 100%;
        }
      `}</style>
      <PatientIdentity view={view} u={u} />

      <div className="flex flex-1 flex-col">
        {hasColumns ? (
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
        ) : (
          <MedicineList view={view} u={u} />
        )}
      </div>

      <SignatureBlock view={view} u={u} signatureUrl={signatureUrl} />
      <PrescriptionFooter view={view} u={u} platformAttribution />
    </>
  );
}
