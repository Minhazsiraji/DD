import * as React from "react";
import type { PrescriptionView } from "../prescription-view";
import { LinearDocument } from "./document-v3";
import { ModularDocument } from "./document-v4";
import type { Units } from "./prescription-parts";

/**
 * THE RENDERER BOUNDARY, IN THE COMPONENT TREE.
 *
 * The screen preview and the print sheet both render exactly this, so a
 * prescription cannot look one way on the doctor's screen and another on paper.
 * They differ only in the box around it and the units they hand in.
 *
 * The branch is on `view.renderer`, which `toPrescriptionView` set from the
 * snapshot's `schemaVersion` alone. It is NOT re-derived here from whether the
 * view happens to carry `sections` — that would put a second, weaker version
 * rule in the code, and the two would eventually disagree.
 *
 * The switch is exhaustive. A future renderer cannot be added without this
 * failing to compile, which is the only reliable way to stop a new snapshot
 * quietly rendering as an empty page.
 */
export function PrescriptionDocument({
  view,
  u,
  signatureUrl,
}: {
  view: PrescriptionView;
  u: Units;
  signatureUrl?: string | null;
}) {
  switch (view.renderer) {
    case "v3-linear":
      return <LinearDocument view={view} u={u} signatureUrl={signatureUrl} />;
    case "v4-modular":
      return <ModularDocument view={view} u={u} signatureUrl={signatureUrl} />;
  }
}
