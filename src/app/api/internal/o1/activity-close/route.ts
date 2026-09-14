import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { previousCompletedClinicDay } from "@/features/engagement/close-schedule";
import { runActivityReconciliationDay } from "@/features/engagement/reconciliation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_ATTEMPTS = 3;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false }, { status: 401, headers: PRIVATE_NO_STORE });
  }

  const timeZone = process.env.O1_PILOT_CLOSE_TIME_ZONE;
  if (!timeZone) {
    return NextResponse.json(
      { ok: false, reason: "O1_PILOT_CLOSE_TIME_ZONE_REQUIRED" },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }

  let periodDay: string;
  try {
    periodDay = previousCompletedClinicDay(new Date(), timeZone);
  } catch {
    return NextResponse.json(
      { ok: false, reason: "O1_PILOT_CLOSE_TIME_ZONE_INVALID" },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const summary = await runActivityReconciliationDay(periodDay);
      return NextResponse.json(
        {
          ok: true,
          periodDay: summary.periodDay,
          sourceVersion: summary.sourceVersion,
          doctorCount: summary.doctorCount,
          evidenceRows: summary.evidenceRows,
          attempt,
        },
        { status: 200, headers: PRIVATE_NO_STORE },
      );
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        return NextResponse.json(
          { ok: false, reason: "O1_ACTIVITY_CLOSE_FAILED", periodDay },
          { status: 503, headers: PRIVATE_NO_STORE },
        );
      }
    }
  }

  return NextResponse.json({ ok: false }, { status: 503, headers: PRIVATE_NO_STORE });
}
