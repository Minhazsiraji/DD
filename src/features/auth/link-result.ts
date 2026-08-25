import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * What an emailed auth link actually carries — parsed, not guessed.
 *
 * Pure and separate from the component so the shapes can be tested without a
 * browser. Supabase produces four of them and the difference matters:
 *
 *   ?code=…                  PKCE; exchanged for a session
 *   ?token_hash=…&type=…     OTP; verified server-side or client-side
 *   #access_token=…          implicit; INVISIBLE TO A SERVER
 *   #error=…                 the link was already used, or timed out
 *
 * Traced against this project's own Supabase: a fresh recovery link comes back
 * as `#access_token=…&type=recovery`, and a second use of the same link comes
 * back as `#error=access_denied&error_code=otp_expired`. Both are fragments.
 * A server route sees neither, which is how a valid link produced "expired".
 */

export type LinkResult =
  | { kind: "code"; code: string }
  | { kind: "token_hash"; tokenHash: string; type: EmailOtpType }
  | { kind: "implicit"; accessToken: string; refreshToken: string }
  /** Supabase refused it. `code` is OUR short reason, not its wording. */
  | { kind: "error"; code: "link_expired" | "link_denied" }
  | { kind: "none" };

/** The OTP types an email link may legitimately carry. */
const OTP_TYPES = new Set<string>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

/**
 * Read the query and the fragment together.
 *
 * QUERY FIRST, because a server-verifiable shape is the stronger one and is
 * what this app asks Supabase for. The fragment is the fallback, and the only
 * thing that can carry an implicit-flow result at all.
 */
export function readLinkResult(search: string, hash: string): LinkResult {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);

  // An error may arrive in either half. It wins over everything: a link that
  // Supabase rejected must never be retried as though it were valid.
  const failure = errorFrom(query) ?? errorFrom(fragment);
  if (failure) return failure;

  const code = query.get("code");
  if (code) return { kind: "code", code };

  const tokenHash = query.get("token_hash");
  const type = query.get("type");
  if (tokenHash && type && OTP_TYPES.has(type)) {
    return { kind: "token_hash", tokenHash, type: type as EmailOtpType };
  }

  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (accessToken && refreshToken) {
    return { kind: "implicit", accessToken, refreshToken };
  }

  return { kind: "none" };
}

/**
 * Supabase's own error words are collapsed to two outcomes.
 *
 * `otp_expired` is returned for a link that timed out, one already used, and
 * one a mail scanner opened before the doctor did. They are indistinguishable
 * from here, so the honest answer is one sentence covering all three: ask for
 * a new link.
 */
function errorFrom(params: URLSearchParams): LinkResult | null {
  const error = params.get("error") ?? params.get("error_code");
  if (!error) return null;

  const code = params.get("error_code") ?? error;
  if (/expired|otp/i.test(code)) return { kind: "error", code: "link_expired" };
  return { kind: "error", code: "link_denied" };
}

/**
 * Where to go afterwards — same-origin relative paths only.
 *
 * An open redirect here would be worth a great deal to an attacker: the link
 * arrives in a genuine Supabase email from a genuine domain, and it lands the
 * reader on another site holding a fresh session.
 */
export function safeNextPath(next: string | null): string {
  if (!next) return "/dashboard";
  // `//evil.com` and `/\evil.com` are both protocol-relative in browsers.
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }
  return next;
}
