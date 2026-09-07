import { NextRequest, NextResponse } from "next/server";
import { requireLocationContext } from "@/lib/auth/session";
import { getSignedMedicineHistory } from "@/features/prescriptions/m3-queries";
import type { SignedHistoryMode } from "@/features/prescriptions/m3-history";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireLocationContext();
    const rawMode = request.nextUrl.searchParams.get("mode")?.toUpperCase();
    const mode: SignedHistoryMode = rawMode === "FREQUENT" ? "FREQUENT" : "RECENT";
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (query.length === 1) {
      return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const items = await getSignedMedicineHistory(mode, query || null, 8);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { items: [], error: "Signed medicine history is unavailable right now." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
