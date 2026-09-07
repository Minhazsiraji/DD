import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrescriptionPrintHistoryAction } from "@/features/prescriptions/m3-actions";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Operational print history is a read, so keep it off the client Server Action
 * mutation queue. Authority and the true prescription location are still
 * derived on the server inside getPrescriptionPrintHistoryAction/RPC.
 */
export async function GET(request: NextRequest) {
  const parsed = z
    .object({ prescriptionId: z.uuid() })
    .safeParse({ prescriptionId: request.nextUrl.searchParams.get("prescription") ?? "" });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "That print history request was not understood." },
      { status: 400, headers: PRIVATE_NO_STORE },
    );
  }

  try {
    const result = await getPrescriptionPrintHistoryAction({
      prescriptionId: parsed.data.prescriptionId,
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 403,
      headers: PRIVATE_NO_STORE,
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Print history is unavailable right now." },
      { status: 401, headers: PRIVATE_NO_STORE },
    );
  }
}
