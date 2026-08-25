import { describe, it, expect } from "vitest";
import { readLinkResult, safeNextPath } from "./link-result";

/**
 * THE BUG, IN ONE SENTENCE: a URL fragment is never sent to a server.
 *
 * Traced against this project's own Supabase — a fresh recovery link returns
 *
 *   /auth/callback?next=/reset-password#access_token=…&type=recovery
 *
 * and the same link used twice returns
 *
 *   /auth/callback?next=/reset-password#error=access_denied&error_code=otp_expired
 *
 * Both put everything after the `#`. The old route handler read the query,
 * found no `code`, and reported the link expired — about a link that was
 * perfectly valid and had never been opened.
 */

describe("what a server can see", () => {
  it("sees nothing at all in an implicit-flow link", () => {
    // The server gets the query only. This is the whole failure.
    expect(readLinkResult("?next=/reset-password", "")).toEqual({ kind: "none" });
  });

  it("…and the browser sees the tokens in the same link", () => {
    const hash =
      "#access_token=eyJhbGci.abc.def&expires_in=3600&refresh_token=arbwr6iy7zon&token_type=bearer&type=recovery";
    expect(readLinkResult("?next=/reset-password", hash)).toEqual({
      kind: "implicit",
      accessToken: "eyJhbGci.abc.def",
      refreshToken: "arbwr6iy7zon",
    });
  });

  it("a partial fragment is not a credential", () => {
    // An access token without a refresh token cannot establish a session, and
    // guessing at one would be inventing half a credential.
    expect(readLinkResult("", "#access_token=abc&type=recovery")).toEqual({ kind: "none" });
    expect(readLinkResult("", "#refresh_token=abc")).toEqual({ kind: "none" });
  });
});

describe("the shapes a server CAN verify are still preferred", () => {
  it("PKCE", () => {
    expect(readLinkResult("?code=abc123&next=/reset-password", "")).toEqual({
      kind: "code",
      code: "abc123",
    });
  });

  it("token hash, with its type", () => {
    expect(readLinkResult("?token_hash=xyz&type=recovery", "")).toEqual({
      kind: "token_hash",
      tokenHash: "xyz",
      type: "recovery",
    });
  });

  it("refuses a type it does not recognise rather than passing it through", () => {
    /**
     * `verifyOtp` takes the type from the URL. Forwarding an arbitrary string
     * lets a link choose which verification Supabase performs, so the set is
     * closed here.
     */
    expect(readLinkResult("?token_hash=xyz&type=sms", "")).toEqual({ kind: "none" });
    expect(readLinkResult("?token_hash=xyz&type=../admin", "")).toEqual({ kind: "none" });
  });

  it("the query wins over the fragment when both are present", () => {
    const result = readLinkResult("?code=abc", "#access_token=a&refresh_token=b");
    expect(result.kind).toBe("code");
  });
});

describe("a refusal is a refusal, wherever it arrives", () => {
  it("reads the error out of the fragment — where Supabase actually puts it", () => {
    expect(
      readLinkResult(
        "?next=/reset-password",
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toEqual({ kind: "error", code: "link_expired" });
  });

  it("…and out of the query", () => {
    expect(readLinkResult("?error=access_denied&error_code=otp_expired", "")).toEqual({
      kind: "error",
      code: "link_expired",
    });
  });

  it("an error BEATS any token in the same link", () => {
    /**
     * Never retry something Supabase already rejected. If both appear, the
     * refusal is the answer.
     */
    const result = readLinkResult("?error=access_denied", "#access_token=a&refresh_token=b");
    expect(result.kind).toBe("error");
  });

  it("an unrecognised refusal is still a refusal, not a success", () => {
    expect(readLinkResult("?error=server_error", "")).toEqual({
      kind: "error",
      code: "link_denied",
    });
  });
});

describe("where the link may send you afterwards", () => {
  it("keeps an ordinary relative path", () => {
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
    expect(safeNextPath("/onboarding")).toBe("/onboarding");
  });

  it("refuses to leave the site", () => {
    /**
     * This is the valuable one to attack: the link arrives in a genuine
     * Supabase email from a genuine domain, and lands the reader elsewhere
     * holding a fresh session.
     */
    for (const hostile of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "http://evil.example",
      "javascript:alert(1)",
      "",
    ]) {
      expect(safeNextPath(hostile), hostile).toBe("/dashboard");
    }
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});
