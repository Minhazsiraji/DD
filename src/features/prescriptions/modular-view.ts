import type { BundleLayout, BundleSection, ReviewBundle } from "./review-bundle";
import { clean, toDocumentChrome, type DocumentChrome } from "./review-view";

/**
 * The v4 document — Prescription V2 — arranged for rendering.
 *
 * Everything printable comes from the FROZEN bundle: which sections exist, what
 * order they are in, what each is called, and what each says. Today's module
 * configuration is not consulted here and must never be. A doctor who renames
 * "Chief Complaint" to "Presenting Complaint" tomorrow changes tomorrow's
 * prescriptions; the one they signed on Tuesday still says what it said.
 *
 * The one thing NOT in the section rows is which column each lands in — that
 * comes from the layout token, which is itself in the bundle and inside the
 * digest. See `placeSections`.
 */

export interface ModularSectionText {
  module: string;
  label: string;
  kind: "text";
  text: string;
}

export interface ModularSectionList {
  module: string;
  label: string;
  kind: "list";
  items: { text: string; note: string | null }[];
}

export interface ModularSectionPairs {
  module: string;
  label: string;
  kind: "pairs";
  pairs: { label: string; value: string }[];
}

export type ModularSection = ModularSectionText | ModularSectionList | ModularSectionPairs;

export interface ModularView extends DocumentChrome {
  /** Explicit, from `schemaVersion` — never from the presence of `sections`. */
  renderer: "v4-modular";
  /** The arrangement the doctor approved, by name. */
  layout: BundleLayout;
  /** The narrow clinical column, in the doctor's approved order. */
  left: ModularSection[];
  /** Beside the medicines. Empty under `two-column`, by design. */
  right: ModularSection[];
}

/**
 * WHERE EACH SECTION PRINTS.
 *
 * `two-column` names one arrangement and always the same one:
 *
 *     LEFT   every configured module, in the doctor's approved order
 *     RIGHT  the Rx — the medicines, and nothing else
 *
 * That is the Bangladesh chamber pad: the clinical narrative down a narrow
 * left-hand column, the prescription itself dominant on the right, where a
 * pharmacist looks first.
 *
 * This function is the whole placement contract, and it is deliberately not
 * configurable: the arrangement is part of what `layout` NAMES, so changing it
 * would change how already-signed prescriptions print. A different arrangement
 * is a different token, and `renderer-print.test.ts` pins this one.
 *
 * The exhaustive switch is the safety net — a new token cannot be added without
 * TypeScript demanding a placement rule for it, so no layout can ever fall
 * through to "whatever the last one did".
 */
export function placeSections(
  layout: BundleLayout,
  sections: ModularSection[],
): { left: ModularSection[]; right: ModularSection[] } {
  switch (layout) {
    case "two-column":
      return { left: sections, right: [] };
  }
}

/**
 * Read one frozen section, keeping every printable value exactly as stored.
 *
 * `500g` stays `500g`: nothing here parses a quantity, normalises a unit or
 * reformats a measurement. The database froze these strings as the doctor
 * recorded them, and a renderer that "tidied" one would be changing a clinical
 * value after it was approved.
 */
function toSection(section: BundleSection): ModularSection {
  switch (section.kind) {
    case "text":
      return {
        module: section.module,
        label: section.label,
        kind: "text",
        text: section.text,
      };
    case "list":
      return {
        module: section.module,
        label: section.label,
        kind: "list",
        items: section.items.map((i) => ({ text: i.text, note: clean(i.note) })),
      };
    case "pairs":
      return {
        module: section.module,
        label: section.label,
        kind: "pairs",
        pairs: section.pairs.map((p) => ({ label: p.label, value: p.value })),
      };
  }
}

/**
 * Build the v4 printable view from the canonical bundle — and from nothing else.
 *
 * Sections are taken IN ARRAY ORDER, not re-sorted. The database wrote them by
 * walking the doctor's modules in their configured order, and that order is
 * inside the digest; re-deriving it here from a module name would be this
 * renderer inventing an arrangement the doctor never saw.
 *
 * An empty section never reached the snapshot: the builder omits a module with
 * nothing to say, so there is no such thing as a v4 section with no content and
 * therefore no bare heading on the paper.
 */
export function toModularView(bundle: ReviewBundle): ModularView {
  /**
   * Both are guaranteed present at v4 by `reviewBundleSchema`, which refuses a
   * v4 bundle without them. The fallbacks exist because the type is shared with
   * v3 and cannot express that — they are not a tolerance for a missing layout.
   */
  const layout: BundleLayout = bundle.layout ?? "two-column";
  const sections = (bundle.sections ?? []).map(toSection);
  const placed = placeSections(layout, sections);

  return {
    ...toDocumentChrome(bundle),
    renderer: "v4-modular",
    layout,
    left: placed.left,
    right: placed.right,
  };
}
