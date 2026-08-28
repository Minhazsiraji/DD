import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  doctorInitials,
  safePublicPhotoUrl,
} from "./components/public-doctor-avatar";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

describe("public doctor profile presentation", () => {
  it("always has a professional avatar fallback when no safe portrait URL exists", () => {
    expect(doctorInitials("Dr Ayesha Rahman")).toBe("DR");
    expect(doctorInitials("Ayesha Rahman")).toBe("AR");
    expect(doctorInitials("  ")).toBe("DR");

    const avatar = source(
      "src/features/public-booking/components/public-doctor-avatar.tsx",
    );
    expect(avatar).toContain("data-public-profile-avatar-fallback");
    expect(avatar).toContain("size-24");
    expect(avatar).toContain("sm:size-28");
  });

  it("renders only HTTPS portrait URLs, never a raw/private path or active URL scheme", () => {
    expect(safePublicPhotoUrl("https://example.com/portrait.jpg")).toBe(
      "https://example.com/portrait.jpg",
    );
    expect(safePublicPhotoUrl("javascript:alert(1)")).toBeNull();
    expect(safePublicPhotoUrl("data:image/png;base64,abc")).toBeNull();
    expect(safePublicPhotoUrl("private/doctor-profile-photos/user/photo")).toBeNull();

    const policy = source("supabase/policies/0030_paid_doctor_commercial.sql");
    const start = policy.indexOf("create or replace function public.public_doctor_profile(");
    const end = policy.indexOf("\n$$;", start);
    const profileRpc = policy.slice(start, end);
    expect(profileRpc).not.toContain("professional_photo_path");
  });

  it("keeps booking chamber-specific and renders a CTA only from each chamber's flag", () => {
    const profile = source("src/app/dr/[slug]/page.tsx");

    expect(profile).toContain("doctor.chambers.map((chamber)");
    expect(profile).toContain("chamber.bookingEnabled &&");
    expect(profile).toContain("data-public-chamber-booking-cta");
    expect(profile).toContain("data-booking-location={chamber.locationId}");
    expect(profile).toContain(
      "book?loc=${encodeURIComponent(chamber.locationId)}",
    );
    expect((profile.match(/Book Now/g) ?? []).length).toBe(1);
  });

  it("uses the requested bookable location instead of silently choosing the first chamber", () => {
    const booking = source("src/app/dr/[slug]/book/page.tsx");

    expect(booking).toContain(
      "bookable.find((c) => c.locationId === requestedLocation) ?? bookable[0]",
    );
    expect(booking).toContain('name="locationId" value={chamber.locationId}');
  });

  it("stacks profile and chamber CTA layout on phones but keeps a horizontal desktop composition", () => {
    const profile = source("src/app/dr/[slug]/page.tsx");

    expect(profile).toContain("flex-col items-center gap-5 text-center sm:flex-row");
    expect(profile).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
    expect(profile).toContain("min-h-11 w-full items-center justify-center");
    expect(profile).toContain("md:w-auto");
  });
});
