import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { costForAudio, getAiPricingBook } from "@/features/ai/pricing";
import {
  VOICE_MODEL_ID,
  VOICE_PROVIDER_ID,
  buildVoiceSessionReported,
  parseVoiceUsageBeacon,
} from "@/features/ai/telemetry";
import { emitAiTelemetry, getAiTelemetrySink } from "@/features/ai/telemetry-sink";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Voice usage report receiver (O1-E).
 *
 * Browser→Deepgram streaming is direct, so the browser is the only party that
 * can measure streamed audio. Its report is UNTRUSTED input and is treated as
 * exactly that: same authentication and same-origin rule as the grant route,
 * rate-limited, size-capped, and parsed against a strict allowlist — a single
 * unexpected key rejects the whole body. The stored duration is labelled
 * CLIENT_ESTIMATE, never presented as a provider figure.
 *
 * The report carries a session id, a grant id, a duration and two latencies.
 * No transcript, no audio, and no patient, encounter or prescription context
 * can be accepted here: there is no field for any of them.
 *
 * IDENTITY COMES FROM THE SESSION, NEVER THE BODY. The grant id in a report is
 * a correlation id, not authority: a report counts only against a grant the
 * server issued to the same authenticated user (see owner-projection).
 *
 * INTENTIONAL NON-EVENTS — a refused report writes nothing: unauthenticated,
 * cross-origin, rate-limited, oversized, malformed or disallowed-field bodies
 * all return a refusal and persist no record, so hostile traffic cannot be
 * turned into an unbounded stream of stored rows.
 */

const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 30;
const MAX_BODY_BYTES = 1024;

/** Pilot-only best-effort limiter, as on the grant route. */
const rate = new Map<string, { startedAt: number; count: number }>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const current = rate.get(userId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    rate.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REPORTS_PER_WINDOW;
}

const NO_STORE = { "Cache-Control": "private, no-store" };

function refuse(status: number, code: string) {
  return NextResponse.json({ code }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  let userId: string;
  try {
    const ctx = await requirePermission("update", "encounter");
    userId = ctx.user.id;
  } catch {
    return refuse(401, "unauthorized");
  }

  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return refuse(403, "forbidden");
  }
  if (rateLimited(userId)) return refuse(429, "rate-limited");

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return refuse(413, "too-large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return refuse(413, "too-large");

  let beacon;
  try {
    beacon = parseVoiceUsageBeacon(JSON.parse(text) as unknown);
  } catch {
    // One answer for malformed JSON and for a disallowed field: the caller
    // learns nothing about which part of its report was refused.
    return refuse(400, "invalid-report");
  }

  const occurredAt = new Date();
  const snapshot = getAiPricingBook().snapshotFor(VOICE_PROVIDER_ID, VOICE_MODEL_ID, occurredAt);
  await emitAiTelemetry(
    getAiTelemetrySink(),
    buildVoiceSessionReported({
      occurredAt,
      actorUserId: userId,
      beacon,
      cost: costForAudio(beacon.streamedAudioMs, snapshot),
    }),
  );

  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
