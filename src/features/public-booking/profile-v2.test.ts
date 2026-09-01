import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { safePublicPhotoUrl } from "./public-photo";

/**
 * The public profile is the one page an anonymous stranger can reach. Two
 * things must hold on it: a doctor's private storage never becomes public, and
 * a booking link means the chamber it was pressed beside.
 */

/**
 * A file with its comments removed.
 *
 * Negative assertions must read the CODE. The prose in this codebase names the
 * things it deliberately does not do — "not a disabled one", "this was
 * `?? bookable[0]`" — so scanning raw text makes the explanation fail the test,
 * which pushes the explanation out rather than the defect.
 */
async function code(file: string) {
  return (await readFile(path.resolve(file), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("a booking link means the chamber it was pressed beside", () => {
  /**
   * The defect this guards: `find(...) ?? bookable[0]` sent a patient who asked
   * for Dhanmondi to whichever chamber sorted first — a different
   * neighbourhood, a real appointment, and nothing on screen saying so.
   *
   * The resolution lives inline in the server component, so it is read from the
   * source. `public-profile-ui.test.ts` pins the two exact lines; this asserts
   * the property they exist for — no substitution reaches the booking form.
   */
  it("an unresolved chamber sends the patient back to choose, never to another chamber", async () => {
    const src = await code("src/app/dr/[slug]/book/page.tsx");

    expect(src).toMatch(/bookable\.find\(\(c\) => c\.locationId === requestedLocation\)/);
    expect(src).toMatch(/if \(!chamber\) redirect\(`\/dr\/\$\{encodeURIComponent\(slug\)\}`\)/);

    // No fallback, in any of its spellings.
    expect(src).not.toMatch(/\?\?\s*bookable\[0\]/);
    expect(src).not.toMatch(/\|\|\s*bookable\[0\]/);
    expect(src).not.toMatch(/bookable\[0\]/);

    // Past the redirect there is exactly one chamber, and the form books it.
    expect(src).toMatch(/name="locationId" value=\{chamber\.locationId\}/);
  });
});

describe("a private storage path never becomes public", () => {
  it("accepts a signed HTTPS URL", () => {
    const url = "https://project.supabase.co/storage/v1/object/sign/x/y.jpg?token=abc";
    expect(safePublicPhotoUrl(url)).toBe(url);
  });

  it("rejects every unsafe scheme", () => {
    /**
     * `data:` and `blob:` can carry a payload of their own into an `<img>`,
     * `javascript:` is obvious, and `http:` would put a signed URL on the wire
     * in plain text.
     */
    for (const bad of [
      "http://project.supabase.co/x.jpg",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "javascript:alert(1)",
      "blob:https://example.com/abc",
      "file:///etc/passwd",
    ]) {
      expect(safePublicPhotoUrl(bad), bad).toBeNull();
    }
  });

  it("rejects a bare storage path, which is what a leak would look like", () => {
    // Not absolute, so it would resolve against our own origin — a private key
    // turned into a request by the browser.
    for (const bad of [
      "doctors/abc-123/portrait.jpg",
      "/storage/v1/object/doctors/abc-123/portrait.jpg",
      "../../secret.jpg",
    ]) {
      expect(safePublicPhotoUrl(bad), bad).toBeNull();
    }
  });

  it("rejects credentials smuggled into the URL", () => {
    expect(safePublicPhotoUrl("https://user:pw@evil.example/x.jpg")).toBeNull();
  });

  it("rejects anything that is not a string", () => {
    for (const bad of [null, undefined, 42, {}, [], true, ""]) {
      expect(safePublicPhotoUrl(bad), String(bad)).toBeNull();
    }
  });

  it("the app never receives or handles a storage path", async () => {
    /**
     * The Edge Function takes only the slug, re-checks PUBLIC visibility and
     * derives the path itself. A doctor's path cannot be guessed because it is
     * never an input — there is nothing to guess AT.
     */
    const src = await readFile(path.resolve("src/features/public-booking/queries.ts"), "utf8");
    const photo = src.slice(src.indexOf("getPublicDoctorPhotoUrl"));
    const body = photo.slice(0, photo.indexOf("export async function getPublicSlots"));

    expect(body).toMatch(/body:\s*\{\s*slug:/);
    expect(body).not.toMatch(/professional_photo_path|photoPath|storage\.from|createSignedUrl/);
    expect(body).toMatch(/safePublicPhotoUrl\(/);
  });

  it("a doctor whose profile is not public gets no portrait, and the page still renders", async () => {
    /**
     * Visibility is re-checked at the source, not by the caller — and a failed
     * or refused photo is non-fatal, because the initials fallback is the safe
     * presentation state rather than a broken profile.
     */
    const src = await readFile(path.resolve("src/features/public-booking/queries.ts"), "utf8");
    expect(src).toMatch(/re-checks PUBLIC visibility/);
    expect(src).toMatch(/return null/);

    const page = await readFile(path.resolve("src/app/dr/[slug]/page.tsx"), "utf8");
    expect(page).toMatch(/photoUrl=\{photoUrl\}/);
  });

  it("the initials fallback survives a missing portrait", async () => {
    const avatar = await readFile(
      path.resolve("src/features/public-booking/components/public-doctor-avatar.tsx"),
      "utf8",
    );
    // Renders from the name when there is no URL.
    expect(avatar).toMatch(/photoUrl/);
    expect(avatar).toMatch(/fullName/);
  });
});

describe("the profile reads identity, then credibility, then chambers", () => {
  it("nothing is invented — every hero field renders only when present", async () => {
    const hero = await readFile(
      path.resolve("src/features/public-booking/components/doctor-hero.tsx"),
      "utf8",
    );
    for (const field of ["designation", "specialization", "qualification", "bmdc"]) {
      expect(hero.includes(field), `${field} missing from the hero`).toBe(true);
    }
    // Credibility rows are filtered, so an absent field leaves no empty label.
    expect(hero).toMatch(/\.filter\(/);
    // A registration number is shown, never asserted as verified.
    expect(hero).toMatch(/does not verify/);
  });

  it("each chamber owns its own CTA, carrying its own location", async () => {
    const card = await readFile(
      path.resolve("src/features/public-booking/components/chamber-card.tsx"),
      "utf8",
    );
    expect(card).toMatch(/chamber\.bookingEnabled \?/);
    expect(card).toMatch(/loc=\$\{encodeURIComponent\(chamber\.locationId\)\}/);
    // Both halves encoded, or a reserved character builds a different link.
    expect(card).toMatch(/\/dr\/\$\{encodeURIComponent\(slug\)\}/);
    expect(card).toMatch(/data-booking-location=\{chamber\.locationId\}/);
  });

  it("booking switched off offers no control at all, not a disabled one", async () => {
    // A greyed-out button reads as a temporary outage and invites tapping.
    const card = await code("src/features/public-booking/components/chamber-card.tsx");
    expect(card).toMatch(/data-public-chamber-booking-unavailable/);
    expect(card).not.toMatch(/\bdisabled\b/);
  });

  it("the layout cannot scroll sideways on a phone", async () => {
    const [page, card, hero] = await Promise.all([
      readFile(path.resolve("src/app/dr/[slug]/page.tsx"), "utf8"),
      readFile(path.resolve("src/features/public-booking/components/chamber-card.tsx"), "utf8"),
      readFile(path.resolve("src/features/public-booking/components/doctor-hero.tsx"), "utf8"),
    ]);
    // Chambers stack vertically at every width — no horizontal rail.
    expect(page).toMatch(/grid min-w-0 gap-5/);
    expect(page).not.toMatch(/overflow-x-auto|snap-x/);
    // Long names and addresses wrap rather than widening the page.
    for (const [name, src] of [["card", card], ["hero", hero]] as const) {
      expect(src.includes("min-w-0"), `${name} needs min-w-0`).toBe(true);
      expect(src.includes("break-words"), `${name} needs break-words`).toBe(true);
    }
    // Full-width CTA on mobile, and a real touch target.
    expect(card).toMatch(/w-full/);
    expect(card).toMatch(/min-h-12/);
  });
});
