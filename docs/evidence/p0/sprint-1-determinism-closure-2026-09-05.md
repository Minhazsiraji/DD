# Doctor's Diary Database V2 — Sprint 1 Determinism Closure

Date: 2026-09-05
Lane: Loop A verifier-only Central correction
Base checkpoint: `a2b3a37a52536db38ee3aebce89a1fa6a84465c3`
Review branch: `v2/p0-sprint1-determinism-closure`

## Scope

Central's only remaining Sprint-1 blocker was time-varying Supabase Realtime platform partition names in the committed determinism harness. No DD-owned product, booking, security, capability, scheduling, phone, RLS, manifest, or golden correction was required.

Changed verifier: `scripts/verify-deployment-determinism.mjs`.

The correction preserves PostgreSQL `\\restrict` / `\\unrestrict` guard-token normalization and additionally canonicalizes only Supabase Realtime rolling `messages_YYYY_MM_DD` partition identifiers plus the corresponding `ALTER TABLE ONLY realtime.messages ATTACH PARTITION` date bounds. DD-owned objects and unrelated substrate data remain byte-sensitive.

## Runtime proof

- `npm run db:verify:determinism`: PASS — Replay A == Replay B == Sprint golden.
- Canonical SHA-256: `51d47060eb2e44c77291ff3bfe112511c29464dfd18a16a14aa0120fa5947e7e`.
- `npm run db:verify:p0`: PASS — 42/42 public P0 tables under RLS + FORCE RLS.
- `npm run lint`: PASS.
- `git diff --check`: PASS.
- Product SQL/manifest/golden drift from base `a2b3a37`: ZERO.

## Security / custody boundary

- Track-B database contacts: `0`.
- Protected/shared reset or migration: `0`.
- `service_role` application shortcut: `0`.
- Merge: NO.
- Production deployment: NO.
- P1+, Voice, DGDA: NO.
- No force-push or history rewrite.
- `supabase/config.toml` is local-only/untracked and is not part of the closure commit.

This evidence records a verifier-only closure. The immutable closure commit SHA is recorded by the following docs-only Central handoff commit, because a commit cannot truthfully embed its own SHA.
