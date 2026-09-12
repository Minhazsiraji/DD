/**
 * Engagement surfaces — the ONLY thing a browser ever reports.
 *
 * A surface is a coarse, closed label for which part of the workspace a doctor
 * was using. It exists so that engagement can be counted without the route
 * itself ever leaving the page: a path like `/patients/<uuid>/encounter/<uuid>`
 * is a patient identifier, and it must never reach any store, log or payload.
 *
 * Classification happens in the browser from `usePathname()`, and the path is
 * discarded on the spot. What crosses the network is one enum member. Nothing
 * here returns, echoes, slices or hashes a path segment.
 *
 * Frozen O1-A vocabulary. Adding a member is a spec change, not a code change.
 */

export const ENGAGEMENT_SURFACES = [
  "DASHBOARD",
  "PATIENTS",
  "CONSULTATION",
  "PRESCRIPTION",
  "APPOINTMENTS",
  "QUEUE",
  "SETTINGS",
  "OWNER",
] as const;

export type EngagementSurface = (typeof ENGAGEMENT_SURFACES)[number];

const SURFACE_SET: ReadonlySet<string> = new Set(ENGAGEMENT_SURFACES);

export function isEngagementSurface(value: unknown): value is EngagementSurface {
  return typeof value === "string" && SURFACE_SET.has(value);
}

/**
 * Surfaces that count toward being an ACTIVE DOCTOR.
 *
 * SETTINGS is deliberately absent: configuring a profile is not using Doctor's
 * Diary to practise, and a doctor who only ever opened settings has not
 * adopted anything. OWNER is platform administration, not doctor adoption at
 * all. Both are still RECORDED per surface — time stuck in settings is an
 * onboarding signal worth seeing — but neither can make a doctor active, add
 * to headline engaged minutes, or create an active day.
 */
export const QUALIFYING_SURFACES: ReadonlySet<EngagementSurface> = new Set<EngagementSurface>([
  "DASHBOARD",
  "PATIENTS",
  "CONSULTATION",
  "PRESCRIPTION",
  "APPOINTMENTS",
  "QUEUE",
]);

export function isQualifyingSurface(surface: EngagementSurface): boolean {
  return QUALIFYING_SURFACES.has(surface);
}

/**
 * First path segment → surface. Explicit and exhaustive for the workspace, so
 * every classification is a reviewable decision rather than a fallback.
 *
 * Mapped onto the nearest frozen surface where the workflow is the same one:
 *   documents  → PATIENTS      (a patient's documents are their record)
 *   handover   → PRESCRIPTION  (handing over a finalised Rx)
 *   medicines  → PRESCRIPTION  (the prescribing reference)
 *   followups  → APPOINTMENTS  (scheduling the next visit)
 *
 * Deliberately NOT counted — returns null, so no request is made at all:
 *   more, payments, reports, assistant, dev, and anything unrecognised.
 * An unknown route is never guessed into a surface; a new route earns a
 * mapping by being added here, with a test.
 */
const ROUTE_SURFACES: Readonly<Record<string, EngagementSurface>> = {
  dashboard: "DASHBOARD",
  patients: "PATIENTS",
  documents: "PATIENTS",
  consultation: "CONSULTATION",
  prescription: "PRESCRIPTION",
  handover: "PRESCRIPTION",
  medicines: "PRESCRIPTION",
  appointments: "APPOINTMENTS",
  followups: "APPOINTMENTS",
  queue: "QUEUE",
  settings: "SETTINGS",
  owner: "OWNER",
};

/**
 * Classify a pathname, returning ONLY an enum member or null.
 *
 * Reads the first segment and nothing after it — ids, query strings and
 * fragments are never inspected, so they cannot influence the result or leak
 * through it. The own-property check stops `constructor`, `__proto__` and
 * friends from resolving through the prototype chain.
 */
export function classifySurface(pathname: string | null | undefined): EngagementSurface | null {
  if (typeof pathname !== "string") return null;
  const first = pathname.split(/[?#]/, 1)[0]!.split("/").find((segment) => segment !== "");
  if (!first) return null;
  const key = first.toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROUTE_SURFACES, key) ? ROUTE_SURFACES[key]! : null;
}

/**
 * Surface → O1-F `feature_registry.code`.
 *
 * O1-F constrains a code to `^[a-z][a-z0-9_]{1,63}$` and its registry is a
 * foreign key, so a code that is not registered cannot be written at all.
 * `0047` seeds only the `'*'` sentinel today, which is why the producer takes
 * the registered set as an argument and emits a feature touch for nothing
 * else — an unregistered code would fail the constraint at wiring time.
 *
 * OWNER has no feature code: platform administration is not doctor practice,
 * and the beacon never mounts outside the clinical shell anyway.
 */
const SURFACE_FEATURE_CODES: Readonly<Partial<Record<EngagementSurface, string>>> = {
  DASHBOARD: "dashboard",
  PATIENTS: "patients",
  CONSULTATION: "consultation",
  PRESCRIPTION: "prescription",
  APPOINTMENTS: "appointments",
  QUEUE: "queue",
  SETTINGS: "settings",
};

export function featureCodeForSurface(surface: EngagementSurface): string | null {
  return SURFACE_FEATURE_CODES[surface] ?? null;
}

/**
 * The complete request body a browser may send. One key, one enum value.
 *
 * Built here rather than inline in the component so the privacy property —
 * "nothing but the surface" — is a pure function that a test can call with
 * hostile paths and inspect.
 */
export function buildEngagementPayload(
  pathname: string | null | undefined,
): { surface: EngagementSurface } | null {
  const surface = classifySurface(pathname);
  return surface ? { surface } : null;
}
