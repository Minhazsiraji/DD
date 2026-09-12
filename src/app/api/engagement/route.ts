import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACTIVE_LOCATION_COOKIE, getMemberships, requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ingestEngagement, type IngestResult } from "@/features/engagement/ingest";
import { getEngagementPorts } from "@/features/engagement/ports";

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
 * WHAT THIS HANDLER READS: the verified session, the active-location cookie it
 * shares with the clinical shell, and a request body of at most one enum value.
 *
 * WHAT IT NEVER READS, and a test asserts it: the client IP, `x-forwarded-for`,
 * the user agent, the referer, the request URL's path or query, or any other
 * header. There is no device or network fingerprint to leak because none is
 * ever collected.
 *
 * Nothing here logs a request, a body, an id or an error object.
 */
export async function POST(request: NextRequest) {
  try {
    await requireUser();
  } catch {
    return respond({ status: "UNAUTHENTICATED" });
  }

  /**
   * AAL2, matching the clinical shell. A session that has not completed MFA
   * cannot reach the workspace, so it cannot be practising — and an engaged
   * minute recorded from one would be counting a login screen as adoption.
   */
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

  const { minuteStore, activitySink } = getEngagementPorts();

  try {
    const result = await ingestEngagement(body, {
      now: () => new Date(),
      minuteStore,
      activitySink,
      /**
       * The runtime's `current_doctor_id()` (supabase/policies/0002) resolves
       * `doctor_profiles.id` from the verified session — which is exactly the
       * foreign key O1-F's `activity_contributions.doctor_id` references. The
       * browser never supplies it.
       *
       * It resolves a doctor profile; it is NOT a credential or capability
       * check, and nothing here treats it as one.
       */
      async resolveDoctorId() {
        const { data, error } = await supabase.rpc("current_doctor_id");
        if (error || typeof data !== "string") return null;
        return data;
      },
      /** Only the timezone is taken — the clinic day needs it; O1-F's raw tier has no location column. */
      async resolveTimeZone() {
        const [memberships, cookieStore] = await Promise.all([getMemberships(), cookies()]);
        if (memberships.length === 0) return null;
        const requested = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value;
        const active = memberships.find((m) => m.locationId === requested) ?? memberships[0]!;
        return active.timeZone ?? null;
      },
    });
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
      // Distinguishable on purpose: "not connected yet" and "broke" call for
      // different responses from whoever is watching, and neither is secret.
      return NextResponse.json({ ok: false, reason: result.status }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
