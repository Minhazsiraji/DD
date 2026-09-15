import * as React from "react";
import type { PrescriptionView } from "../prescription-view";
import { LinearDocument } from "./document-v3";
import { ModularDocument } from "./document-v4";
import type { Units } from "./prescription-parts";

export function PrescriptionDocument({
  view,
  u,
  signatureUrl,
  clinicLogoUrl,
}: {
  view: PrescriptionView;
  u: Units;
  signatureUrl?: string | null;
  clinicLogoUrl?: string | null;
}) {
  switch (view.renderer) {
    case "v3-linear":
      return <LinearDocument view={view} u={u} signatureUrl={signatureUrl} />;
    case "v4-modular":
      return (
        <ModularDocument
          view={view}
          u={u}
          signatureUrl={signatureUrl}
          clinicLogoUrl={clinicLogoUrl}
        />
      );
  }
}
