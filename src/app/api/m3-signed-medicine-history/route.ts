import { NextRequest, NextResponse } from "next/server";
import { requireLocationContext } from "@/lib/auth/session";
import { getSignedMedicineHistory } from "@/features/prescriptions/m3-queries";
import type { SignedHistoryMode } from "@/features/prescriptions/m3-history";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    await requireLocationContext();
    const rawMode = request.nextUrl.searchParams.get("mode")?.toUpperCase();
    const mode: SignedHistoryMode = rawMode === "FREQUENT" ? "FREQUENT" : "RECENT";
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

    if (query.length === 1) {
      return NextResponse.json({ items: [] }, { headers: PRIVATE_NO_STORE });
    }

    const outcome = await getSignedMedicineHistory(mode, query || null, 8);
    if (!outcome.ok) {
      return NextResponse.json(
        { items: [], error: outcome.message },
        { status: 503, headers: PRIVATE_NO_STORE },
      );
    }

    return NextResponse.json({ items: outcome.items }, { headers: PRIVATE_NO_STORE });
  } catch {
    return NextResponse.json(
      { items: [], error: "Signed medicine history is unavailable right now." },
      { status: 401, headers: PRIVATE_NO_STORE },
    );
  }
}
