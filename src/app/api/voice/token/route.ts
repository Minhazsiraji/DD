import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import {
  buildVoiceGrant,
  mintVoiceGrantId,
  type VoiceGrantDenialReason,
} from "@/features/ai/telemetry";
import { emitAiTelemetry, getAiTelemetrySink } from "@/features/ai/telemetry-sink";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINDOW_MS = 60_000;
const MAX_GRANTS_PER_WINDOW = 12;
const TOKEN_TTL_SECONDS = 30;

type VoiceQaDiagnostic =
  | "TOKEN_ROUTE_UNAUTHORIZED"
  | "TOKEN_ROUTE_FORBIDDEN"
  | "TOKEN_RATE_LIMIT"
  | "TOKEN_CONFIG_MISSING"
  | "TOKEN_GRANT_REJECTED"
  | "TOKEN_GRANT_NETWORK";

/** Pilot-only best-effort limiter. Replace with distributed quota before scale. */
const rate = new Map<string, { startedAt: number; count: number; denialRecorded: boolean }>();

/**
 * `DENIED_FIRST` marks the first refusal in a window. Only that one is
 * recorded as telemetry, so a client hammering a refused endpoint cannot turn
 * each request into a telemetry write.
 */
function rateDecision(userId: string): "ALLOWED" | "DENIED_FIRST" | "DENIED" {
  const now = Date.now();
  const current = rate.get(userId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    rate.set(userId, { startedAt: now, count: 1, denialRecorded: false });
    return "ALLOWED";
  }
  current.count += 1;
  if (current.count <= MAX_GRANTS_PER_WINDOW) return "ALLOWED";
  if (current.denialRecorded) return "DENIED";
  current.denialRecorded = true;
  return "DENIED_FIRST";
}

function qaDiagnosticsEnabled(): boolean {
  return process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development";
}

function noStore(
  body: Record<string, unknown>,
  status = 200,
  diagnostic?: VoiceQaDiagnostic,
  qaDetails?: Record<string, unknown>,
) {
  const qa = qaDiagnosticsEnabled();
  return NextResponse.json(
    qa && diagnostic ? { ...body, diagnostic, ...qaDetails } : body,
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

/**
 * Authenticated Doctor-authorized temporary grant boundary.
 *
 * The permanent Deepgram key remains server-side. This endpoint returns only a
 * short-lived bearer token; patient/encounter/prescription identifiers, audio,
 * and transcript are intentionally absent from this transport boundary.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    const ctx = await requirePermission("update", "encounter");
    userId = ctx.user.id;
  } catch {
    return noStore({ code: "unauthorized" }, 401, "TOKEN_ROUTE_UNAUTHORIZED");
  }

  // Browser POSTs must be same-origin. Missing Origin fails closed for this
  // pilot because there is no supported non-browser grant client.
  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin) {
    return noStore({ code: "forbidden" }, 403, "TOKEN_ROUTE_FORBIDDEN");
  }

  // Usage telemetry: a random grant id and the auth user — no patient,
  // encounter or prescription context, and no audio or transcript. The grant
  // id travels with the token so the browser's streaming report can be matched
  // to the grant it streamed under.
  const grantId = mintVoiceGrantId();
  const recordGrant = (denialReason: VoiceGrantDenialReason | null) =>
    emitAiTelemetry(
      getAiTelemetrySink(),
      buildVoiceGrant({ occurredAt: new Date(), actorUserId: userId, grantId, denialReason }),
    );

  const decision = rateDecision(userId);
  if (decision !== "ALLOWED") {
    if (decision === "DENIED_FIRST") await recordGrant("RATE_LIMITED");
    return noStore({ code: "rate-limited" }, 429, "TOKEN_RATE_LIMIT");
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    await recordGrant("CONFIG_MISSING");
    return noStore({ code: "provider-unavailable" }, 503, "TOKEN_CONFIG_MISSING");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const unavailable = response.status === 401 || response.status === 403;
      await recordGrant("GRANT_REJECTED");
      return noStore(
        { code: unavailable ? "provider-unavailable" : "provider-error" },
        unavailable ? 503 : 502,
        "TOKEN_GRANT_REJECTED",
        { providerStatus: response.status },
      );
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      await recordGrant("GRANT_REJECTED");
      return noStore(
        { code: "provider-error" },
        502,
        "TOKEN_GRANT_REJECTED",
        { providerStatus: response.status },
      );
    }

    await recordGrant(null);
    return noStore({
      accessToken: payload.access_token,
      expiresIn: payload.expires_in ?? TOKEN_TTL_SECONDS,
      grantId,
      ...(qaDiagnosticsEnabled() ? { qaDiagnostics: true } : {}),
    });
  } catch {
    await recordGrant("GRANT_NETWORK");
    return noStore({ code: "provider-error" }, 502, "TOKEN_GRANT_NETWORK");
  } finally {
    clearTimeout(timeout);
  }
}
