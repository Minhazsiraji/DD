/**
 * WHICH RENDERER PRINTS THIS SNAPSHOT.
 *
 * Exact-match only: a newer schema is refused until this build explicitly
 * declares which renderer understands every printable field it adds.
 */
export type PrescriptionRenderer = "v3-linear" | "v4-modular";

const RENDERER_BY_SCHEMA_VERSION: Readonly<Record<number, PrescriptionRenderer>> = {
  2: "v3-linear",
  3: "v3-linear",
  4: "v4-modular",
  // v5 keeps the v4 modular body and adds an attested clinic-logo asset to the
  // shared document chrome/header. Old v4 snapshots remain unchanged.
  5: "v4-modular",
};

export type RendererChoice =
  | { ok: true; renderer: PrescriptionRenderer; schemaVersion: number }
  | { ok: false; reason: "unsupported-schema"; found: unknown };

export function selectRenderer(schemaVersion: unknown): RendererChoice {
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return { ok: false, reason: "unsupported-schema", found: schemaVersion };
  }

  if (!Object.hasOwn(RENDERER_BY_SCHEMA_VERSION, schemaVersion)) {
    return { ok: false, reason: "unsupported-schema", found: schemaVersion };
  }

  return {
    ok: true,
    renderer: RENDERER_BY_SCHEMA_VERSION[schemaVersion],
    schemaVersion,
  };
}

export const RENDERABLE_SCHEMA_VERSIONS: readonly number[] = Object.keys(
  RENDERER_BY_SCHEMA_VERSION,
).map(Number);
