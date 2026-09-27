import * as React from "react";
import type { PrescriptionView } from "../prescription-view";
import { LinearDocument } from "./document-v3";
import { ModularDocument } from "./document-v4";
import type { Units } from "./prescription-parts";
import type { PrescriptionDocumentState } from "../prescription-document-state";

export function PrescriptionDocument({
  view,
  u,
  signatureUrl,
  clinicLogoUrl,
  documentState,
}: {
  view: PrescriptionView;
  u: Units;
  signatureUrl?: string | null;
  clinicLogoUrl?: string | null;
  documentState: PrescriptionDocumentState;
}) {
  switch (view.renderer) {
    case "v3-linear":
      return (
        <LinearDocument
          view={view}
          u={u}
          signatureUrl={signatureUrl}
          documentState={documentState}
        />
      );
    case "v4-modular":
      return (
        <ModularDocument
          view={view}
          u={u}
          signatureUrl={signatureUrl}
          clinicLogoUrl={clinicLogoUrl}
          documentState={documentState}
        />
      );
  }
}
