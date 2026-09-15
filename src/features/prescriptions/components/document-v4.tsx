import * as React from "react";
import type { ModularView } from "../modular-view";
import {
  MedicineList,
  PatientIdentity,
  PrescriptionFooter,
  SignatureBlock,
  type Units,
} from "./prescription-parts";
import { ClinicLogoHeader } from "./clinic-logo-header";
import { SectionBlock } from "./section-parts";

export function ModularDocument({
  view,
  u,
  signatureUrl,
  clinicLogoUrl,
}: {
  view: ModularView;
  u: Units;
  signatureUrl?: string | null;
  clinicLogoUrl?: string | null;
}) {
  const hasColumns = view.left.length > 0 || view.right.length > 0;

  return (
    <>
      <ClinicLogoHeader view={view} u={u} clinicLogoUrl={clinicLogoUrl} />
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

      {/* The block stays bottom-right. Only the image inside it is centered over
          the existing underline; Tailwind's image reset makes img display:block,
          so text-center alone cannot center the bitmap. */}
      <div className="[&_img]:mx-auto [&_img]:max-w-full">
        <SignatureBlock view={view} u={u} signatureUrl={signatureUrl} />
      </div>
      <PrescriptionFooter view={view} u={u} platformAttribution />
    </>
  );
}
