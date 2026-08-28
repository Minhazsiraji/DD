import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

const edge = source("supabase/functions/public-doctor-photo/index.ts");
const queries = source("src/features/public-booking/queries.ts");
const profilePage = source("src/app/dr/[slug]/page.tsx");
const commercialSql = source("supabase/policies/0030_paid_doctor_commercial.sql");

describe("public doctor portrait delivery boundary", () => {
  it("accepts only a profile slug and never a caller-supplied doctor id or storage path", () => {
    expect(edge).toContain('const body = (await req.json()) as { slug?: unknown }');
    expect(edge).toContain('typeof body.slug === "string"');
    expect(edge).not.toMatch(/body\.(?:path|photoPath|storagePath|doctorId|userId)/);
    expect(edge).not.toMatch(/req\.(?:path|photoPath|doctorId)/);
  });

  it("re-proves PUBLIC visibility before privileged photo access", () => {
    expect(edge).toContain('.eq("profile_slug", slug)');
    expect(edge).toContain('.eq("profile_visibility", "PUBLIC")');
    expect(edge).toContain("if (error || !doctor)");
    expect(edge).toContain("status: 404");
  });

  it("binds the stored portrait key to the resolved doctor's own user id", () => {
    expect(edge).toContain('.select("user_id, professional_photo_path")');
    expect(edge).toContain('const expectedPath = userId ? `${userId}/photo` : ""');
    expect(edge).toContain("storedPath !== expectedPath");
    expect(edge).toContain("createSignedUrl(expectedPath, PHOTO_TTL_SECONDS)");
  });

  it("keeps signed delivery short-lived and returns only a safe HTTPS URL", () => {
    expect(edge).toContain("const PHOTO_TTL_SECONDS = 90");
    expect(edge).toContain('signed.protocol !== "https:"');
    expect(edge).toContain("signed.origin !== project.origin");
    expect(edge).toContain("Response.json({ photoUrl }");
    expect(edge).not.toMatch(/Response\.json\(\{[^}]*professional_photo_path/);
    expect(edge).not.toMatch(/Response\.json\(\{[^}]*storedPath/);
    expect(edge).not.toMatch(/Response\.json\(\{[^}]*expectedPath/);
  });

  it("does not add the raw photo path to the anonymous public profile RPC", () => {
    const start = commercialSql.indexOf(
      "create or replace function public.public_doctor_profile(",
    );
    const end = commercialSql.indexOf("\n$$;", start);
    const publicProfileRpc = commercialSql.slice(start, end);

    expect(publicProfileRpc).not.toContain("professional_photo_path");
  });

  it("has the server-rendered public profile request the broker by slug only", () => {
    expect(queries).toContain('supabase.functions.invoke("public-doctor-photo"');
    expect(queries).toContain("body: { slug: normalized }");
    expect(queries).not.toContain("body: { path:");
    expect(profilePage).toContain("getPublicDoctorPhotoUrl(slug)");
    expect(profilePage).toContain(
      "<PublicDoctorAvatar fullName={doctor.fullName} photoUrl={photoUrl} />",
    );
  });
});
