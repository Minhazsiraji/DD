import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";

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
const rate = new Map<string, { startedAt: number; count: number }>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const current = rate.get(userId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    rate.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_GRANTS_PER_WINDOW;
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
 * Authenticated doctor-only grant boundary.
 *
 * The permanent Deepgram key remains server-side. This endpoint returns only a
 * short-lived bearer token; no patient, encounter, prescription, field, audio,
 * or transcript is sent through Doctor's Diary for the streaming path.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    const ctx = await requirePermission("update", "encounter");
    userId = ctx.user.id;
  } catch {
    return noStore({ code: "unauthorized" }, 401, "TOKEN_ROUTE_UNAUTHORIZED");
  }

  // Browser POSTs to this grant endpoint must be same-origin. A missing Origin
  // fails closed because there is no non-browser client in this pilot flow.
  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin) {
    return noStore({ code: "forbidden" }, 403, "TOKEN_ROUTE_FORBIDDEN");
  }

  if (rateLimited(userId)) {
    return noStore({ code: "rate-limited" }, 429, "TOKEN_RATE_LIMIT");
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
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
      return noStore(
        { code: unavailable ? "provider-unavailable" : "provider-error" },
        unavailable ? 503 : 502,
        "TOKEN_GRANT_REJECTED",
        { providerStatus: response.status },
      );
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      return noStore(
        { code: "provider-error" },
        502,
        "TOKEN_GRANT_REJECTED",
        { providerStatus: response.status },
      );
    }

    return noStore({
      accessToken: payload.access_token,
      expiresIn: payload.expires_in ?? TOKEN_TTL_SECONDS,
      ...(qaDiagnosticsEnabled() ? { qaDiagnostics: true } : {}),
    });
  } catch {
    return noStore({ code: "provider-error" }, 502, "TOKEN_GRANT_NETWORK");
  } finally {
    clearTimeout(timeout);
  }
}
