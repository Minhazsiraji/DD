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

type ContractCase = {
  visibility: "PUBLIC" | "PRIVATE";
  authRow: boolean;
  deleted: boolean;
  currentlyBanned: boolean;
  email: string | null;
  identityClass: "UNCLASSIFIED" | "REAL" | "SYNTHETIC" | "TEST";
  slug: string;
  fullName: string;
  qualification?: string;
  designation?: string;
  specialization?: string;
};

function contractEligibility(value: ContractCase): boolean {
  return (
    value.visibility === "PUBLIC" &&
    value.authRow &&
    !value.deleted &&
    !value.currentlyBanned &&
    value.identityClass === "REAL" &&
    !value.email?.toLowerCase().endsWith("@qa.invalid") &&
    value.slug.trim().length > 0 &&
    value.fullName.trim().length > 0 &&
    [value.qualification, value.designation, value.specialization].some(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    )
  );
}

const eligible: ContractCase = {
  visibility: "PUBLIC",
  authRow: true,
  deleted: false,
  currentlyBanned: false,
  email: "doctor@example.com",
  identityClass: "REAL",
  slug: "doctor-one",
  fullName: "Dr Example",
  qualification: "MBBS",
};

describe("0054 search eligibility contract", () => {
  it("is isolated from prior and reserved migration objects", () => {
    expect(migration).not.toContain("alter table public.public_booking_rate_limits");
    expect(migration).not.toContain("create table public.staff");
    expect(migration).not.toContain("drop function public.create_public_booking");
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

  it("matches the explicit CENTRAL eligibility truth table", () => {
    expect(contractEligibility(eligible)).toBe(true);
    expect(contractEligibility({ ...eligible, visibility: "PRIVATE" })).toBe(false);
    expect(contractEligibility({ ...eligible, authRow: false })).toBe(false);
    expect(contractEligibility({ ...eligible, deleted: true })).toBe(false);
    expect(contractEligibility({ ...eligible, currentlyBanned: true })).toBe(false);
    expect(contractEligibility({ ...eligible, email: "pi1.doctor.a@qa.invalid" })).toBe(false);
    expect(contractEligibility({ ...eligible, identityClass: "SYNTHETIC" })).toBe(false);
    expect(contractEligibility({ ...eligible, identityClass: "TEST" })).toBe(false);
    expect(contractEligibility({ ...eligible, identityClass: "UNCLASSIFIED" })).toBe(false);
    expect(
      contractEligibility({
        ...eligible,
        qualification: "",
        designation: "",
        specialization: "",
      }),
    ).toBe(false);
    expect(contractEligibility({ ...eligible, slug: "" })).toBe(false);
    expect(contractEligibility({ ...eligible, fullName: "" })).toBe(false);
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
