@AGENTS.md

# Doctor's Diary

AI-enabled clinical + chamber operating system for doctors. One responsive
Next.js app (desktop, tablet, mobile, installable PWA). No separate native app.

**Current phase: Stage 3 complete + doctor profile / prescription templates.**
Done: scaffold and design system (1), auth + RBAC + RLS + audit (2), MFA and
device security (2.5), ADRs (2.6), patients (3) with two hardening rounds, and
doctor identity + customisable prescription-template settings with an A4
preview. Next: Stage 4 — appointments. The prescription ENGINE is not built.

Detailed architecture: `docs/architecture.md` (do not load unless needed).

## Stack (approved — do not add to it without asking)

Next.js 16 (App Router, Turbopack) · TypeScript strict · Tailwind v4 (CSS-first,
no config file) · shadcn/ui (on `@base-ui/react`, not Radix) · lucide-react.
Phase 2+: Supabase (Postgres/Auth/Storage/Realtime) · Drizzle · Zod · React Hook
Form. TanStack Query and Recharts only where genuinely needed.

Keep dependencies minimal. Justify every new package.

## Non-negotiable rules

**Security.** Every mutation: resolve session → check role + clinic + resource →
validate with Zod → write → emit audit event. The browser is never trusted. RLS
is the second wall, not the first.

**Tenancy — FINAL. Read this before writing any query, policy or table.**

Two orthogonal questions, permanently separate:

    owner_doctor_id        whose patient is this?
    practice_location_id   where did this event happen?

Doctor's Diary is a **doctor-owned personal clinical repository, not a
clinic-owned EMR.**

- **Each doctor has a completely separate patient repository.**
  `patients.owner_doctor_id` is the ownership boundary. A patient record belongs
  to exactly one doctor.
- **The same human seen by two doctors is TWO records.** No global patient
  identity, no cross-doctor merge, no cross-doctor dedupe, no shared timeline,
  no cross-doctor visibility. Deduplication applies *only inside* one doctor's
  repository.
- **Within one doctor's repository**, visits at a hospital, a clinic, a personal
  chamber and telemedicine form **ONE continuous timeline**. That continuity is
  the product's core value — never split it.
- **`practice_location_id` is mandatory on every event table**: appointments,
  tokens, queue_events, encounters, vitals, diagnoses, investigation_orders,
  investigation_results, prescriptions, documents, followups, payments,
  notifications, audit_events, ai_sessions.
- **Staff access is location-scoped.** Access runs through
  `practice_location_members(practice_location_id, user_id, role)` plus the
  session's active location. Reception at Location A must never see Location B's
  events, or the doctor's private chamber.
- The **owning doctor** sees the full longitudinal history across all of their
  own locations. Nobody else does.
- Cross-doctor referral/sharing must be explicit, consented and audited — never
  ambient.

Roles: `DOCTOR` · `RECEPTIONIST` · `LOCATION_ADMIN`.
Location types: `PERSONAL_CHAMBER` · `CLINIC` · `HOSPITAL` · `TELEMEDICINE` · `OTHER`.

**A public patient account is NOT a patient record** (ADR 0002). `patients` is a
doctor's clinical record; a future `patient_accounts` is a human's booking login.
When building `patients`:

- include a **nullable** `patient_account_id` (null is the normal case — most
  patients are walk-ins and will never have an account)
- **never put `patient_account_id` in a clinical RLS predicate.** Authorization
  keys off `owner_doctor_id` + `practice_location_id` only. Joining on the
  account is exactly how one doctor's records leak into another's.
- allocate `patient_number` with `UPDATE … SET seq = seq + 1 RETURNING` on
  `doctor_profiles` — a read-then-write races and issues duplicate numbers.

Irreversible decisions live in `docs/decisions/`. Read the relevant ADR before
changing tenancy, patient identity, ratings, or location modelling.

**Drizzle + RLS.** Drizzle owns schema/migrations/typed queries. Request-path
queries run with the user's JWT so RLS applies. The service role lives only in
`src/db/admin.ts` — never import it from feature code.

**Immutability.** `FINALIZED` encounters and prescriptions are never edited.
Corrections create a new version plus a revision row with a reason.

**Audit reliability is not uniform — see ADR 0007.** Finalising a prescription
or encounter, amending a finalised record, and clinical document metadata must
**fail closed**, with the clinical write and its audit row in the SAME
transaction (a plpgsql function, like `create_patient()`). `emitAudit` swallows
failures by design and is therefore the WRONG mechanism for those paths —
treat an `emitAudit` call beside a finalisation as a bug. Viewing a record never
blocks care, but a failed audit there must raise an operational alert.

**Reception may register patients only through the doctor-selection RPC**
(ADR 0008). Never broaden the patient INSERT policy to let a receptionist choose
`owner_doctor_id` — the function verifies in the database that both the caller
and the selected doctor are ACTIVE at the caller's location.

**AI.** `AI_MODE=mock` is the default. Live AI additionally requires a per-clinic
opt-in flag in the database. AI has **no write access to clinical tables** — that
is a database grant, not a prompt instruction. AI proposes; a doctor accepts.
Never send raw patient rows to a provider: use the whitelist context builder and
log every disclosure.

**Medicine data.** Never generate drug facts with an LLM and store them as
reference data. Every monograph field carries `source_id` + `last_verified_at`.
No source → it does not render as reference data. Do not scrape drug databases.

**Patient-aware safety checks are deterministic rules over our own data**, never
AI. AI may *explain* a flag; it must never *raise* one.

**Cost.** Free/free-tier only. No paid APIs, SMS, voice, payment gateways, or
vector databases without explicit approval. Vercel Hobby + Supabase Free are for
development with FAKE data only — never real patients, never commercial use.

**Before deployment auth testing:** add the Vercel production domain and its
callback URLs to Supabase → Authentication → URL Configuration. Sign-in and
password reset silently redirect to the wrong origin without it.

**Before the first real patient:** finalise `docs/data-policy.md` (currently a
draft with open items on retention, account closure and patient correction).

## Design system

**The rule: glass on chrome and summary, solid on clinical data.**

- `glass` / `glass-strong` — REAL backdrop-filter. Only for chrome that content
  scrolls beneath: sidebar, top bar, bottom nav, sheets. **Max 2 visible at once.**
- `glass-flat` / `glass-flat-strong` — same translucent look, no blur. Use for
  all cards. (`GlassCard` uses this by default; `blur` prop opts in.)
- `clinical-surface` / `<SectionCard>` — opaque white. **Mandatory** for vitals,
  doses, lab values, prescriptions, diagnosis text and dense forms.

Never communicate clinical status by colour alone — always icon + text. Use
`<StatusBadge>` / `<SeverityBadge>`; do not hand-roll status pills. Touch targets
≥ 44px. Tabular numerals on every clinical value. Never block zoom.

Primitives live in `src/components/{glass,common,clinical,layout}/`. Reuse them
rather than restyling — if a new one is needed, add it there.

## Layout

Desktop ≥ xl: 248px sidebar · lg: 76px icon rail · < lg: top bar + bottom nav
(Home / Patients / **+** / Appointments / More). The `+` opens `QuickActionMenu`.

Mobile consultation (Phase 6) is a purpose-built **step flow**, not a responsive
squeeze — and it hides the bottom nav.

## Conventions

- **shadcn here is Base UI, not Radix — it is stricter.** Most training data and
  most shadcn snippets online assume Radix and will compile but crash at runtime.
  Known trap: `DropdownMenuLabel` (= `Menu.GroupLabel`) **must** be inside a
  `DropdownMenuGroup`, or it throws `MenuGroupContext is missing`. Assume other
  compound parts have the same requirement, and always open a menu/dialog/popover
  in the browser before calling it done — typecheck will not catch this class of
  bug. A crash in a shared component (e.g. `TopBar`) takes down the whole layout.
- **Container queries: declare and consume on DIFFERENT elements.** `cqw`
  resolves against the nearest *ancestor* container, so an element carrying both
  `container-type: inline-size` and a `cqw` size silently falls back to the
  viewport. The A4 preview hit this — text was sized as if the paper were as
  wide as the window. Measuring the computed values did not catch it (they were
  self-consistent, just against the wrong box); a screenshot did.
- **Disabled inputs post nothing.** A greyed-out checkbox submits as "off", so
  gating sub-options behind a master toggle silently wipes them on save. Render
  a hidden input carrying the value when a control is disabled.
- Business logic in `src/features/<domain>/`; `src/app/` is routing + composition.
- No file over ~250 lines. No duplicated business logic.
- Date/time formatting via `src/lib/format.ts` only — never `toLocaleDateString()`
  with the runtime default locale (server/client hydration mismatch).
- Mock data in `src/mocks/` is typed to the real contracts. Swapping in real
  queries should be an import change.
- English-first UI; keep i18n-ready. Bangla patient-facing output comes later.

## Database workflow

    npm run db:generate   # drizzle-kit generate — writes drizzle/migrations
    npm run db:migrate    # apply migrations      (uses DIRECT_URL, port 5432)
    npm run db:policies    # re-apply supabase/policies/*.sql (idempotent)
    npm run db:verify      # assert RLS/grants/helpers are intact — run after ANY policy change
    npm run db:verify:patients   # two doctors + staff, executed, rolled back
    npm run db:verify:templates  # template + signature-storage isolation, same shape

- **Two connection strings.** `DIRECT_URL` (session pooler, **5432**) for
  migrations and scripts; `DATABASE_URL` (transaction pooler, 6543) for app
  runtime. The transaction pooler cannot run DDL — pointing migrations at it
  fails confusingly.
- **Passwords in the URL must be percent-encoded** (`@` → `%40`), or the parser
  reads the password as the host.
- **Never let a generated migration touch `auth.users`.** Drizzle emits
  `CREATE TABLE "auth"."users"` because the table is declared in schema.ts for
  the foreign key. Delete that statement from the migration — Supabase owns
  that table and altering it breaks authentication.
- Adding an event table? It **must** carry `practice_location_id`, and it needs
  policies in `supabase/policies/` in the same change. A table with RLS on and no
  policy silently returns zero rows.
- **`INSERT … RETURNING` applies SELECT policies to the new row**, and
  supabase-js issues RETURNING whenever you chain `.select()`. If the inserting
  user cannot yet read the row, the insert fails with the misleading message
  "new row violates row-level security policy". This has bitten once already.
- Renaming a table? The `SECURITY DEFINER` helpers store their bodies as text
  and will silently break — re-run `npm run db:policies` immediately after.
- drizzle-kit cannot generate renames without an interactive TTY. Write the
  `ALTER … RENAME` SQL by hand in `supabase/migrations/`, apply with
  `scripts/apply-sql.mjs`, then regenerate the baseline and
  `scripts/stamp-baseline.mjs`. Never let a generated migration drop and
  recreate a table that holds data.

## Working on this machine

Node is not on PATH. Prefix every PowerShell command:

    $env:PATH = "E:\Minhaz Siraji\Claude\tools\node-v22.16.0-win-x64;$env:PATH"

Before finishing any coding task: `npm run lint`, `npm run typecheck`,
`npm run build`. Dev server: preview_start with the `doctors-diary` config
(port 3200) — never `npm run dev` via Bash.

Report concisely: DONE / FILES CHANGED / TESTS / NEXT ACTION.
Do not scan the whole repo. Read only what the task needs.
