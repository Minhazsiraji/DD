import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readLinkResult, safeNextPath } from "@/features/auth/link-result";

/**
 * LEGACY. Kept only for links already sitting in inboxes.
 *
 * New emails point at `/auth/confirm`. This route survives so that a reset
 * requested before the change still works, and it now does exactly two things:
 * finish a PKCE exchange, which only a server can, and forward everything else
 * to the page that can read it.
 *
 * It used to claim a link was expired when it simply could not see it —
 * Supabase's implicit flow returns tokens AND errors in a URL FRAGMENT, which
 * browsers never transmit, so this route received a bare `?next=…`, found no
 * code, and reported failure on a perfectly good link.
 */
export async function GET(request: NextRequest) {
  const { search, origin } = request.nextUrl;
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  // The fragment is not in `search` and never will be — the server half of the
  // same parser the browser half uses, so the two cannot drift apart.
  const result = readLinkResult(search, "");

  if (result.kind === "error") {
    return NextResponse.redirect(`${origin}/login?error=${result.code}`);
  }

  /**
   * ANYTHING THIS ROUTE WOULD SPEND ON A GET IS FORWARDED INSTEAD.
   *
   * A one-time token must not be consumed by a request the doctor did not
   * make. Mail scanners, link previewers and corporate security gateways all
   * fetch URLs out of inboxes before a human ever clicks, and a server that
   * verifies on GET hands them the token — after which the doctor's own click
   * is correctly told the link was already used. That is the reported bug.
   *
   * `token_hash` is therefore NOT verified here, even though it could be. It
   * goes to `/auth/confirm`, where the token is spent by JavaScript the
   * scanner never runs.
   */
  if (result.kind !== "code") {
    return NextResponse.redirect(`${origin}/auth/confirm${search}`);
  }

  /**
   * PKCE is the one legacy shape retained server-side because exchange requires
   * the requesting browser's verifier/cookie state. A scanner has no such state, so its attempt fails
   * without the doctor's browser losing anything it could have used.
   */
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(result.code);

  if (error) {
    /**
     * A PKCE exchange also fails when the verifier cookie is missing — the link
     * opened in a different browser from the one that asked for it, which is
     * ordinary behaviour for someone reading mail on their phone. Treated as a
     * link to request again rather than as a broken account.
     */
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
