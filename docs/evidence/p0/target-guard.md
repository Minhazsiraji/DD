# Track-A Target Guard

`scripts/p0-target.mjs` is the only gate between the P0 lane and a database.
Every P0 script that opens a connection passes its target through it before a
`postgres()` client is constructed, and `scripts/p0-run.mjs` validates once more
before importing the script at all. Either layer is sufficient on its own; both
exist so that neither has to be.

## What it accepts

Only `postgres://` or `postgresql://`, and only the three literal loopback
spellings — `localhost`, `127.0.0.1`, `::1`. Track A is Codespace-local, and
there is no remote isolated-project exception.

`127.0.0.2`–`127.255.255.254` are also loopback and are deliberately **not**
accepted: the Codespace stack binds `127.0.0.1`, so widening the range buys
nothing and each additional accepted form is another thing to be wrong about.

## Two independent refusals

1. **The protected shared project, by name.** `gzpqrxrevnkgdyktgrud` is refused
   outright, with an error that says so. Both Supabase addressing forms are
   searched — the direct host `db.<ref>.supabase.co` and the pooler form, where
   the ref lives in the **username** (`postgres.<ref>@aws-0-….pooler.supabase.com`).
   The pooler form is what `.env.local` actually uses for Track B, so it is the
   one most likely to be pasted by mistake, and a host-only check would miss it.
2. **Anything that is not literally loopback.**

(2) already blocks (1) today. (1) exists because a control that depends on one
rule being right is one edit away from being no control.

## No DNS resolution, ever

A hostname that merely resolves to `127.0.0.1` — `localtest.me`,
`127.0.0.1.nip.io`, any attacker-controlled A record — is refused. Resolution
can change between the check and the connection, and the name says nothing
about who controls it. The guard performs no lookup; that property is asserted
by test.

## No generic variable is ever an input

`requireLocalP0DatabaseUrl` reads `DD_V2_LOCAL_DATABASE_URL` and nothing else.
`DATABASE_URL`, `DIRECT_URL` and `SUPABASE_DB_URL` are the application's
Track-B variables; a P0 command that fell back to one would connect to the
shared project while appearing to have done nothing wrong. A test sets all
three to a Track-B pooler URL, unsets the dedicated variable, and asserts the
guard still refuses.

`p0-run.mjs` also does not *export* those names after validating. The retired
Loop-H version did, reasoning that the value was local by then. That is true of
the value but not of the contract: once those names carry a working connection,
any script imported into the process silently acquires a database and the
reason it connected stops being visible at the call site. If a legacy V1
wrapper ever genuinely needs them, that becomes a deliberate change to
`p0-run.mjs` rather than a default.

## The runner is allowlisted

`p0-run.mjs` will execute only `deploy-fresh.mjs`, `verify-p0.mjs` and
`verify-deployment-determinism.mjs`. The retired Loop-H change routed all
thirty-six database commands through it, including P1/P2/P4 verifiers for
commercial, claims, owner authority and payments — which would have made
later-phase features part of the P0 execution contract and simultaneously
broken the V1 lane those commands exist to serve. The V1 lane is restored to
its `693c9d0` form and is untouched by P0.

## Test coverage

`src/features/p0-target.test.ts` — 51 cases, no network, no database, no
hostname resolution. Accepted loopback forms including expanded IPv6 and
percent-encoded credentials; the protected ref in both addressing forms, with
the error message asserted so the two refusals cannot silently collapse into
one; remote, private-LAN, wildcard and IPv4-mapped hosts; DNS names that
resolve to loopback; prefix/suffix/substring name attacks; userinfo, fragment
and query smuggling; obfuscated decimal, hex, octal and percent-encoded
loopback spellings; non-PostgreSQL protocols; malformed and missing input.

Two findings came out of writing those tests rather than reading the code:
`URL.hostname` **keeps** the brackets on an IPv6 literal (so `[::1]` must be
stripped, or every IPv6 target is rejected), and `postgres:` is a non-special
scheme so WHATWG does **not** lower-case the host (`LOCALHOST` arrives
unchanged). Both are now handled explicitly and pinned by test.

## Runtime harness substrate

The determinism proof runs against **two fresh local Supabase substrates**, not
two raw PostgreSQL databases. The earlier harness used `CREATE DATABASE`, and
the P0 manifest — which references `auth` and `storage` — failed on it with
`schema "auth" does not exist`. That was a defect in the harness, not the
manifest: a raw database is not a Doctor's Diary deployment target.

Each round issues `supabase db reset --local --no-seed` and then asserts, before
deploying anything:

- `auth` and `storage` schemas exist;
- no P0 table is already present in `public`;
- and it reports any non-P0 table found in `public`, because that is precisely
  what makes the forced-RLS check fail later.

`--linked` and `--db-url` are never emitted. `--linked` would reset the linked
**remote** project, which is the one command in this repository that could
destroy Track B; a test asserts neither string appears in the harness. The run
also refuses to start if `supabase/.temp/project-ref` exists, and refuses unless
`supabase/config.toml` sets `[db.migrations] enabled = false` — without that,
`supabase db reset` replays the V1 migration lane into the substrate and the
replay is no longer manifest-only.

Deployment goes through `scripts/deploy-fresh.mjs` as a child process rather
than a second copy of the manifest loop, so the proof measures the path that
actually ships.

## Forced-RLS check

The invariant is unchanged — every table in `public` must have both
`relrowsecurity` and `relforcerowsecurity`. The **query** was wrong: it joined
`pg_tables` to `pg_class` on `relname` alone, with `schemaname='public'`
filtering only the `pg_tables` side. It therefore compared a public table
against every same-named relation in every schema — `auth`, `storage`,
`realtime`, `extensions` — and against indexes, sequences and views. A platform
relation's `relforcerowsecurity` is `false`, so the check could fail for a
reason unrelated to P0. On a raw PostgreSQL database nothing collides, which is
why it passed where the golden dump was produced and failed on a real Supabase
substrate.

It now joins on the relation's own oid with the namespace pinned and
`relkind in ('r','p')`, and on failure prints every offending table with both
flag values before throwing.
