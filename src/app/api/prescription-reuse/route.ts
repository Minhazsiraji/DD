import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireLocationContext } from "@/lib/auth/session";
import {
  getPrescriptionReuseSourceDetail,
  getPrescriptionReuseSources,
} from "@/features/prescriptions/m3-queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireLocationContext();
    const parsed = z.object({
      target: z.uuid(),
      source: z.uuid().optional(),
    }).safeParse({
      target: request.nextUrl.searchParams.get("target") ?? "",
      source: request.nextUrl.searchParams.get("source") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: "That prescription history request was not understood." }, { status: 400 });
    }

    const result = parsed.data.source
      ? await getPrescriptionReuseSourceDetail(parsed.data.target, parsed.data.source, ctx.locationId)
      : await getPrescriptionReuseSources(parsed.data.target, ctx.locationId);

    return NextResponse.json(result, {
      status: result.ok ? 200 : 409,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Previous prescriptions are unavailable right now." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
