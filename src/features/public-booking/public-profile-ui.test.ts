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

    const avatar = source("src/features/public-booking/components/public-doctor-avatar.tsx");
    expect(avatar).toContain("data-public-profile-avatar-fallback");
    expect(avatar).toContain("size-24");
    expect(avatar).toContain("sm:size-28");
  });

  it("renders only HTTPS portrait URLs, never a raw/private path or active URL scheme", () => {
    expect(safePublicPhotoUrl("https://example.com/portrait.jpg")).toBe("https://example.com/portrait.jpg");
    expect(safePublicPhotoUrl("javascript:alert(1)")).toBeNull();
    expect(safePublicPhotoUrl("data:image/png;base64,abc")).toBeNull();
    expect(safePublicPhotoUrl("private/doctor-profile-photos/user/photo")).toBeNull();

    const policy = source("supabase/policies/0030_paid_doctor_commercial.sql");
    const start = policy.indexOf("create or replace function public.public_doctor_profile(");
    const end = policy.indexOf("\n$$;", start);
    const profileRpc = policy.slice(start, end);
    expect(profileRpc).not.toContain("professional_photo_path");
  });

  it("keeps booking chamber-specific and shows an explicit unavailable state", () => {
    const profile = source("src/app/dr/[slug]/page.tsx");

    expect(profile).toContain("doctor.chambers.map((chamber)");
    expect(profile).toContain("chamber.bookingEnabled ?");
    expect(profile).toContain("data-public-chamber-booking-cta");
    expect(profile).toContain("data-booking-location={chamber.locationId}");
    expect(profile).toContain("book?loc=${encodeURIComponent(chamber.locationId)}");
    expect((profile.match(/Book appointment/g) ?? []).length).toBe(1);
    expect(profile).toContain("Online booking unavailable");
  });

  it("requires the exact requested bookable chamber and never silently falls back", () => {
    const booking = source("src/app/dr/[slug]/book/page.tsx");

    expect(booking).toContain("const chamber = bookable.find((c) => c.locationId === requestedLocation);");
    expect(booking).toContain("if (!chamber) redirect(`/dr/${encodeURIComponent(slug)}`);");
    expect(booking).not.toContain("?? bookable[0]");
    expect(booking).not.toContain("|| bookable[0]");
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

describe("M5 publication, privacy and sharing boundary", () => {
  it("keeps publication doctor-owned and never accepts another doctor's identity", () => {
    const action = source("src/features/doctor/publication-actions.ts");
    expect(action).toContain('.eq("user_id", user.id)');
    expect(action).toContain("profile_visibility: parsed.data");
    expect(action).not.toContain("doctorId");
    expect(action).not.toContain("profileId");
    expect(action).not.toContain("service_role");
  });

  it("requires a stable slug before publishing and surfaces explicit private/published controls", () => {
    const action = source("src/features/doctor/publication-actions.ts");
    const controls = source("src/features/doctor/components/public-profile-controls.tsx");
    expect(action).toContain("Choose and save your public profile link before publishing.");
    expect(controls).toContain("Private — anonymous visitors cannot view this profile.");
    expect(controls).toContain("Published — anyone with this link can view the approved public fields.");
    expect(controls).toContain("Publish profile");
    expect(controls).toContain("Unpublish");
  });

  it("keeps professional editor wording aligned with the current publication state", () => {
    const page = source("src/app/(app)/settings/professional/page.tsx");
    expect(page).toContain('profile.visibility === "PUBLIC"');
    expect(page).toContain("Public profile is live. Only supported public fields appear on your shared page.");
    expect(page).toContain("Private to you. Nothing here is published or searchable.");
    expect(page).toContain("data-m5-publication-copy");
  });

  it("shares only the stable /dr slug route through supported browser/platform flows", () => {
    const controls = source("src/features/doctor/components/public-profile-controls.tsx");
    const publicShare = source("src/features/public-booking/components/public-share-actions.tsx");
    expect(controls).toContain("`/dr/${encodeURIComponent(slug)}`");
    expect(controls).toContain("navigator.share");
    expect(controls).toContain("https://wa.me/");
    expect(controls).toContain("facebook.com/sharer/sharer.php");
    expect(controls).toContain("paste it into Messenger");
    expect(publicShare).toContain("navigator.clipboard.writeText(currentUrl())");
  });

  it("builds social metadata only after the public allowlist RPC resolves a profile", () => {
    const profile = source("src/app/dr/[slug]/page.tsx");
    expect(profile).toContain("const doctor = await getPublicDoctor(slug)");
    expect(profile).toContain("if (!doctor)");
    expect(profile).toContain("openGraph");
    expect(profile).toContain('siteName: "Doctor\'s Diary"');
    expect(profile).not.toContain("patient");
    expect(profile).not.toContain("audit");
    expect(profile).not.toContain("professional_photo_path");
  });
});
