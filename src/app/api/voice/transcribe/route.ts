import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;
const DEEPGRAM_MODEL = "nova-3";
const ALLOWED_LANGUAGES = new Set(["bn", "en-US"]);

/**
 * Pilot-only best-effort per-instance limiter. It prevents trivial accidental
 * abuse but is not a production distributed quota. Before broad release this
 * should move to a shared rate-limit store / edge protection layer.
 */
const rate = new Map<string, { startedAt: number; count: number }>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const current = rate.get(userId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    rate.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * Authenticated doctor-only transcription boundary.
 *
 * The request intentionally carries NO patient id, encounter id, prescription
 * id, or field name. The server keeps no transcription session and persists
 * neither audio nor transcript, so there is no server-side patient context that
 * can be mixed across requests. Clinical context stays in the already-loaded
 * browser draft; only the doctor can later save/add through the existing paths.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    const ctx = await requirePermission("update", "encounter");
    userId = ctx.user.id;
  } catch {
    return noStore({ code: "unauthorized" }, 401);
  }

  if (rateLimited(userId)) return noStore({ code: "rate-limited" }, 429);

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return noStore({ code: "provider-unavailable" }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return noStore({ code: "invalid-request" }, 400);
  }

  const audio = form.get("audio");
  const language = String(form.get("language") ?? "");

  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
    return noStore({ code: "invalid-audio" }, 400);
  }
  if (!ALLOWED_LANGUAGES.has(language)) {
    return noStore({ code: "invalid-language" }, 400);
  }
  if (!audio.type.startsWith("audio/")) {
    return noStore({ code: "invalid-audio" }, 400);
  }

  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language,
    smart_format: "true",
    punctuate: "true",
    mip_opt_out: "true",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audio.type,
      },
      body: Buffer.from(await audio.arrayBuffer()),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      // Deliberately do not relay provider body/request ids; they can contain
      // operational detail and are unnecessary for the doctor's recovery path.
      return noStore(
        { code: response.status === 401 || response.status === 403 ? "provider-unavailable" : "provider-error" },
        response.status === 401 || response.status === 403 ? 503 : 502,
      );
    }

    const payload = (await response.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    const transcript = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    return noStore({ transcript });
  } catch {
    return noStore({ code: "provider-error" }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
