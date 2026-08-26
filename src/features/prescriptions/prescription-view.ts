import { toModularView, type ModularView } from "./modular-view";
import { selectRenderer } from "./renderer-version";
import type { ReviewBundle } from "./review-bundle";
import { toReviewView, type ReviewView } from "./review-view";

/**
 * THE ONE PLACE A SNAPSHOT BECOMES A DOCUMENT.
 *
 * Screen preview, finalised record and print all come through here, so there is
 * exactly one answer to "which renderer prints this?" and it is always the same
 * answer for the same snapshot. Two entry points would eventually disagree, and
 * the disagreement would be discovered on paper.
 *
 * The branch is on `schemaVersion` via `selectRenderer` and on nothing else.
 * See `renderer-version.ts` for why that is not negotiable.
 */

export type PrescriptionView = ReviewView | ModularView;

export type PrescriptionRender =
  | { ok: true; view: PrescriptionView }
  /**
   * A snapshot this build cannot print. The caller shows that plainly — never a
   * blank prescription and never a best guess, because both look like a
   * prescription with nothing on it.
   */
  | { ok: false; reason: "unsupported-schema"; found: unknown };

export function toPrescriptionView(bundle: ReviewBundle): PrescriptionRender {
  const choice = selectRenderer(bundle.schemaVersion);
  if (!choice.ok) return { ok: false, reason: "unsupported-schema", found: choice.found };

  /**
   * Exhaustive. Adding a renderer without teaching this switch about it is a
   * compile error rather than a prescription that renders as nothing.
   */
  switch (choice.renderer) {
    case "v3-linear":
      return { ok: true, view: toReviewView(bundle) };
    case "v4-modular":
      return { ok: true, view: toModularView(bundle) };
  }
}
