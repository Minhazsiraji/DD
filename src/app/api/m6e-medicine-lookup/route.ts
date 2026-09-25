import { NextResponse, type NextRequest } from "next/server";
import { requireLocationContext } from "@/lib/auth/session";
import {
  listDoctorMedicines,
  searchMedicines,
} from "@/features/medicines/queries";
import {
  defaultDisplayName,
  normalizeMedicineText,
  toRxDraftSeed,
  type DoctorMedicine,
  type MedicineReference,
} from "@/features/medicines/medicine";
import { emptyMedicine, type MedicineDraft } from "@/features/prescriptions/schema";

export const dynamic = "force-dynamic";

type LookupScope = "all" | "favorites" | "mine" | "catalogue";
type LookupSource = "favorite" | "mine" | "catalogue";

type VoiceMedicineMatch = {
  key: string;
  label: string;
  source: LookupSource;
  draft: MedicineDraft;
  manufacturer: string | null;
};
function doctorDraft(row: DoctorMedicine): MedicineDraft {
  const seed = toRxDraftSeed(row);
  return {
    ...emptyMedicine(),
    displayName: seed.displayName,
    brandName: seed.brandName ?? "",
    genericName: seed.genericName ?? "",
    strengthText: seed.strengthText ?? "",
    doseText: seed.doseText ?? "",
    dosageForm: seed.dosageForm ?? "",
    route: seed.route ?? "",
    scheduleText: seed.scheduleText ?? "",
    durationText: seed.durationText ?? "",
    quantityText: seed.quantityText ?? "",
    foodRelation: seed.foodRelation ?? "",
    instructions: seed.instructions ?? "",
    isPrn: seed.isPrn,
    substitutionAllowed: true,
  };
}

function referenceDraft(row: MedicineReference): MedicineDraft {
  return {
    ...emptyMedicine(),
    displayName: defaultDisplayName(row),
    brandName: row.brandName ?? "",
    genericName: row.genericName,
    strengthText: row.strengthText ?? "",
    dosageForm: row.dosageForm ?? "",
  };
}
function doctorMatches(row: DoctorMedicine, query: string) {
  if (!query) return true;
  const needle = normalizeMedicineText(query);
  return [row.displayName, row.genericName, row.brandName, row.strengthText]
    .some((value) => normalizeMedicineText(value).includes(needle));
}

function doctorMatch(row: DoctorMedicine): VoiceMedicineMatch {
  return {
    key: `mine:${row.id}`,
    label: row.displayName,
    source: row.isFavorite ? "favorite" : "mine",
    draft: doctorDraft(row),
    manufacturer: null,
  };
}

function catalogueMatch(row: MedicineReference): VoiceMedicineMatch {
  return {
    key: `catalogue:${row.id}`,
    label: defaultDisplayName(row),
    source: "catalogue",
    draft: referenceDraft(row),
    manufacturer: row.manufacturer,
  };
}

function dedupe(matches: VoiceMedicineMatch[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${normalizeMedicineText(match.draft.displayName)}|${normalizeMedicineText(match.draft.strengthText)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export async function GET(request: NextRequest) {
  try {
    await requireLocationContext();
  } catch {
    return NextResponse.json({ matches: [] }, { status: 401 });
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "6");
  const resultLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), 12))
    : 6;
  const requestedScope = request.nextUrl.searchParams.get("scope") ?? "all";
  const scope: LookupScope = ["all", "favorites", "mine", "catalogue"].includes(requestedScope)
    ? requestedScope as LookupScope
    : "all";

  if (!query && (scope === "all" || scope === "catalogue")) {
    return NextResponse.json({ matches: [] }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const includeLibrary = scope !== "catalogue";
  const includeCatalogue = scope === "all" || scope === "catalogue";
  const [library, catalogue] = await Promise.all([
    includeLibrary ? listDoctorMedicines() : Promise.resolve([]),
    includeCatalogue && query ? searchMedicines(query, { limit: resultLimit }) : Promise.resolve([]),
  ]);
  const filteredLibrary = library
    .filter((row) => doctorMatches(row, query))
    .filter((row) => scope !== "favorites" || row.isFavorite)
    .slice(0, resultLimit)
    .map(doctorMatch);

  const catalogueMatches = catalogue.slice(0, resultLimit).map(catalogueMatch);
  const matches = dedupe([...filteredLibrary, ...catalogueMatches]).slice(0, resultLimit);

  return NextResponse.json(
    { matches },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
