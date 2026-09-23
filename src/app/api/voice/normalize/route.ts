import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL = "gpt-5.6-luna";
const TIMEOUT_MS = 8000;
const MAX_TRANSCRIPT_CHARS = 4000;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function isPreviewLike() {
  return process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development";
}

function outputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  for (const item of record.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!isPreviewLike()) return json({ code: "preview-only" }, 404);

  try {
    await requirePermission("update", "encounter");
  } catch {
    return json({ code: "unauthorized" }, 401);
  }

  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return json({ code: "forbidden" }, 403);
  }

  let transcript = "";
  let language = "en-US";
  try {
    const body = (await request.json()) as { transcript?: unknown; language?: unknown };
    if (typeof body.transcript === "string") transcript = body.transcript.normalize("NFC").trim();
    if (typeof body.language === "string") language = body.language.slice(0, 32);
  } catch {
    return json({ code: "invalid-request" }, 400);
  }

  if (!transcript || transcript.length > MAX_TRANSCRIPT_CHARS) {
    return json({ code: "invalid-transcript" }, 400);
  }

  // Only mixed Bangla+English needs AI script restoration. English and Bangla
  // remain provider-faithful and avoid an unnecessary model call.
  if (language !== "bn-BD-mixed") {
    return json({ transcript, provider: "identity" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ code: "openai-unavailable" }, 503);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        store: false,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You normalize a speech-to-text transcript for Doctor's Diary mixed Bangla+English mode. Preserve the exact clinical meaning and all explicit numbers, units, medicine names, investigation names, symptoms, durations and negations. Do not add, infer, summarize, diagnose, correct clinical facts, or omit content. Keep genuine Bangla words in Bangla script. Restore clearly spoken English/medical terms that the Bengali ASR rendered phonetically into Bangla script back to standard English spelling when confident (examples: চিফ কমপ্লেইন -> Chief complaint, সেকশন -> section, প্রেসক্রিপশন -> prescription, ফলো আপ -> follow-up, সিবিসি -> CBC). Represent clearly spoken numeric quantities, including decimals, as Arabic digits without changing their value (examples: twelve point five -> 12.5, বারো দশমিক পাঁচ -> 12.5). Never guess a number that was not clearly spoken. If uncertain, preserve the original wording. Return only the normalized transcript, no explanation.",
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: transcript }],
          },
        ],
      }),
    });

    if (!response.ok) return json({ code: "openai-provider-error", providerStatus: response.status }, 502);
    const payload = (await response.json()) as unknown;
    const normalized = outputText(payload)?.normalize("NFC").trim();
    if (!normalized) return json({ code: "openai-empty-result" }, 502);
    return json({ transcript: normalized, provider: "openai", model: MODEL });
  } catch {
    return json({ code: "openai-network-error" }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
