import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readLinkResult, safeNextPath } from "@/features/auth/link-result";

/**
 * The server-verifiable half of an emailed auth link.
 *
 * Kept for `?code=` and `?token_hash=`, which a server CAN see and which are
 * the stronger shapes: the session is written straight to httpOnly cookies
 * without the token ever reaching client JavaScript.
 *
 * What it must no longer do is claim a link is expired when it simply could not
 * see it. Supabase's implicit flow returns everything — tokens AND errors — in
 * a URL FRAGMENT, which browsers never transmit. This route received a bare
 * `?next=/reset-password`, found no code, and reported failure on a link that
 * was perfectly valid. Anything it cannot see is now handed to `/auth/confirm`,
 * which runs in the browser where the fragment exists.
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
   * Nothing this side can verify. NOT an error: it is very probably an implicit
   * link whose tokens are sitting in a fragment one hop away. Forward with the
   * query intact and let the browser present what only it can read.
   */
  if (result.kind === "none" || result.kind === "implicit") {
    return NextResponse.redirect(`${origin}/auth/confirm${search}`);
  }

  const supabase = await createSupabaseServerClient();

  const { error } =
    result.kind === "code"
      ? await supabase.auth.exchangeCodeForSession(result.code)
      : await supabase.auth.verifyOtp({
          type: result.type,
          token_hash: result.tokenHash,
        });

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
