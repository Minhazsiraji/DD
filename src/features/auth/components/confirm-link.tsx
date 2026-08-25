"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { readLinkResult, safeNextPath, type LinkResult } from "../link-result";

/**
 * Turn an emailed auth link into a session, whatever shape it arrived in.
 *
 * EVERY PATH STILL GOES THROUGH SUPABASE. `exchangeCodeForSession`,
 * `verifyOtp` and `setSession` each validate the token against the auth server;
 * none of them is a local decode and none is skippable. What changed is only
 * WHERE the app can see the token — a fragment is invisible to a server, and
 * the old route handler was therefore reading an empty request and calling the
 * link expired.
 *
 * The browser client writes the session to the same cookies the server reads,
 * so the server remains the authority on every request afterwards.
 */
export function ConfirmLink() {
  const router = useRouter();
  const [failed, setFailed] = React.useState<string | null>(null);
  const ran = React.useRef(false);

  React.useEffect(() => {
    // A one-time token must be presented once. React's development
    // double-invoke would otherwise spend the code and report the second
    // attempt — the exact "expired" lie this fix exists to remove.
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      /**
       * Read the destination FIRST.
       *
       * The fragment is stripped from the address bar below, and
       * `history.replaceState(…, pathname)` drops the query with it — so
       * reading `next` afterwards found nothing and sent every recovery to the
       * dashboard instead of the password form. Found by walking a real link
       * through, not by reading the code.
       */
      const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      const result = readLinkResult(window.location.search, window.location.hash);

      /**
       * SCRUB THE ADDRESS BAR BEFORE DOING ANYTHING WITH THE TOKEN.
       *
       * `token_hash` sits in the QUERY, so unlike a fragment it has already
       * reached the server and any proxy in between — that much cannot be
       * undone here. What can be prevented is the rest of its life: sitting in
       * browser history, in the tab title, in a screenshot the doctor sends
       * when something goes wrong, and in the `Referer` of every request the
       * page makes afterwards.
       *
       * Done up front rather than on success, so a token that FAILED
       * verification is not left on screen either.
       */
      window.history.replaceState(null, "", window.location.pathname);

      /**
       * Supabase said no. Its own message is not shown: "otp_expired" is the
       * same answer for a link that was used, one that timed out, and one a
       * mail scanner opened first, and guessing between them for the user is
       * how they end up mistrusting a working system.
       */
      if (result.kind === "error") {
        router.replace(`/login?error=${result.code}`);
        return;
      }

      if (result.kind === "none") {
        router.replace("/login?error=link_missing");
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const outcome = await verify(supabase, result);

      if (!outcome) {
        setFailed("This link could not be opened. Request a new one.");
        router.replace("/login?error=link_expired");
        return;
      }

      router.replace(next);
      router.refresh();
    })();
  }, [router]);

  return (
    <div className="mx-auto max-w-sm py-16 text-center" role="status" aria-live="polite">
      {failed ? (
        <p className="text-[13px] text-ink-secondary">{failed}</p>
      ) : (
        <>
          <Loader2 className="mx-auto size-6 animate-spin text-brand" aria-hidden="true" />
          <p className="mt-3 text-[13px] text-ink-secondary">Opening your link…</p>
        </>
      )}
    </div>
  );
}

type Client = ReturnType<typeof createSupabaseBrowserClient>;

/** The shapes that actually carry a credential. */
type VerifiableLink = Extract<LinkResult, { kind: "code" | "token_hash" | "implicit" }>;

/** Each branch asks Supabase to verify. None of them trusts the URL. */
async function verify(supabase: Client, result: VerifiableLink): Promise<boolean> {
  if (result.kind === "code") {
    const { error } = await supabase.auth.exchangeCodeForSession(result.code);
    return !error;
  }

  if (result.kind === "token_hash") {
    const { error } = await supabase.auth.verifyOtp({
      type: result.type,
      token_hash: result.tokenHash,
    });
    return !error;
  }

  /**
   * Implicit flow. `setSession` posts the refresh token back to Supabase and
   * takes the session Supabase returns — it does not simply believe the access
   * token in the URL, so a forged fragment gets a rejection, not a session.
   */
  const { error } = await supabase.auth.setSession({
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
  });
  return !error;
}
