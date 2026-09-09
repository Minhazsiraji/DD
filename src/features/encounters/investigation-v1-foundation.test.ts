import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseConfirmationRpcRow,
  parseInvestigationConfirmationInput,
} from "./investigation-v1-contract";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/policies/0046_investigation_v1_foundation.sql"),
  "utf8",
);

const confirmationStart = migration.indexOf(
  "create or replace function public.confirm_encounter_investigations",
);
const recentStart = migration.indexOf(
  "create or replace function public.recent_encounter_investigations",
);
const historyStart = migration.indexOf(
  "create or replace function public.patient_investigation_history",
);

const confirmationSql = migration.slice(confirmationStart, recentStart);
const recentSql = migration.slice(recentStart, historyStart);
const historySql = migration.slice(historyStart);

const encounterId = "11111111-1111-4111-8111-111111111111";
const operationKey = "22222222-2222-4222-8222-222222222222";

describe("Investigation V1 local staging contract", () => {
  it("accepts one Doctor-authored custom investigation", () => {
    const parsed = parseInvestigationConfirmationInput({
      encounterId,
      expectedVersion: 4,
      operationKey,
      investigations: [{ name: "  CBC with platelet count  " }],
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        encounterId,
        expectedVersion: 4,
        operationKey,
        investigations: [{ name: "CBC with platelet count", note: null }],
      },
    });
  });

  it("preserves the staged order and optional notes for several investigations", () => {
    const parsed = parseInvestigationConfirmationInput({
      encounterId,
      expectedVersion: 8,
      operationKey,
      investigations: [
        { name: "CBC", note: "  urgent  " },
        { name: "Serum creatinine", note: null },
        { name: "Chest X-ray", note: "   " },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.investigations).toEqual([
      { name: "CBC", note: "urgent" },
      { name: "Serum creatinine", note: null },
      { name: "Chest X-ray", note: null },
    ]);
  });

  it("fails closed for an empty batch or missing operation identity", () => {
    expect(
      parseInvestigationConfirmationInput({
        encounterId,
        expectedVersion: 1,
        operationKey,
        investigations: [],
      }).ok,
    ).toBe(false);
    expect(
      parseInvestigationConfirmationInput({
        encounterId,
        expectedVersion: 1,
        investigations: [{ name: "CBC" }],
      }).ok,
    ).toBe(false);
  });

  it("enforces free-text name/note bounds before the RPC", () => {
    expect(
      parseInvestigationConfirmationInput({
        encounterId,
        expectedVersion: 1,
        operationKey,
        investigations: [{ name: "x".repeat(301) }],
      }).ok,
    ).toBe(false);
    expect(
      parseInvestigationConfirmationInput({
        encounterId,
        expectedVersion: 1,
        operationKey,
        investigations: [{ name: "CBC", note: "x".repeat(2001) }],
      }).ok,
    ).toBe(false);
  });

  it("accepts only a believable authoritative confirmation result", () => {
    expect(
      parseConfirmationRpcRow([{ result_version: 5, confirmed_count: 3, replayed: false }]),
    ).toEqual({ resultVersion: 5, confirmedCount: 3, replayed: false });
    expect(
      parseConfirmationRpcRow([{ result_version: 5, confirmed_count: 3, replayed: true }]),
    ).toEqual({ resultVersion: 5, confirmedCount: 3, replayed: true });
    expect(parseConfirmationRpcRow([{ result_version: 5, confirmed_count: 0, replayed: false }])).toBeNull();
  });
});

describe("0046 atomic confirmation authority", () => {
  it("defines one batch confirmation RPC and never redefines the old Investigation mutation RPCs", () => {
    expect(confirmationStart).toBeGreaterThan(-1);
    expect((migration.match(/create or replace function public\.confirm_encounter_investigations/g) ?? []).length).toBe(1);
    expect(migration).not.toMatch(/create or replace function public\.add_encounter_investigation\s*\(/);
    expect(migration).not.toMatch(/create or replace function public\.update_encounter_investigation\s*\(/);
    expect(migration).not.toMatch(/create or replace function public\.remove_encounter_investigation\s*\(/);
  });

  it("derives Doctor authority, requires AAL2 and binds the active practice location", () => {
    expect(confirmationSql).toContain("public.session_is_aal2()");
    expect(confirmationSql).toContain("v_doctor := public.current_doctor_id()");
    expect(confirmationSql).toContain(
      "public.doctor_practises_at(v_doctor, p_practice_location_id)",
    );
    expect(confirmationSql).not.toMatch(/p_doctor_id/i);
  });

  it("uses the accepted encounter lock/CAS helper so stale, wrong Doctor/location and terminal encounters fail closed", () => {
    expect(confirmationSql).toContain("perform public.encounter_for_update(");
    expect(confirmationSql).toContain("p_expected_version");
    expect(confirmationSql).toContain("p_practice_location_id");
  });

  it("validates the entire ordered batch before the first clinical insert", () => {
    const validate = confirmationSql.indexOf("for v_item in select value from jsonb_array_elements(p_rows)");
    const insert = confirmationSql.indexOf("insert into public.encounter_investigations");
    expect(validate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(validate);
    expect(confirmationSql).toContain("where k.key not in ('name', 'note')");
  });

  it("advances encounter version once for the whole batch, not once per row", () => {
    expect((confirmationSql.match(/update public\.encounters/g) ?? []).length).toBe(1);
    expect(confirmationSql).toContain("set version = version + 1");
  });

  it("provides durable idempotency and safe replay after an unknown outcome", () => {
    expect(migration).toContain("create table if not exists public.investigation_confirmation_operations");
    expect(migration).toContain("primary key (owner_doctor_id, operation_key)");
    expect(confirmationSql).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(confirmationSql).toContain("extensions.digest(");
    expect(confirmationSql).toContain("INVESTIGATION_OPERATION_KEY_REUSE");
    expect(confirmationSql).toContain(
      "select v_operation.result_version, v_operation.confirmed_count, true",
    );
  });

  it("makes the operation record part of the same database function/transaction as the clinical rows", () => {
    const clinicalInsert = confirmationSql.indexOf("insert into public.encounter_investigations");
    const operationInsert = confirmationSql.indexOf(
      "insert into public.investigation_confirmation_operations",
    );
    expect(clinicalInsert).toBeGreaterThan(-1);
    expect(operationInsert).toBeGreaterThan(clinicalInsert);
    expect(confirmationSql).not.toMatch(/\bcommit\b|\brollback\b/i);
  });

  it("writes existing clinical events and a single safe operational audit without note/name payload", () => {
    expect(confirmationSql).toContain("'INVESTIGATION_ADDED'");
    const auditStart = confirmationSql.indexOf("perform public.log_encounter_audit(");
    const operationInsert = confirmationSql.indexOf(
      "insert into public.investigation_confirmation_operations",
    );
    const audit = confirmationSql.slice(auditStart, operationInsert);
    expect(audit).toContain("'encounter.investigations_confirmed'");
    expect(audit).toContain("'confirmedCount', v_count");
    expect(audit).not.toContain("v_name");
    expect(audit).not.toContain("v_note");
  });

  it("hardens SECURITY DEFINER search_path and execute ACL exactly to authenticated", () => {
    for (const section of [confirmationSql, recentSql, historySql]) {
      expect(section).toContain("security definer");
      expect(section).toContain("set search_path = public, pg_temp");
      expect(section).toContain("from public, anon, authenticated, service_role");
      expect(section).toContain("to authenticated;");
    }
  });

  it("gives the new operation table RLS + FORCE RLS and no direct authenticated CRUD", () => {
    expect(migration).toContain(
      "alter table public.investigation_confirmation_operations enable row level security",
    );
    expect(migration).toContain(
      "alter table public.investigation_confirmation_operations force row level security",
    );
    expect(migration).toContain(
      "revoke all on public.investigation_confirmation_operations\n  from public, anon, authenticated, service_role",
    );
    expect(migration).not.toMatch(/create policy .*investigation_confirmation_operations/i);
  });
});

describe("0046 longitudinal reads", () => {
  it("Recent is persisted Doctor history and is not accidentally chamber-truncated", () => {
    expect(recentSql).toContain("from public.encounter_investigations i");
    expect(recentSql).toContain("where e.owner_doctor_id = v_doctor");
    expect(recentSql).toContain("count(*)::bigint as usage_count");
    expect(recentSql).toContain("order by max(i.created_at) desc");
    expect(recentSql).not.toContain("p_practice_location_id");
  });

  it("Recent cannot use another Doctor's repository", () => {
    expect(recentSql).not.toMatch(/doctor_practises_at\([^)]*e\.practice_location_id/);
    expect(recentSql).toContain("v_doctor := public.current_doctor_id()");
  });

  it("patient history proves exact Doctor-owned patient and encounter isolation", () => {
    expect(historySql).toContain("p.owner_doctor_id = v_doctor");
    expect(historySql).toContain("e.owner_doctor_id = v_doctor");
    expect(historySql).toContain("e.patient_id = p_patient_id");
    expect(historySql).not.toMatch(/p_practice_location_id/);
  });

  it("history returns order context but no result/LIS interpretation contract", () => {
    expect(historySql).toContain("investigation_name");
    expect(historySql).toContain("ordered_at");
    expect(historySql).toContain("ordering_doctor_name");
    expect(historySql).toContain("practice_location_name");
    const returnShape = historySql.slice(
      historySql.indexOf("returns table"),
      historySql.indexOf(")\nlanguage plpgsql"),
    );
    expect(returnShape).not.toMatch(/result|interpret|specimen|lis_status|billing/i);
  });
});

describe("INV1-BF-01 frozen boundaries", () => {
  it("does not create a database Investigation catalog or AI/direct-confirm path", () => {
    expect(migration).not.toMatch(/create table .*catalog/i);
    expect(migration).not.toMatch(/openai|deepgram/i);
  });

  it("does not redefine diagnosis behavior", () => {
    expect(migration).not.toMatch(/create or replace function public\.(add|update|remove)_encounter_diagnosis/);
  });
});
