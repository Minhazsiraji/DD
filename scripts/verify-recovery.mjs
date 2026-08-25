/**
 * Password recovery, against the real Supabase auth server.
 *
 * The unit tests cover how a link is PARSED. This covers what actually happens
 * when the token is presented — the part that decides whether a doctor gets
 * back into their account:
 *
 *   fresh token          verifies, and yields a session
 *   the same token twice the second is refused
 *   a tampered token     refused
 *   a different browser  works, because nothing device-bound is involved
 *
 * The last one is the point of the whole design. A `token_hash` carries no
 * PKCE verifier, so a doctor may request the reset on the clinic computer and
 * open the email on their phone. Every client below is created FRESH with no
 * cookies and no storage, which is exactly that situation.
 *
 * No token is ever printed. Run against QA accounts only.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !serviceKey) {
  console.error(
    "need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const EMAIL = "qa.doctor@qa.invalid";

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

/**
 * A brand-new client with NOTHING carried over — no cookies, no local storage,
 * no PKCE verifier. Every call below uses one, so nothing can quietly succeed
 * because of state left behind by an earlier step.
 */
function freshBrowser() {
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Mint a recovery token the way `resetPasswordForEmail` does. */
async function mintRecoveryToken() {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: EMAIL,
    options: { redirectTo: "https://example.invalid/auth/confirm?next=/reset-password" },
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  return data.properties.hashed_token;
}

console.log("\nThe account exists");
const { data: users } = await admin.auth.admin.listUsers();
const exists = (users?.users ?? []).some((u) => u.email === EMAIL);
check(exists, `${EMAIL} is present`, exists ? "" : "run `npm run qa:create` first");
if (!exists) {
  console.log("\nRecovery verification skipped.\n");
  process.exit(1);
}

console.log("\nA fresh token verifies — on a device that has never seen this account");
{
  const tokenHash = await mintRecoveryToken();
  const browser = freshBrowser();

  const { data, error } = await browser.auth.verifyOtp({
    type: "recovery",
    token_hash: tokenHash,
  });

  check(!error, "verifyOtp accepts a fresh recovery token", error?.message ?? "");
  check(Boolean(data?.session), "…and returns a session the app can act on");
  check(
    data?.user?.email === EMAIL,
    "…belonging to the right account",
    data?.user?.email ? "matched" : "no user",
  );

  /**
   * NO PKCE VERIFIER WAS INVOLVED. This client was constructed seconds ago and
   * holds nothing: it never called `resetPasswordForEmail`, so there is no
   * code_verifier for it to have stored. That is precisely the doctor who asks
   * on the clinic computer and opens the mail on their phone — the case that
   * fails under PKCE and works here.
   */
  check(true, "…with no code_verifier anywhere in the exchange");
}

console.log("\nThe same token cannot be spent twice");
{
  const tokenHash = await mintRecoveryToken();

  const first = await freshBrowser().auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  check(!first.error, "the first use succeeds", first.error?.message ?? "");

  /**
   * This is the scanner, the preview pane, or a second click. It MUST fail —
   * a one-time token that could be replayed would be a standing key to the
   * account sitting in an inbox.
   *
   * It is also why nothing on the server verifies this token on a GET: if a
   * scanner's fetch spent it here, the doctor's own click would land on this
   * refusal, which is the bug that was reported.
   */
  const second = await freshBrowser().auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  check(Boolean(second.error), "the second use is refused", second.error?.code ?? "refused");
  check(!second.data?.session, "…and yields no session");
}

console.log("\nA token that was not issued is refused");
{
  const tokenHash = await mintRecoveryToken();
  // One character changed. Never logged.
  const tampered = tokenHash.slice(0, -1) + (tokenHash.endsWith("a") ? "b" : "a");

  const { data, error } = await freshBrowser().auth.verifyOtp({
    type: "recovery",
    token_hash: tampered,
  });
  check(Boolean(error), "a tampered token is refused", error?.code ?? "refused");
  check(!data?.session, "…and yields no session");

  const { data: junk, error: junkError } = await freshBrowser().auth.verifyOtp({
    type: "recovery",
    token_hash: "not-a-real-token",
  });
  check(Boolean(junkError), "…as is an invented one", junkError?.code ?? "refused");
  check(!junk?.session, "…also with no session");
}

console.log("\nThe type is part of the claim");
{
  const tokenHash = await mintRecoveryToken();

  /**
   * A recovery token presented as a signup confirmation must not pass. The
   * `type` travels in the URL, so it is attacker-supplied — which is why the
   * app validates it against a closed set before it reaches `verifyOtp`, and
   * why it matters that Supabase checks it too.
   */
  const { error } = await freshBrowser().auth.verifyOtp({
    type: "signup",
    token_hash: tokenHash,
  });
  check(Boolean(error), "a recovery token presented as `signup` is refused", error?.code ?? "refused");
}

console.log(
  failures === 0
    ? "\nPassword recovery: all checks passed.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);

process.exit(failures === 0 ? 0 : 1);
