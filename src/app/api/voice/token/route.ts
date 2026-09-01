import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINDOW_MS = 60_000;
const MAX_GRANTS_PER_WINDOW = 12;
const TOKEN_TTL_SECONDS = 30;

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

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
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
    return noStore({ code: "unauthorized" }, 401);
  }

  // Browser POSTs to this grant endpoint must be same-origin. A missing Origin
  // fails closed because there is no non-browser client in this pilot flow.
  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin) {
    return noStore({ code: "forbidden" }, 403);
  }

  if (rateLimited(userId)) return noStore({ code: "rate-limited" }, 429);

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return noStore({ code: "provider-unavailable" }, 503);

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
      return noStore(
        { code: response.status === 401 || response.status === 403 ? "provider-unavailable" : "provider-error" },
        response.status === 401 || response.status === 403 ? 503 : 502,
      );
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) return noStore({ code: "provider-error" }, 502);

    return noStore({ accessToken: payload.access_token, expiresIn: payload.expires_in ?? TOKEN_TTL_SECONDS });
  } catch {
    return noStore({ code: "provider-error" }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
