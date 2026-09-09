import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RUNTIME = path.resolve(
  "supabase/policies/0041_prescription_correction_window.sql",
);
const RUNTIME_FROZEN = path.resolve(
  "supabase/policies/0024_correction_trust_boundary.sql",
);
const V2 = path.resolve("db/p1/0014_p1_prescription_correction_window.sql");
const V2_FROZEN = path.resolve("db/functions/0002_p0_core.sql");

function read(file: string) {
  return readFileSync(file, "utf8");
}

// The frozen-blob assertions below reason about canonical repository text, whose
// bytes are LF in git. On a CRLF working tree (Windows, core.autocrlf=true) the
// raw read differs from the committed blob byte-for-byte. Normalising only the
// line-ending representation keeps the git-blob SHA check checkout-independent
// without touching content: genuinely different bytes still change the hash.
function canonicalText(file: string) {
  return read(file).replace(/\r\n/g, "\n");
}

function code(file: string) {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function gitBlobSha(text: string) {
  const payload = Buffer.from(text, "utf8");
  return createHash("sha1")
    .update(`blob ${payload.length}\0`)
    .update(payload)
    .digest("hex");
}

function before(source: string, left: string, right: string) {
  const a = source.indexOf(left);
  const b = source.indexOf(right);
  expect(a, `missing: ${left}`).toBeGreaterThanOrEqual(0);
  expect(b, `missing: ${right}`).toBeGreaterThanOrEqual(0);
  expect(a, `${left} must precede ${right}`).toBeLessThan(b);
}

describe("prescription correction window frozen baselines", () => {
  it("does not rewrite the trusted runtime boundary", () => {
    expect(gitBlobSha(canonicalText(RUNTIME_FROZEN))).toBe(
      "6f268f057d10791f2bf2c527cbfb7ab411a94fb0",
    );
  });

  it("does not rewrite the accepted P0/V2 core", () => {
    expect(gitBlobSha(canonicalText(V2_FROZEN))).toBe(
      "4718be8de89d2f8fe2bf160b4441feb06f87b687",
    );
  });
});

describe("runtime correction authorization", () => {
  const sql = code(RUNTIME);

  it("serializes first, then re-reads canonical finalized state, then samples DB wall time", () => {
    before(sql, "pg_advisory_xact_lock", "select * into v_rx from public.prescriptions");
    before(sql, "select * into v_rx from public.prescriptions", "v_rx.finalized_at is null");
    before(sql, "v_rx.finalized_at is null", "v_authorized_at := clock_timestamp()");
    before(sql, "v_authorized_at := clock_timestamp()", "CORRECTION_WINDOW_EXPIRED");

    expect(sql).toContain("v_rx.status <> 'FINALIZED'");
    expect(sql).toContain("PRESCRIPTION_FINALIZATION_STATE_INVALID");
    expect(sql).toContain(
      "if v_authorized_at > v_rx.finalized_at + interval '48 hours' then",
    );
    expect(sql).not.toMatch(/v_authorized_at\s*>=/);
    expect(sql).not.toMatch(/transaction_timestamp\s*\(|\bnow\s*\(/);
  });

  it("closes the ordinary path after expiry before idempotent lineage navigation", () => {
    before(sql, "CORRECTION_WINDOW_EXPIRED", "where replaces_prescription_id = p_prescription_id");
    before(sql, "where replaces_prescription_id = p_prescription_id", "PRESCRIPTION_REPLACEMENT_NEEDS_REASON");
  });

  it("preserves a blank successor and immutable predecessor", () => {
    expect(sql).toContain("insert into public.prescriptions");
    expect(sql).toContain("replaces_prescription_id, replacement_reason, created_by");
    expect(sql).not.toContain("insert into public.prescription_items");
    expect(sql).not.toMatch(/update public\.prescriptions/);
  });

  it("preserves lineage and operational audit without putting the clinical reason in audit metadata", () => {
    expect(sql).toContain("p_prescription_id, v_reason, auth.uid()");
    expect(sql).toContain("'REPLACEMENT_STARTED'::public.prescription_event_type");
    expect(sql).toContain("'prescription.replacement_started'");
    expect(sql).toContain("jsonb_build_object('encounterId', v_rx.encounter_id, 'replaces', p_prescription_id)");
  });

  it("keeps only the bounded authenticated correction surface callable", () => {
    expect(sql).toContain("drop function if exists public.start_prescription_correction(uuid, text)");
    expect(sql).toContain("drop function if exists public.open_prescription(uuid, uuid, text)");
    expect(sql).toMatch(
      /revoke all on function public\.start_prescription_correction\(uuid, uuid, text\) from public, anon, authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.start_prescription_correction\(uuid, uuid, text\) to authenticated/,
    );
  });
});

describe("accepted V2 parity hardening", () => {
  const sql = code(V2);

  it("serializes and locks the canonical predecessor before authorizing by DB time", () => {
    before(sql, "pg_advisory_xact_lock", "select * into original from public.prescriptions");
    expect(sql).toContain("and status = 'FINALIZED' for update");
    before(sql, "select * into original from public.prescriptions", "original.finalized_at is null");
    before(sql, "original.finalized_at is null", "authorized_at := clock_timestamp()");
    before(sql, "authorized_at := clock_timestamp()", "CORRECTION_WINDOW_EXPIRED");
    expect(sql).toContain(
      "if authorized_at > original.finalized_at + interval '48 hours' then",
    );
    expect(sql).not.toMatch(/authorized_at\s*>=/);
    expect(sql).not.toMatch(/transaction_timestamp\s*\(|\bnow\s*\(/);
  });

  it("keeps V2 one-successor, reason, item-copy, lineage and audit contracts", () => {
    before(sql, "CORRECTION_WINDOW_EXPIRED", "CORRECTION_REASON_REQUIRED");
    before(sql, "CORRECTION_REASON_REQUIRED", "PRESCRIPTION_ALREADY_CORRECTED");
    expect(sql).toContain("replaces_prescription_id = original_key");
    expect(sql).toContain("insert into public.prescription_items");
    expect(sql).toContain("where prescription_id = original_key order by position");
    expect(sql).toContain("'CORRECTION_STARTED', 'USER', public.current_profile_id()");
    expect(sql).toContain("'PRESCRIPTION_CORRECTION_STARTED'");
  });

  it("does not widen V2 grants or create a service-role shortcut", () => {
    expect(sql).toMatch(
      /revoke all on function public\.create_prescription_correction\(uuid, text\) from public, anon, authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.create_prescription_correction\(uuid, text\) to authenticated/,
    );
  });
});

describe("locked 48-hour boundary semantics", () => {
  const hour = 60 * 60 * 1000;
  const expired = (authorizedAt: number, finalizedAt: number) =>
    authorizedAt > finalizedAt + 48 * hour;

  it("allows +47:59:59", () => {
    expect(expired(48 * hour - 1000, 0)).toBe(false);
  });

  it("allows exactly +48:00:00", () => {
    expect(expired(48 * hour, 0)).toBe(false);
  });

  it("expires the first representable instant after +48:00:00", () => {
    expect(expired(48 * hour + 1, 0)).toBe(true);
  });
});
