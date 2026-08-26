/**
 * WHICH RENDERER PRINTS THIS SNAPSHOT.
 *
 * One question, answered in one place, from ONE input: `schemaVersion`.
 *
 * Not from the presence of `sections`. Not from the presence of a top-level
 * `advice`. Not from the template, not from a feature flag, not from a date,
 * not from whether the doctor has configured modules today. Every one of those
 * is a property of the CURRENT build or the CURRENT configuration, and a
 * finalised prescription must print the same way in five years as it did on the
 * day it was signed.
 *
 * WHY A MAP AND NOT A COMPARISON
 *
 * `version >= 4 ? v4 : v3` reads like the same rule and is not. It says "and
 * everything after 4 as well", so the day a v5 bundle exists — carrying
 * something v4 never had — it would be handed to a renderer that cannot see the
 * new content, and would print a shorter prescription than the one approved,
 * silently. An exact-match lookup cannot do that: a version nobody has taught
 * this build about is refused, loudly, and the reader is told the build is old
 * rather than shown a document missing a section.
 *
 * ADDING A VERSION IS THEREFORE A DELIBERATE EDIT HERE, and that is the point.
 */

/**
 * The renderers this build contains.
 *
 * `v3-linear` is the original document: one column, medicines then
 * investigations then advice, each section fixed. It renders v2 and v3.
 * `v4-modular` is Prescription V2: the doctor's own modules, in their order,
 * under their labels, in the arrangement the bundle's `layout` names.
 */
export type PrescriptionRenderer = "v3-linear" | "v4-modular";

/**
 * EXACT MATCH ONLY. Every supported version is listed, including the ones that
 * share a renderer — `2` is here because v2 was approved by this renderer and
 * must keep being printed by it, not because it is "less than 4".
 *
 * A v3 snapshot stays v3 forever. Nothing in this table is a migration.
 */
const RENDERER_BY_SCHEMA_VERSION: Readonly<Record<number, PrescriptionRenderer>> = {
  2: "v3-linear",
  3: "v3-linear",
  4: "v4-modular",
};

export type RendererChoice =
  | { ok: true; renderer: PrescriptionRenderer; schemaVersion: number }
  /**
   * A snapshot from a build that is not this one. It is not rendered on a
   * guess, and the caller must show that rather than an empty prescription.
   */
  | { ok: false; reason: "unsupported-schema"; found: unknown };

export function selectRenderer(schemaVersion: unknown): RendererChoice {
  /**
   * Guarded before the lookup rather than trusting the index: `"4"`, `4.5` and
   * `NaN` would all be plausible-looking near-misses, and a near-miss must be a
   * refusal like any other unknown version.
   */
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return { ok: false, reason: "unsupported-schema", found: schemaVersion };
  }

  // `Object.hasOwn`, not `in` and not `?? fallback`: no prototype key, and no
  // default that would quietly become "assume the newest renderer".
  if (!Object.hasOwn(RENDERER_BY_SCHEMA_VERSION, schemaVersion)) {
    return { ok: false, reason: "unsupported-schema", found: schemaVersion };
  }

  return {
    ok: true,
    renderer: RENDERER_BY_SCHEMA_VERSION[schemaVersion],
    schemaVersion,
  };
}

/** The versions this build can print. Derived, so it can never drift from the map. */
export const RENDERABLE_SCHEMA_VERSIONS: readonly number[] = Object.keys(
  RENDERER_BY_SCHEMA_VERSION,
).map(Number);
