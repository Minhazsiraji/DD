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

/**
 * The file with its comments removed.
 *
 * Negative assertions must read the CODE. The prose here names the things this
 * code deliberately does not do — "this was `?? bookable[0]`", "a greyed-out
 * Book Now reads as an outage" — so scanning raw text makes the explanation
 * fail the test, which pushes the explanation out rather than the defect.
 */
function code(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
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

  /**
   * The card markup moved out of the page into `ChamberCard` when the profile
   * was rebuilt. What it protects is unchanged: one CTA per chamber, carrying
   * that chamber's own location.
   */
  it("keeps booking chamber-specific and renders a CTA only from each chamber's flag", () => {
    const profile = source("src/app/dr/[slug]/page.tsx");
    const card = source("src/features/public-booking/components/chamber-card.tsx");

    expect(profile).toContain("doctor.chambers.map((chamber)");
    expect(profile).toContain("<ChamberCard");

    expect(card).toContain("chamber.bookingEnabled ?");
    expect(card).toContain("data-public-chamber-booking-cta");
    expect(card).toContain("data-booking-location={chamber.locationId}");
    expect(card).toContain("book?loc=${encodeURIComponent(chamber.locationId)}");
    // Counted in code, so the comment explaining the disabled-button decision
    // does not read as a second button.
    expect((code("src/features/public-booking/components/chamber-card.tsx").match(/Book Now/g) ?? []).length).toBe(1);
  });

  /**
   * THIS ASSERTION USED TO REQUIRE THE BUG.
   *
   * It read `find(...) ?? bookable[0]` and called that "instead of silently
   * choosing the first chamber" — but that expression IS silently choosing the
   * first chamber whenever the requested one does not resolve. A patient who
   * pressed Book Now on Dhanmondi, after booking there was switched off, was
   * moved to whichever chamber sorted first and booked a real appointment
   * there.
   *
   * The requested location is honoured only when it resolves. When it does
   * not, the patient goes back to the profile to choose again — nothing on the
   * booking page is ever preselected on their behalf.
   */
  it("requires the exact requested bookable chamber and never silently falls back", () => {
    const booking = source("src/app/dr/[slug]/book/page.tsx");

    expect(booking).toContain(
      "const chamber = bookable.find((c) => c.locationId === requestedLocation);",
    );
    expect(booking).toContain(
      "if (!chamber) redirect(`/dr/${encodeURIComponent(slug)}`);",
    );
    // Read from code: the prose above names the defect on purpose.
    const bookingCode = code("src/app/dr/[slug]/book/page.tsx");
    expect(bookingCode).not.toContain("?? bookable[0]");
    expect(bookingCode).not.toContain("|| bookable[0]");
    expect(booking).toContain('name="locationId" value={chamber.locationId}');
  });

  it("stacks profile and chamber CTA layout on phones but keeps a horizontal desktop composition", () => {
    const hero = source("src/features/public-booking/components/doctor-hero.tsx");
    const card = source("src/features/public-booking/components/chamber-card.tsx");

    // Hero: stacked and centred on a phone, side by side from `sm`.
    expect(hero).toContain("flex-col items-center");
    expect(hero).toContain("sm:flex-row");
    expect(hero).toContain("text-center");

    // Chamber: one column on a phone, detail beside the CTA on desktop.
    expect(card).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
    expect(card).toContain("w-full");
    expect(card).toContain("min-h-12");
  });
});
