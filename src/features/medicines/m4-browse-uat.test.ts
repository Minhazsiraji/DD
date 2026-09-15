import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

const QUERIES = "src/features/medicines/queries.ts";
const PAGE = "src/app/(app)/medicines/page.tsx";
const LIST = "src/features/medicines/components/reference-list.tsx";

describe("M4 final browse UAT closure", () => {
  it("loads only 20 active catalogue rows for a blank search", () => {
    const queries = source(QUERIES);
    const page = source(PAGE);
    expect(queries).toContain("export async function browseMedicines(limit = 20)");
    expect(queries).toContain('.eq("is_active", true)');
    expect(queries).toContain('.order("generic_name", { ascending: true })');
    expect(queries).toContain(".limit(boundedLimit)");
    expect(page).toContain("browseMedicines(20)");
  });

  it("shows a live active-catalogue count without hardcoding the UAT total", () => {
    const queries = source(QUERIES);
    const page = source(PAGE);
    expect(queries).toContain("countActiveMedicineReferences");
    expect(queries).toContain('count: "exact"');
    expect(queries).toContain("head: true");
    expect(page).toContain("catalogueCount.toLocaleString");
    expect(page).not.toContain("3,225");
    expect(page).not.toContain("3225");
  });

  it("keeps nonblank searches on the existing literal search authority", () => {
    const page = source(PAGE);
    const queries = source(QUERIES);
    expect(page).toContain("searchMedicines(query)");
    expect(queries).toContain('supabase.rpc("search_medicines"');
    expect(queries).toContain("if (!isSearchable(query)) return []");
  });

  it("restores browse cards when the search is cleared instead of an empty prompt", () => {
    const list = source(LIST);
    expect(list).toContain("Browse the medicine catalogue or search by generic, brand or strength.");
    expect(list).not.toContain("Search the medicine catalogue");
    expect(list).toContain("data-medicine-reference-list");
  });

  it("retains saved-state and provenance on browse/search cards", () => {
    const list = source(LIST);
    expect(list).toContain("findSaved(library, m)");
    expect(list).toContain("In My Medicines");
    expect(list).toContain("data-medicine-provenance");
    expect(list).toContain("data-medicine-regulator");
  });

  it("does not add catalogue-certification language", () => {
    const combined = [source(PAGE), source(LIST), source(QUERIES)].join("\n").toLowerCase();
    expect(combined).not.toContain("verified by dgda");
    expect(combined).not.toContain("dgda-verified");
    expect(combined).not.toContain("officially approved by doctor's diary");
    expect(combined).not.toContain("clinically recommended");
  });
});
