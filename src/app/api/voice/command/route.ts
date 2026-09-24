import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { parseM6BCommand, type M6BIntent, type M6BNavigationTarget } from "@/features/dictation/m6b-command-parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL = "gpt-5.6-luna";
const TIMEOUT_MS = 10_000;
const MAX_TRANSCRIPT_CHARS = 1200;

const NAV_TARGETS: M6BNavigationTarget[] = [
  "prescription",
  "investigations",
  "previous-history",
  "chief-complaint",
  "history",
  "examination",
  "assessment",
  "advice",
  "follow-up",
  "prescription-review",
];

const PROHIBITED = [
  "FINALIZE_PRESCRIPTION",
  "IRREVERSIBLE_DELETE",
  "OWNERSHIP_CHANGE",
  "FINALIZED_MUTATION",
  "BYPASS_CONFIRMATION",
] as const;

type OpenAICommand = {
  type:
    | "NAVIGATE"
    | "PROPOSE_MEDICINE"
    | "PROPOSE_INVESTIGATION"
    | "PROPOSE_FOLLOW_UP"
    | "PROHIBITED_ACTION"
    | "UNKNOWN";
  target: M6BNavigationTarget | null;
  medicineName: string;
  strengthText: string;
  investigations: string[];
  followUpDays: number | null;
  prohibitedAction: (typeof PROHIBITED)[number] | null;
  reviewOnly: boolean;
  uncertainties: string[];
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
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

function mapIntent(rawText: string, parsed: OpenAICommand): M6BIntent {
  if (parsed.type === "NAVIGATE" && parsed.target && NAV_TARGETS.includes(parsed.target)) {
    return { type: "NAVIGATE", target: parsed.target, rawText };
  }
  if (parsed.type === "PROPOSE_MEDICINE") {
    return {
      type: "PROPOSE_MEDICINE",
      rawText,
      medicine: { name: parsed.medicineName.trim(), strengthText: parsed.strengthText.trim() },
      uncertainties: parsed.uncertainties,
    };
  }
  if (parsed.type === "PROPOSE_INVESTIGATION") {
    return {
      type: "PROPOSE_INVESTIGATION",
      rawText,
      investigations: parsed.investigations.map((value) => value.trim()).filter(Boolean).slice(0, 12),
    };
  }
  if (parsed.type === "PROPOSE_FOLLOW_UP") {
    return {
      type: "PROPOSE_FOLLOW_UP",
      rawText,
      days: parsed.followUpDays,
      uncertainties: parsed.uncertainties,
    };
  }
  if (
    parsed.type === "PROHIBITED_ACTION" &&
    parsed.prohibitedAction &&
    PROHIBITED.includes(parsed.prohibitedAction)
  ) {
    return {
      type: "PROHIBITED_ACTION",
      rawText,
      action: parsed.prohibitedAction,
      reviewOnly: parsed.prohibitedAction === "FINALIZE_PRESCRIPTION",
    };
  }
  return { type: "UNKNOWN", rawText };
}

export async function POST(request: NextRequest) {
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

  // Standalone prescription aliases are deterministic navigation, so keep
  // them on the existing guarded prescription path without AI interpretation.
  const deterministic = parseM6BCommand(transcript);
  if (deterministic.type === "NAVIGATE" && deterministic.target === "prescription") {
    return json({ intent: deterministic, provider: "deterministic" });
  }

  // Production allows only this already-validated deterministic navigation.
  // All AI-dependent command interpretation remains Preview/development only.
  if (!isPreviewLike()) return json({ code: "preview-only" }, 404);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ code: "openai-unavailable" }, 503);

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "type",
      "target",
      "medicineName",
      "strengthText",
      "investigations",
      "followUpDays",
      "prohibitedAction",
      "reviewOnly",
      "uncertainties",
    ],
    properties: {
      type: {
        type: "string",
        enum: [
          "NAVIGATE",
          "PROPOSE_MEDICINE",
          "PROPOSE_INVESTIGATION",
          "PROPOSE_FOLLOW_UP",
          "PROHIBITED_ACTION",
          "UNKNOWN",
        ],
      },
      target: { anyOf: [{ type: "string", enum: NAV_TARGETS }, { type: "null" }] },
      medicineName: { type: "string" },
      strengthText: { type: "string" },
      investigations: { type: "array", maxItems: 12, items: { type: "string" } },
      followUpDays: { anyOf: [{ type: "integer", minimum: 1, maximum: 3650 }, { type: "null" }] },
      prohibitedAction: { anyOf: [{ type: "string", enum: PROHIBITED }, { type: "null" }] },
      reviewOnly: { type: "boolean" },
      uncertainties: { type: "array", maxItems: 8, items: { type: "string" } },
    },
  };

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
                  "You parse Doctor's Diary voice commands. You are not a clinician and must not invent clinical facts. Preserve medicine/test names and explicit numbers/units from the transcript. Never infer a missing strength, dose, frequency, duration, follow-up interval, diagnosis, or investigation. Use uncertainties for missing or ambiguous clinical details. Navigation is limited to the supplied targets. Requests to finalize a prescription, bypass confirmation, irreversibly delete, change ownership, or mutate finalized records are PROHIBITED_ACTION. Finalize may only open review; it can never finalize. Return UNKNOWN when the user's intent does not fit the allowlist. Banglish may contain Bangla script mixed with English. Do not transliterate or translate the transcript.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Language mode: ${language}\nTranscript: ${transcript}`,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "dd_voice_command",
            strict: true,
            schema,
          },
        },
      }),
    });

    if (!response.ok) {
      return json({ code: "openai-provider-error", providerStatus: response.status }, 502);
    }

    const payload = (await response.json()) as unknown;
    const text = outputText(payload);
    if (!text) return json({ code: "openai-empty-result" }, 502);

    let parsed: OpenAICommand;
    try {
      parsed = JSON.parse(text) as OpenAICommand;
    } catch {
      return json({ code: "openai-invalid-result" }, 502);
    }

    const intent = mapIntent(transcript, parsed);
    return json({ intent, provider: "openai", model: MODEL });
  } catch {
    return json({ code: "openai-network-error" }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
