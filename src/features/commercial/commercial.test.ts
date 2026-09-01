import { describe, it, expect } from "vitest";
import { formatMoney, currency, money, renderMoney, CURRENCIES } from "./catalog";
import {
  commercialState,
  summarize,
  STATE_OF,
  DB_STATUSES,
  COMMERCIAL_STATES,
  STATE_LABEL,
  STATE_MEANING,
  needsAttention,
} from "./state";
import {
  ENTITLEMENTS,
  CLINICAL_CAPABILITIES,
  BASE_ENTITLEMENTS,
  PLAN_CATALOG,
  entitlementsFor,
  allows,
  limitOf,
  assertCommercialKey,
  describeAllowance,
} from "./entitlements";

const price = (v: number | string | null | undefined) => money(v, "BDT");

describe("money is configurable, not Bangladeshi", () => {
  it("formats through the currency, whatever it is", () => {
    expect(formatMoney(1500, "BDT")).toBe("৳1,500.00");
    expect(formatMoney(1500, "USD")).toBe("$1,500.00");
    expect(formatMoney(1500, "GBP")).toBe("£1,500.00");
  });

  it("renders an unknown currency as its code rather than guessing a symbol", () => {
    expect(formatMoney(20, "XOF")).toBe("XOF20.00");
    expect(currency("XOF").code).toBe("XOF");
  });

  it("never renders a missing price as zero", () => {
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney("")).toBeNull();
    expect(renderMoney(null)).toBeNull();
    expect(money(null)).toBeNull();
  });

  it("keeps an amount with its currency", () => {
    expect(money("2500", "USD")).toEqual({ amount: 2500, currencyCode: "USD" });
  });

  it("is deterministic — no locale-dependent formatting anywhere", () => {
    // A hydration mismatch on a price is the failure this guards.
    expect(formatMoney(1234567.5, "USD")).toBe("$1,234,567.50");
    expect(formatMoney(-40, "USD")).toBe("-$40.00");
  });

  it("offers more than one country's currency", () => {
    expect(Object.keys(CURRENCIES).length).toBeGreaterThan(3);
    expect(CURRENCIES.USD).toBeTruthy();
  });
});

describe("commercial state projects the database, never replaces it", () => {
  it("maps every database status to exactly one commercial state", () => {
    for (const status of DB_STATUSES) {
      expect(COMMERCIAL_STATES).toContain(STATE_OF[status]);
    }
  });

  it("keeps expired distinct from cancelled", () => {
    expect(commercialState("EXPIRED")).toBe("SUSPENDED");
    expect(commercialState("CANCELLED")).toBe("CANCELLED");
  });

  it("returns null for a status this build does not know", () => {
    expect(commercialState("DUNNING")).toBeNull();
    expect(commercialState(null)).toBeNull();
  });

  it("has a label and a meaning for every state", () => {
    for (const state of COMMERCIAL_STATES) {
      expect(STATE_LABEL[state]).toBeTruthy();
      expect(STATE_MEANING[state]).toBeTruthy();
    }
  });

  it("tells the doctor their records are safe in every state that sounds bad", () => {
    for (const state of COMMERCIAL_STATES) {
      if (!needsAttention(state) && state !== "CANCELLED") continue;
      expect(STATE_MEANING[state].toLowerCase()).toContain("records");
    }
  });
});

describe("a summary invents nothing", () => {
  const row = {
    subscriptionId: "s1",
    status: "PILOT",
    planCode: "PILOT",
    planName: "Pilot",
    monthlyPriceBdt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    graceUntil: null,
    cancelAtPeriodEnd: false,
    founderDiscountPercent: null,
  };

  it("leaves a missing period and price null", () => {
    const s = summarize(row, price);
    expect(s.periodStart).toBeNull();
    expect(s.periodEnd).toBeNull();
    expect(s.monthlyPrice).toBeNull();
    expect(s.state).toBe("FREE");
  });

  it("shows a trial end date only for a trial", () => {
    const end = "2026-10-01T00:00:00Z";
    expect(summarize({ ...row, status: "TRIAL", currentPeriodEnd: end }, price).trialEndsAt).toBe(end);
    expect(summarize({ ...row, status: "ACTIVE", currentPeriodEnd: end }, price).trialEndsAt).toBeNull();
  });

  it("keeps the raw status alongside the projection", () => {
    expect(summarize({ ...row, status: "GRACE_PERIOD" }, price).rawStatus).toBe("GRACE_PERIOD");
    expect(summarize({ ...row, status: "GRACE_PERIOD" }, price).state).toBe("PAST_DUE");
  });

  it("drops a zero or absent founder discount rather than rendering 0%", () => {
    expect(summarize({ ...row, founderDiscountPercent: 0 }, price).founderDiscountPercent).toBeNull();
    expect(summarize({ ...row, founderDiscountPercent: "25" }, price).founderDiscountPercent).toBe(25);
  });
});

describe("THE INVARIANT: a plan can never reach a clinical record", () => {
  it("shares not one key between entitlements and clinical capabilities", () => {
    const overlap = (ENTITLEMENTS as readonly string[]).filter((k) =>
      (CLINICAL_CAPABILITIES as readonly string[]).includes(k),
    );
    expect(overlap).toEqual([]);
  });

  it("names no clinical RECORD in the entitlement key space", () => {
    /*
     * `onlineConsultation` is the one entitlement whose name contains a
     * clinical word, and it is deliberately allowed: it gates a CHANNEL — the
     * ability to run a video consultation — not access to a consultation that
     * already happened. The distinction is the whole architecture. A plan may
     * decide whether you can hold a video call tomorrow; it may never decide
     * whether you can read the notes from one last March.
     *
     * Listing the exception here rather than weakening the pattern keeps that
     * reasoning visible, and keeps a second exception from being added quietly.
     */
    const CHANNEL_NOT_RECORD = new Set(["onlineConsultation"]);
    for (const key of ENTITLEMENTS) {
      if (CHANNEL_NOT_RECORD.has(key)) continue;
      expect(key, `entitlement "${key}" sounds like a clinical record`).not.toMatch(
        /patient|encounter|consultation|prescription|diagnos|record|vital|history/i,
      );
    }
  });

  it("refuses loudly rather than answering 'no' to a clinical question", () => {
    for (const key of CLINICAL_CAPABILITIES) {
      expect(() => assertCommercialKey(key)).toThrowError(/not an entitlement/i);
    }
  });

  it("refuses an entitlement it has never heard of", () => {
    expect(() => assertCommercialKey("teleportation")).toThrowError(/Unknown entitlement/);
  });

  it("gives an expired plan the same clinical access as an active one — none to gate", () => {
    const active = entitlementsFor("STANDARD", "ACTIVE");
    const expired = entitlementsFor("STANDARD", "SUSPENDED");
    const cancelled = entitlementsFor("STANDARD", "CANCELLED");

    // Commercial features may differ...
    expect(expired).not.toEqual(active);
    // ...but no clinical key exists in either, so nothing clinical can differ.
    for (const set of [active, expired, cancelled]) {
      for (const clinical of CLINICAL_CAPABILITIES) {
        expect(Object.keys(set)).not.toContain(clinical);
      }
    }
  });

  it("keeps a doctor's own practice usable at the floor", () => {
    // Losing a subscription must not lose the chamber they see patients in.
    expect(allows(BASE_ENTITLEMENTS, "chambers")).toBe(true);
    expect(allows(BASE_ENTITLEMENTS, "publicProfile")).toBe(true);
  });
});

describe("entitlements resolve conservatively", () => {
  it("falls back to the floor for an unknown plan code, never to the best plan", () => {
    expect(entitlementsFor("SOME_NEW_PLAN", "ACTIVE")).toEqual(BASE_ENTITLEMENTS);
  });

  it("falls back to the floor for an unrecognised state", () => {
    expect(entitlementsFor("PILOT", null)).toEqual(BASE_ENTITLEMENTS);
  });

  it("keeps the full plan while a payment is merely late", () => {
    expect(entitlementsFor("PILOT", "PAST_DUE")).toEqual(PLAN_CATALOG.PILOT);
  });

  it("withdraws third-party obligations when nobody is paying", () => {
    // Online booking keeps taking appointments from patients; it is the one
    // capability whose staying on would make promises to other people.
    expect(allows(entitlementsFor("PILOT", "SUSPENDED"), "onlineBooking")).toBe(false);
  });

  it("returns a copy, so a caller cannot edit the catalog", () => {
    const set = entitlementsFor("PILOT", "ACTIVE");
    set.analytics = false;
    expect(PLAN_CATALOG.PILOT!.analytics).toBe(true);
  });

  it("distinguishes unlimited from zero", () => {
    expect(limitOf({ ...BASE_ENTITLEMENTS, chambers: null }, "chambers")).toBeNull();
    expect(limitOf({ ...BASE_ENTITLEMENTS, staffSeats: 0 }, "staffSeats")).toBe(0);
    expect(describeAllowance("chambers", null)).toBe("Unlimited");
    expect(describeAllowance("staffSeats", 0)).toBe("Not included");
    expect(describeAllowance("storageMb", 2000)).toBe("2 GB");
  });

  it("gives every plan in the catalog a value for every entitlement", () => {
    for (const [code, plan] of Object.entries(PLAN_CATALOG)) {
      for (const key of ENTITLEMENTS) {
        expect(plan[key], `${code} is missing ${key}`).toBeDefined();
      }
    }
  });
});
