import * as React from "react";
import type { ReviewView } from "../review-view";
import {
  AdviceBlock,
  InvestigationList,
  MedicineList,
  PatientIdentity,
  PrescriptionFooter,
  PrescriptionHeader,
  SignatureBlock,
  type Units,
} from "./prescription-parts";

/**
 * THE V3 DOCUMENT — AND IT IS FROZEN.
 *
 * One column: medicines, then the tests ordered today, then today's advice.
 * Fixed sections in a fixed order, with headings this build owns rather than
 * the doctor.
 *
 * It renders v2 and v3 snapshots and will keep doing so permanently. Nothing
 * here may be "improved" to look more like the v4 document: every prescription
 * a doctor has already signed prints through this file, and a change to its
 * arrangement is a change to a document that was approved as it stood.
 *
 * A v3 snapshot is never migrated to v4 and never reconstructed from today's
 * module configuration. If v3 output ever needs to change, the answer is a new
 * schema version for NEW prescriptions — not an edit here.
 *
 * These are the DIRECT CHILDREN of a flex column (both sheets declare it), so
 * the clinical body's `flex-1` absorbs the leftover height and the signature
 * and footer settle at the foot of the paper. Do not wrap them in a plain
 * `<div>` without carrying the column through, or the anchor silently stops
 * working.
 */
export function LinearDocument({
  view,
  u,
  signatureUrl,
}: {
  view: ReviewView;
  u: Units;
  signatureUrl?: string | null;
}) {
  return (
    <>
      <PrescriptionHeader view={view} u={u} />
      <PatientIdentity view={view} u={u} />

      {/*
        THE CLINICAL BODY — and the element that TAKES THE SLACK.

        `flex-1` here is what settles the signature and footer at the foot of a
        short page instead of leaving them stranded mid-sheet. It sits on the
        BODY rather than on the medicines because the advice is the last thing
        printed, and the empty space belongs after everything the doctor wrote —
        not between the medicines and the tests.

        Growing the body rather than pushing the signature down with an auto
        margin matters on a long prescription: the signature stays attached to
        the content, so when the browser fragments the document it lands after
        the last thing written on the final page, not at a page bottom it does
        not belong to.
      */}
      <div className="flex flex-1 flex-col">
        <MedicineList view={view} u={u} />
        <InvestigationList view={view} u={u} />
        <AdviceBlock view={view} u={u} />
      </div>

      <SignatureBlock view={view} u={u} signatureUrl={signatureUrl} />
      <PrescriptionFooter view={view} u={u} />
    </>
  );
}
