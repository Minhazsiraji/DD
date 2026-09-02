import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

function code(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const PAGE = "src/app/(app)/medicines/page.tsx";
const CARD = "src/features/medicines/components/reference-list.tsx";
const LIBRARY = "src/features/medicines/components/library-list.tsx";
const FORM = "src/features/medicines/components/defaults-form.tsx";
const SEARCH = "src/features/medicines/components/medicine-search.tsx";

describe("the two layers stay visibly separate", () => {
  it("offers All Medicines and My Medicines as distinct views", () => {
    const page = source(PAGE);
    expect(page).toContain("All Medicines");
    expect(page).toContain("My Medicines");
    expect(page).toContain("data-medicine-tabs");
    // The tab lives in the URL, so a view is shareable and survives a refresh.
    expect(page).toContain('params.tab === "mine"');
  });

  it("shows the catalogue's own provenance on every row", () => {
    const card = source(CARD);
    expect(card).toContain("data-medicine-provenance");
    // "Never verified" is a fact about the row, stated rather than left blank.
    expect(card).toContain("not verified against a source");
    expect(card).toContain("countryCode");
    expect(card).toContain("regulatorName");
  });

  it("keeps the archived view reachable and separate from the active one", () => {
    const page = source(PAGE);
    expect(page).toContain("data-medicine-archived-toggle");
    expect(page).toContain('params.archived === "1"');
    expect(source(LIBRARY)).toContain("showArchived");
  });
});

describe("mobile-first at 360 / 375 / 390", () => {
  /**
   * These three widths are the phones this is used on. Nothing may force the
   * page wider than its viewport, so every text container wraps and every grid
   * starts at one column.
   */
  it("wraps rather than widening: min-w-0 and break-words throughout", () => {
    for (const file of [PAGE, CARD, LIBRARY, FORM, SEARCH]) {
      expect(source(file).includes("min-w-0"), `${file} needs min-w-0`).toBe(true);
    }
    // Long medicine names, manufacturers and instructions are the overflow risk.
    for (const file of [CARD, LIBRARY]) {
      expect(source(file).includes("break-words"), `${file} needs break-words`).toBe(true);
    }
  });

  it("stacks to one column on a phone and only spreads from md", () => {
    for (const file of [CARD, LIBRARY]) {
      const text = source(file);
      expect(text.includes("md:grid-cols-[minmax(0,1fr)_auto]"), file).toBe(true);
    }
    // No horizontal rail — chambers of controls scroll the page, not sideways.
    for (const file of [PAGE, CARD, LIBRARY]) {
      expect(source(file)).not.toMatch(/overflow-x-auto|snap-x/);
    }
  });

  it("gives every control a real touch target", () => {
    // 44px is the floor; min-h-11 is 44px and size-11 is a square one.
    for (const file of [PAGE, CARD, LIBRARY, FORM, SEARCH]) {
      expect(/min-h-1[12]|size-11|h-12/.test(source(file)), `${file}`).toBe(true);
    }
    // Full-width CTAs on a phone, auto width from md.
    expect(source(CARD)).toContain("w-full");
    expect(source(CARD)).toContain("md:w-auto");

    /**
     * The clear button was `size-8` — 32px, copied from the patient search and
     * under the floor. Measured in a browser at 360/375/390, where it was the
     * only control in this feature below 44px.
     */
    expect(source(SEARCH)).not.toContain("size-8");
    expect(source(SEARCH)).toContain("size-11");
  });

  it("uses a 16px input so iOS does not zoom the page on focus", () => {
    expect(source(SEARCH)).toContain("text-base");
    expect(source(FORM)).toContain("text-base");
  });
});

describe("the interface tells the truth about what it did", () => {
  /**
   * A disabled Add button that silently fails as a duplicate would teach a
   * doctor to press it twice. The row says "In My Medicines" instead, from the
   * same key the database uses.
   */
  it("shows saved state rather than an Add that would be refused", () => {
    const card = code(CARD);
    expect(card).toContain("findSaved");
    expect(card).toContain("data-medicine-saved");
    expect(card).toContain("In My Medicines");
  });

  it("puts a failed favourite toggle back rather than leaving the star lying", () => {
    const library = code(LIBRARY);
    expect(library).toContain("if (!r.ok) setFavorite(!next)");
    expect(library).toContain("aria-pressed");
  });

  /**
   * `revalidatePath` in a server action invalidates the SERVER cache. It does
   * NOT re-render a client component that never navigates.
   *
   * Without `router.refresh()` the sheet closed on a successful save and the
   * row underneath still read "No defaults saved yet" — the write had
   * committed, and the screen said it had not. A doctor would reasonably save
   * it again. Same defect on archive: the row stayed in the active list.
   *
   * Found by saving one in a browser; no test failed.
   */
  it("re-renders the server view after every successful write", () => {
    for (const file of [LIBRARY, CARD]) {
      const text = code(file);
      expect(text.includes("useRouter"), `${file} needs useRouter`).toBe(true);
      expect(text.includes("router.refresh()"), `${file} needs router.refresh()`).toBe(true);
    }

    /**
     * Only on success. Refreshing after a refusal would replace the doctor's
     * rejected input with the unchanged record — destroying the only copy of
     * what they typed.
     */
    expect(code(CARD)).toMatch(/if \(result\.ok\) \{[\s\S]{0,300}router\.refresh\(\)/);

    // Archive and favourite both report success upward rather than refreshing
    // in place; see the next test for why that distinction is load-bearing.
    const library = code(LIBRARY);
    expect(library).toMatch(/if \(r\.ok\) onChanged\(\)/);
    expect(library).toMatch(/if \(!r\.ok\) setFavorite\(!next\);[\s\S]{0,200}else onChanged\(\)/);
  });

  /**
   * TWO FIXES THAT LOOKED RIGHT AND CHANGED NOTHING.
   *
   * `router.refresh()` inside the sheet did nothing: saving unmounts the sheet
   * in the same tick and the refresh scheduled inside `useTransition` went with
   * it. Moving the call to the parent but still invoking it from within the
   * sheet's transition callback also did nothing, for the same reason.
   *
   * It has to run from an EFFECT — after the commit, from a component that is
   * still mounted, outside any transition. Verified in a browser: the row now
   * changes from "1+1+0 · 10 days" to "2+0+2 · 14 days" with no reload.
   */
  it("refreshes from an effect, not from inside a transition", () => {
    const form = code(FORM);
    expect(form.includes("router.refresh()"), "the sheet must NOT refresh itself").toBe(false);
    expect(form).toContain("onSaved()");

    // Saving and dismissing are different outcomes and must stay separate: only
    // one of them re-fetches, and only one of them is a write.
    expect(form).toContain("onSaved: () => void");
    expect(form).toContain("onClose: () => void");

    const library = code(LIBRARY);
    expect(library).toMatch(/React\.useEffect\(\(\) => \{[\s\S]{0,120}router\.refresh\(\)/);
    // A counter, not a boolean — a second write has to re-trigger the effect.
    expect(library).toContain("setChangedAt(Date.now())");
    expect(library).toMatch(/\[changedAt, router\]/);

    /**
     * EXACTLY ONE refresh call in the file. Every write — save, archive,
     * restore, favourite — routes through the single effect. A second
     * `router.refresh()` anywhere else would be one called from inside a
     * transition again, which is the bug this whole arrangement exists to
     * prevent.
     */
    expect((library.match(/router\.refresh\(\)/g) ?? []).length).toBe(1);
  });

  it("reports a write failure in place instead of swallowing it", () => {
    for (const file of [CARD, FORM]) {
      expect(source(file), file).toContain('role="alert"');
    }
  });

  it("says the search is literal, where the doctor is typing", () => {
    expect(source(SEARCH)).toContain("nothing is auto-corrected or substituted");
    expect(source(SEARCH)).toContain('role="status"');
  });
});

describe("the seed data is honest about what it is", () => {
  const data = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "data/medicines/starter-generics.json"), "utf8"),
  ) as { source: string; entries: Array<Record<string, unknown>> };

  it("carries a source statement that does not claim to be licensed data", () => {
    expect(data.source).toMatch(/NOT a licensed drug database/i);
    expect(data.source).toMatch(/NOT verified/i);
  });

  /**
   * No fabricated proprietary facts. A brand-to-manufacturer mapping is a
   * factual claim about a company's product; we have no source for one, so the
   * starter carries INN generic names only.
   */
  it("invents no brand names or manufacturers", () => {
    for (const e of data.entries) {
      expect(e.brandName, JSON.stringify(e)).toBeUndefined();
      expect(e.manufacturer, JSON.stringify(e)).toBeUndefined();
      // Unverified, and the app says so.
      expect(e.lastVerifiedAt).toBeUndefined();
    }
  });

  it("is not shaped around one country", () => {
    const countries = new Set(data.entries.map((e) => e.countryCode));
    expect(countries.size).toBeGreaterThan(1);
    for (const c of countries) expect(c).toMatch(/^[A-Z]{2}$/);
  });

  it("refuses to seed a file with no source", () => {
    const script = source("scripts/seed-medicines.mjs");
    expect(script).toContain('a top-level "source" string is required');
    expect(script).toContain("process.exit(1)");
    // Never fetches anything: the data is checked in and reviewed.
    expect(code("scripts/seed-medicines.mjs")).not.toMatch(/\bfetch\(|https?:\/\//);
  });
});
