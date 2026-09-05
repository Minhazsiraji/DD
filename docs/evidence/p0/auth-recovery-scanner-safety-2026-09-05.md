# Doctor's Diary — P0 Auth Recovery Scanner-Safety Closure

Date: 2026-09-05
Classification: P0 correctness / security
Branch: `md/p0-auth-recovery-scanner-safety`
Worktree: `/workspaces/DD-md-auth-recovery`
Base: `5d58f154a8fd18129e28614ccc038f0a6af66b8f` (`origin/main`)

## Reference inspected

Reference-only branch: `origin/fix/password-recovery`.
Relevant commits inspected, not merged or cherry-picked:
- `550f2f0` — fragment-aware recovery handling
- `5edfcf5` — Preview redirect-origin selection
- `a1f2d16` — scanner-safe browser token consumption

## Defect and invariant

Current accepted main exchanged auth credentials from a GET callback. A mail scanner, previewer or gateway can fetch an email URL before the doctor. A scanner-sensitive OTP/token hash must therefore never be verified by a GET route. The actual browser must spend the one-time credential through Supabase Auth.

No Doctor's Diary database architecture change is part of this slice.
## Current-main reconciliation

Implemented against current `5d58f15`, not by importing the old branch history:
- New `/auth/confirm` browser page handles browser-visible credential shapes.
- `token_hash` is verified only from the client confirmation flow via `verifyOtp`.
- Fragment token pairs are handled only in the browser and followed by `getUser()` before navigation.
- React effect re-entry is guarded so one-time material is not submitted twice.
- Sensitive query/fragment material is removed with `history.replaceState` before verification or failure handling.
- `/auth/confirm` emits `referrer: no-referrer`.
- `next` uses one shared same-origin relative-path sanitizer.
- Signup and reset requests now target `/auth/confirm` using deployment-aware origin resolution.
- Vercel Preview takes precedence over inherited production `NEXT_PUBLIC_SITE_URL`.
- Signed-in recovery sessions may reach `/reset-password`; the rest of the proxy gate is unchanged.
- Legacy `/auth/callback` remains. OTP/token-hash and browser-fragment shapes are forwarded without verification on GET.
- Legacy PKCE `code` exchange remains server-side because it depends on the requesting browser's verifier/cookie state.

No password-field UI changes from the old reference branch were carried over.
## Scanner and redirect proofs

Focused auth/recovery suite: **4 files / 48 tests PASS**.
Existing security/export boundary suite: **4 files / 38 tests PASS**.
Full application suite: **61 files / 1,011 tests PASS**.

Proved locally/static without protected infrastructure:
- scanner-style GET with `token_hash` redirects to `/auth/confirm`, sets no session cookie, and never constructs the Supabase server client;
- callback source contains no `verifyOtp` path;
- token-hash verification exists only in the client confirmation component;
- browser fragments are parsed only in the browser path;
- unsupported/missing auth types are rejected;
- address-bar scrubbing occurs before verification and before error handling;
- one-time processing is guarded against React development double invocation;
- external, protocol-relative, backslash/encoded-backslash and control-character redirect attempts fall back to `/dashboard`;
- signup confirmation routes toward onboarding and recovery toward reset-password;
- password recovery retains the same user-facing response whether the account exists or not;
- Preview and local redirect-origin selection are covered by pure unit tests.

No token or credential value is logged by the changed recovery path.
## External Supabase email-template gate

Repository inspection found no checked-in Supabase Auth email-template configuration. End-to-end scanner safety therefore depends on external Auth template state that was **not contacted or modified** in this slice.

Required operator configuration for a later authorized QA/external gate:
- **Confirm sign up** email must link directly to the app using the token hash, e.g. `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`.
- **Reset password** email must link directly to the app using `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`.
- Do **not** use `{{ .ConfirmationURL }}` for these scanner-sensitive links; it points through Supabase's GET verification endpoint and can be consumed by email prefetching.
- Verify the Auth redirect allow list accepts the intended local/Preview URL used by `redirectTo`.
- If an external mail provider rewrites links for click tracking, disable that tracking for auth emails.

Because this external configuration is unverified, code closure and end-to-end external Auth configuration closure remain separate gates.

## Remaining runtime verification

**RUNTIME EXTERNAL VERIFICATION REQUIRED** under separate Central authorization:
1. inspect/adjust the QA Supabase Auth templates and redirect allow list;
2. issue a QA recovery email without production credentials;
3. fetch the email link once with a scanner-style plain GET that executes no JavaScript;
4. confirm the same link still succeeds in the doctor's browser and reaches `/reset-password`;
5. confirm a second token use and a tampered token are refused;
6. if legacy PKCE callback links still exist, prove a scanner request lacking the browser verifier state does not invalidate the later real-browser exchange.

No protected/shared environment was contacted to perform these checks.
## Quality gates and boundaries

- Targeted auth/recovery tests: PASS — 48/48.
- Relevant existing security/export tests: PASS — 38/38.
- Lint: PASS.
- Typecheck: PASS after the production build generated Next.js route types. The first pre-build attempt showed only the known generated `PageProps`/`LayoutProps` absence.
- Full tests: PASS — 61 files / 1,011 tests.
- Build: PASS — Next.js 16.3.0, 47/47 pages generated.
- `git diff --check`: PASS.
- Doctor's Diary DB contract drift: **zero**.
- Protected/shared DB contacts: **0**.
- Production actions: **NO**.
- P1 work: **NO**.
- CSU lifecycle changes: **NO**.

Environment notes: the first targeted test command failed before test execution because the isolated worktree had no local `node_modules`; existing Codespace dependencies were then reused. The first build attempt failed because Turbopack rejects a `node_modules` symlink outside the worktree root; the dependency tree was replaced with local hard links and the clean build then passed.

## Files changed

- `src/app/(auth)/login/page.tsx`
- `src/app/auth/callback/route.ts`
- `src/app/auth/confirm/page.tsx`
- `src/features/auth/actions.ts`
- `src/features/auth/callback-scanner-safety.test.ts`
- `src/features/auth/components/confirm-link.tsx`
- `src/features/auth/link-result.test.ts`
- `src/features/auth/link-result.ts`
- `src/features/auth/recovery-flow.test.ts`
- `src/features/auth/site-url.test.ts`
- `src/features/auth/site-url.ts`
- `src/proxy.ts`
- `docs/evidence/p0/auth-recovery-scanner-safety-2026-09-05.md`
