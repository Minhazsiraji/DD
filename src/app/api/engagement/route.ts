import { NextResponse, type NextRequest } from "next/server";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ingestDurableEngagement } from "@/features/engagement/durable-ingest";
import type { IngestResult } from "@/features/engagement/ingest";
import {
  persistRuntimeEngagementMinute,
  resolveRuntimeDoctorId,
} from "@/lib/o1/runtime-authority";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The largest body a genuine client can produce is `{"surface":"APPOINTMENTS"}`
 * — 25 bytes. Anything far beyond that is not a heartbeat.
 */
const MAX_BODY_BYTES = 256;

/**
 * Engaged-use heartbeat ingest.
 *
 * The browser supplies exactly one frozen surface enum. Identity comes from the
 * verified auth session, timezone from the verified active practice location,
 * minute from the server clock, and clinic day from frozen F-I2 PostgreSQL.
 * No request header, path, client clock, Doctor id, day or timezone is accepted.
 */
export async function POST(request: NextRequest) {
  let context;
  try {
    context = await requireLocationContext();
  } catch {
    return respond({ status: "UNAUTHENTICATED" });
  }

  const supabase = await createSupabaseServerClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return respond({ status: "UNAUTHENTICATED" });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return respond({ status: "INVALID_BODY" });
    body = JSON.parse(text);
  } catch {
    return respond({ status: "INVALID_BODY" });
  }

  try {
    const result = await ingestDurableEngagement(
      body,
      {
        actorUserId: context.user.id,
        clinicTimeZone: context.timeZone,
      },
      {
        now: () => new Date(),
        resolveDoctorId: resolveRuntimeDoctorId,
        recordMinute: persistRuntimeEngagementMinute,
      },
    );
    return respond(result);
  } catch {
    return respond({ status: "FAILED" });
  }
}

function respond(result: IngestResult | { status: "UNAUTHENTICATED" }) {
  switch (result.status) {
    case "RECORDED":
      return new NextResponse(null, { status: 204, headers: PRIVATE_NO_STORE });
    case "INVALID_BODY":
      return NextResponse.json({ ok: false, reason: result.status }, { status: 400, headers: PRIVATE_NO_STORE });
    case "UNAUTHENTICATED":
      return NextResponse.json({ ok: false, reason: result.status }, { status: 401, headers: PRIVATE_NO_STORE });
    case "NOT_A_DOCTOR":
      return NextResponse.json({ ok: false, reason: result.status }, { status: 403, headers: PRIVATE_NO_STORE });
    case "REJECTED_BUCKET":
      return NextResponse.json({ ok: false, reason: result.status }, { status: 422, headers: PRIVATE_NO_STORE });
    case "UNWIRED":
    case "FAILED":
      return NextResponse.json({ ok: false, reason: result.status }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
