import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Invariants a routine edit could undo. Behaviour is proven against real
 * Postgres in `scripts/verify-payment-approval.mjs`; these need no database.
 */
const POLICY = "supabase/policies/0037_manual_payment_approval.sql";
const SUBMIT_POLICY = "supabase/policies/0030_paid_doctor_commercial.sql";
const ACTIONS = "src/features/owner/payment-actions.ts";
const PAGE = "src/app/owner/payments/page.tsx";

let policy = "";
let code = "";
let submit = "";
let actions = "";
let page = "";

function sqlCode(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
}

beforeAll(async () => {
  [policy, submit, actions, page] = await Promise.all([
    readFile(path.resolve(POLICY), "utf8"),
    readFile(path.resolve(SUBMIT_POLICY), "utf8"),
    readFile(path.resolve(ACTIONS), "utf8"),
    readFile(path.resolve(PAGE), "utf8"),
  ]);
  code = sqlCode(policy);
});

describe("only a platform owner can confirm money", () => {
  it("gates every function on is_platform_owner()", () => {
    for (const fn of ["owner_pending_payments", "owner_decide_subscription_payment"]) {
      const body = policy.slice(
        policy.indexOf(`create or replace function public.${fn}`),
        policy.indexOf(`revoke all on function public.${fn}`),
      );
      expect(body, `${fn} is ungated`).toContain("public.is_platform_owner()");
      expect(body).toContain("NOT_PLATFORM_OWNER");
    }
  });

  it("reuses the one owner authority rather than inventing another", () => {
    expect(code).not.toMatch(/admin_users|is_admin|superuser|billing_admin/i);
  });

  it("leaves the doctor's submit path writing PENDING only", () => {
    const fn = submit.slice(
      submit.indexOf("create or replace function public.submit_manual_subscription_payment"),
      submit.indexOf("revoke all on function public.submit_manual_subscription_payment"),
    );
    expect(fn, "the doctor must not reach CONFIRMED").not.toContain("'CONFIRMED'");
    expect(fn).toContain("'PENDING'");
  });

  it("takes no decider id from the caller", () => {
    expect(code).toMatch(/v_owner uuid := auth\.uid\(\)/);
    expect(actions).not.toMatch(/p_(owner|decider|actor|user)_id/);
  });
});

describe("money never reaches medicine", () => {
  it("names no clinical table", () => {
    for (const table of [
      "patients",
      "encounters",
      "prescriptions",
      "prescription_items",
      "appointments",
      "queue_entries",
    ]) {
      expect(code, `0037 must not reference ${table}`).not.toContain(`public.${table}`);
    }
  });

  it("never touches profile visibility", () => {
    expect(code).not.toContain("profile_visibility");
  });

  it("exposes no clinical field in the review payload", () => {
    const shape = policy.slice(
      policy.indexOf("create or replace function public.owner_pending_payments"),
      policy.indexOf("revoke all on function public.owner_pending_payments"),
    );
    const keys = [...shape.matchAll(/'(\w+)',/g)].map((m) => m[1]!);
    for (const key of keys) {
      expect(key, `payload leaks ${key}`).not.toMatch(/patient|encounter|prescription|diagnos|queue/i);
    }
    expect(keys).toContain("payerReference");
  });
});

describe("history is protected", () => {
  it("is idempotent rather than silently re-deciding", () => {
    expect(code).toMatch(/if v_status = v_target then[\s\S]*?'changed', false/);
  });

  it("refuses to flip a settled decision", () => {
    expect(code).toContain("PAYMENT_ALREADY_DECIDED");
  });

  it("locks the payment row before reading its status", () => {
    /*
     * Same reason as the booking-settings audit: two concurrent confirmations
     * must not both observe PENDING and both activate.
     */
    expect(code).toMatch(/where pay\.id = p_payment_id\s*\r?\n\s*for update;/);
  });

  it("writes the audit in the same transaction as the decision", () => {
    // ADR 0007 — emitAudit swallows failures and is wrong for a money path.
    expect(code).toMatch(/insert into public\.audit_events/);
    expect(code).toContain("SUBSCRIPTION_PAYMENT_CONFIRMED");
    expect(code).toContain("SUBSCRIPTION_PAYMENT_REJECTED");
    expect(code).toContain("'fromStatus', v_status");
  });
});

describe("manual approval governs manual payments, and only those", () => {
  it("restricts the review queue to MANUAL_BANK", () => {
    const fn = code.slice(
      code.indexOf("create or replace function public.owner_pending_payments"),
      code.indexOf("revoke all on function public.owner_pending_payments"),
    );
    expect(fn).toMatch(/pay\.method = 'MANUAL_BANK'/);
  });

  it("refuses a non-manual payment in the decision function, not only in the queue", () => {
    /*
     * A payment id is a caller-supplied uuid and the RPC is granted to every
     * authenticated owner, so filtering the list hides gateway rows from the
     * screen without stopping anyone reaching them.
     */
    expect(code).toMatch(/if v_method <> 'MANUAL_BANK' then/);
    expect(code).toContain("PAYMENT_NOT_MANUAL");
  });

  it("reads the method under the same lock as the status", () => {
    const read = code.slice(
      code.indexOf("select pay.status"),
      code.indexOf("for update;") + "for update;".length,
    );
    expect(read).toContain("pay.method");
    expect(read).toMatch(/into v_status, v_method\b/);
    // No second, unlocked lookup of the method inside the decision function.
    const decision = code.slice(code.indexOf("create or replace function public.owner_decide"));
    expect(decision.match(/\.method\b/g)?.length ?? 0).toBe(1);
  });

  it("refuses before anything is written", () => {
    const guard = code.indexOf("PAYMENT_NOT_MANUAL");
    const write = code.indexOf("update public.subscription_payments");
    const audit = code.indexOf("insert into public.audit_events");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
    expect(guard).toBeLessThan(audit);
  });

  it("allows one method rather than denying the ones we know about today", () => {
    /*
     * A deny-list silently admits every method added later — OTHER already
     * exists and means nothing yet. The check names MANUAL_BANK and nothing
     * else, so a new method arrives refused.
     */
    expect(code).not.toContain("SSLCOMMERZ");
    expect(code).not.toContain("'CARD'");
    expect(code).not.toContain("'OTHER'");
  });

  it("records the approved method in the audit row", () => {
    expect(code).toContain("'method', v_method");
  });

  it("gives every refusal the action can raise a message on the screen", () => {
    const map = actions.slice(actions.indexOf("const MESSAGES"), actions.indexOf("function codeFor"));
    const codes = [...map.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
    expect(codes).toContain("not-manual");
    for (const c of [...codes, "decision-failed"]) {
      expect(page, `no message for ${c}`).toContain(`"${c}"`);
    }
  });
});
