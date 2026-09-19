import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0054_seo_search_eligibility.sql"),
  "utf8",
);

const eligibilityFunction = migration.slice(
  migration.indexOf("create or replace function public.is_doctor_search_indexable"),
  migration.indexOf("create or replace function public.public_search_indexable_doctor_slugs"),
);

const publicProfileFunction = migration.slice(
  migration.indexOf("create or replace function public.public_doctor_profile"),
);

function expectPredicate(fragment: string) {
  expect(eligibilityFunction).toContain(fragment);
}

describe("0054 search eligibility contract", () => {
  it("is allocated as a separate migration and never references reserved migrations", () => {
    expect(migration).not.toContain("0051_m5_booking_rules");
    expect(migration).not.toContain("0052_public_booking_anti_abuse");
    expect(migration).not.toContain("0053_staff_management_v1");
  });

  it("keeps classification private and fail-closed", () => {
    expect(migration).toContain("'UNCLASSIFIED',");
    expect(migration).toContain("'REAL',");
    expect(migration).toContain("'SYNTHETIC',");
    expect(migration).toContain("'TEST'");
    expect(migration).toContain("search_identity_class public.search_identity_class not null default 'UNCLASSIFIED'");
    expect(migration).toContain("revoke all on table public.doctor_search_identities from anon");
    expect(migration).toContain("revoke all on table public.doctor_search_identities from authenticated");
  });

  it("requires every CENTRAL eligibility predicate", () => {
    expectPredicate("d.profile_visibility = 'PUBLIC'");
    expectPredicate("si.search_identity_class = 'REAL'");
    expectPredicate("u.deleted_at is null");
    expectPredicate("u.banned_until is null or u.banned_until < now()");
    expectPredicate("lower(u.email) not like '%@qa.invalid'");
    expectPredicate("nullif(btrim(d.profile_slug), '') is not null");
    expectPredicate("nullif(btrim(p.full_name), '') is not null");
    expectPredicate("nullif(btrim(d.qualification), '') is not null");
    expectPredicate("nullif(btrim(d.designation), '') is not null");
    expectPredicate("nullif(btrim(d.specialization), '') is not null");
  });

  it("uses safe SECURITY DEFINER search paths and withholds the private helper", () => {
    expect(eligibilityFunction).toContain("security definer");
    expect(eligibilityFunction).toContain("set search_path = public, pg_temp");
    expect(migration).toContain("revoke all on function public.is_doctor_search_indexable(uuid) from anon");
    expect(migration).toContain("revoke all on function public.is_doctor_search_indexable(uuid) from authenticated");
  });

  it("adds only the eligibility boolean to the existing public profile JSON", () => {
    expect(publicProfileFunction).toContain("'is_search_indexable', public.is_doctor_search_indexable(v_doctor.id)");
    const returnObject = publicProfileFunction.slice(publicProfileFunction.indexOf("return jsonb_build_object("));
    expect(returnObject).not.toContain("'email'");
    expect(returnObject).not.toContain("'deleted_at'");
    expect(returnObject).not.toContain("'banned_until'");
    expect(returnObject).not.toContain("'search_identity_class'");
  });

  it("exposes eligible slugs only through the public enumeration RPC", () => {
    expect(migration).toContain("where public.is_doctor_search_indexable(d.id)");
    expect(migration).toContain("grant execute on function public.public_search_indexable_doctor_slugs() to anon, authenticated, service_role");
  });
});
