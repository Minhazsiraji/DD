/**
 * What a plan includes — and, far more importantly, what a plan can never
 * reach.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE.
 *
 * A doctor's patient records are theirs. Not leased, not licensed, not held
 * against payment. A subscription that lapses may close a door on analytics or
 * online booking; it may never close the door on a consultation from last
 * March.
 *
 * That rule is not implemented as a check, because a check is something a
 * future edit can forget to call. It is implemented as an ABSENCE: the
 * entitlement key space below contains no clinical capability, so "gate the
 * patient list behind a plan" is not a thing you can write and get wrong — it
 * is a thing there is no key for. `assertCommercialKey` exists only to make
 * that boundary loud for callers that arrive with a runtime string.
 *
 * NOTHING HERE IS WIRED TO A GATE YET, and that is deliberate for this stage.
 * This is the model and the vocabulary; enforcement is a separate decision
 * with its own review, because the first time a plan actually withholds a
 * feature is the first time it can withhold the wrong one.
 */

import type { CommercialState } from "./state";

/**
 * The complete commercial key space. Read the list twice: everything on it is
 * something the product does AROUND care, and nothing on it is care.
 */
export const ENTITLEMENTS = [
  "chambers",
  "onlineBooking",
  "publicProfile",
  "staffSeats",
  "analytics",
  "aiFeatures",
  "storageMb",
  "onlineConsultation",
  "premiumSupport",
] as const;

export type Entitlement = (typeof ENTITLEMENTS)[number];

/**
 * `true`/`false` for a capability, a number for a ceiling, `null` for "no
 * ceiling". Null is not zero and must never be coerced to it.
 */
export type Allowance = boolean | number | null;

export type PlanEntitlements = Record<Entitlement, Allowance>;

/**
 * CLINICAL CAPABILITIES ARE NAMED HERE SO THEY CAN BE PROVEN ABSENT ABOVE.
 *
 * This list is not consulted to grant anything — nothing in this module grants
 * clinical access, because nothing in this module knows how. It exists so a
 * test can assert the intersection with `ENTITLEMENTS` is empty, and so a
 * runtime lookup with one of these names fails loudly instead of returning
 * `undefined` and being read as "denied".
 */
export const CLINICAL_CAPABILITIES = [
  "patients",
  "patientHistory",
  "encounters",
  "consultations",
  "prescriptions",
  "diagnoses",
  "investigations",
  "vitals",
  "documents",
  "appointments",
  "queue",
] as const;

export type ClinicalCapability = (typeof CLINICAL_CAPABILITIES)[number];

export function isClinicalCapability(key: string): boolean {
  return (CLINICAL_CAPABILITIES as readonly string[]).includes(key);
}

/**
 * Refuse, loudly, to answer a plan question about clinical access.
 *
 * A silent `false` would be the dangerous answer: a caller asking "does this
 * plan include patients?" and receiving "no" would go on to hide the patient
 * list from a doctor whose subscription lapsed. There is no correct value to
 * return, so there is no return.
 */
export function assertCommercialKey(key: string): asserts key is Entitlement {
  if (isClinicalCapability(key)) {
    throw new Error(
      `Clinical access is not an entitlement: "${key}". A doctor's records are ` +
        "not gated by their subscription. See features/commercial/entitlements.ts.",
    );
  }
  if (!(ENTITLEMENTS as readonly string[]).includes(key)) {
    throw new Error(`Unknown entitlement: "${key}"`);
  }
}

/**
 * The floor. What an account keeps when it is paying for nothing at all —
 * cancelled, expired, or on a status this build does not recognise.
 *
 * One chamber and a public profile stay on, because a doctor who stops paying
 * should not vanish from the internet mid-sentence, and because their own
 * practice must keep working. Online booking goes off: it is the one thing
 * here that creates obligations to third parties, and leaving it on would keep
 * taking appointments for an account nobody is maintaining.
 */
export const BASE_ENTITLEMENTS: PlanEntitlements = {
  chambers: 1,
  onlineBooking: false,
  publicProfile: true,
  staffSeats: 0,
  analytics: false,
  aiFeatures: false,
  storageMb: 200,
  onlineConsultation: false,
  premiumSupport: false,
};

/**
 * Plan catalog, keyed by `subscription_plans.code`.
 *
 * Codes, not prices. What a plan COSTS lives in the database where an owner
 * can change it without a deploy; what a plan INCLUDES lives here, because it
 * corresponds to code paths that have to exist. Splitting them this way is
 * what stops a price change from silently granting a feature.
 *
 * An unknown code falls back to `BASE_ENTITLEMENTS`, never to the most
 * generous plan. A plan row added by an owner tomorrow grants nothing new
 * until somebody deliberately teaches this file about it.
 */
export const PLAN_CATALOG: Record<string, PlanEntitlements> = {
  PILOT: {
    chambers: null,
    onlineBooking: true,
    publicProfile: true,
    staffSeats: 2,
    analytics: true,
    aiFeatures: false,
    storageMb: 2000,
    onlineConsultation: false,
    premiumSupport: true,
  },
  FOUNDING_DOCTOR: {
    chambers: null,
    onlineBooking: true,
    publicProfile: true,
    staffSeats: 3,
    analytics: true,
    aiFeatures: false,
    storageMb: 5000,
    onlineConsultation: false,
    premiumSupport: true,
  },
  STANDARD: {
    chambers: 3,
    onlineBooking: true,
    publicProfile: true,
    staffSeats: 1,
    analytics: false,
    aiFeatures: false,
    storageMb: 2000,
    onlineConsultation: false,
    premiumSupport: false,
  },
};

/**
 * What an account may use, given its plan and its commercial state.
 *
 * The state matters as much as the plan: a STANDARD subscription that expired
 * is not a STANDARD subscription. PAST_DUE deliberately keeps the full plan —
 * that is what a grace period is for, and withdrawing features from someone
 * whose bank transfer is still clearing is how a product loses a doctor it had
 * already won.
 */
export function entitlementsFor(
  planCode: string | null | undefined,
  state: CommercialState | null,
): PlanEntitlements {
  if (state === "SUSPENDED" || state === "CANCELLED" || state === null) {
    return { ...BASE_ENTITLEMENTS };
  }
  const plan = PLAN_CATALOG[(planCode ?? "").trim().toUpperCase()];
  return plan ? { ...plan } : { ...BASE_ENTITLEMENTS };
}

export function allows(entitlements: PlanEntitlements, key: Entitlement): boolean {
  assertCommercialKey(key);
  const value = entitlements[key];
  if (typeof value === "boolean") return value;
  if (value === null) return true;
  return value > 0;
}

/** The ceiling for a counted entitlement; null means uncapped. */
export function limitOf(entitlements: PlanEntitlements, key: Entitlement): number | null {
  assertCommercialKey(key);
  const value = entitlements[key];
  if (typeof value === "number") return value;
  return value === false ? 0 : null;
}

export const ENTITLEMENT_LABEL: Record<Entitlement, string> = {
  chambers: "Chambers",
  onlineBooking: "Online appointment booking",
  publicProfile: "Public profile",
  staffSeats: "Reception & staff accounts",
  analytics: "Practice analytics",
  aiFeatures: "AI assistance",
  storageMb: "Document storage",
  onlineConsultation: "Online consultation",
  premiumSupport: "Priority support",
};

/** "Unlimited" / "3" / "Not included" — never a bare number with no meaning. */
export function describeAllowance(key: Entitlement, value: Allowance): string {
  if (value === null) return "Unlimited";
  if (value === true) return "Included";
  if (value === false) return "Not included";
  if (value === 0) return "Not included";
  if (key === "storageMb") return value >= 1000 ? `${value / 1000} GB` : `${value} MB`;
  return String(value);
}
