@AGENTS.md

# Doctor's Diary

AI-enabled clinical + chamber operating system for doctors. One responsive
Next.js app (desktop, tablet, mobile, installable PWA). No separate native app.

**Current phase: Phase 1 complete** (scaffold, design system, app shell, mock
dashboard). Next: Phase 2 — auth, doctor profile, clinic, RBAC + RLS + audit.

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

**Tenancy — DOCTOR-owned.** This is the product's core idea, not a detail.
Every clinic already runs its own system. Doctor's Diary is the *doctor's* record
of *their* patients, wherever those patients were seen.

- `doctor_id` on every clinical table, in every query, in every RLS policy.
  There is no `clinic_id` tenancy column.
- A **location** (own chamber / clinic / hospital / telemedicine) is an attribute
  of an appointment or encounter. It never owns data and never filters a patient.
- One patient seen at two locations is **one record with one timeline**.
- Two doctors sharing a chamber each keep their own diary; the same human patient
  is a separate record for each. That is intended and privacy-correct.
- Patient numbers come from a per-doctor sequence.
- Delegated staff (a doctor's own receptionist) go in
  `practice_members(doctor_id, user_id, role)` — not a clinic membership table.
- Switching location filters the working day (schedule, queue, fees). It must
  never scope patient data.

**Drizzle + RLS.** Drizzle owns schema/migrations/typed queries. Request-path
queries run with the user's JWT so RLS applies. The service role lives only in
`src/db/admin.ts` — never import it from feature code.

**Immutability.** `FINALIZED` encounters and prescriptions are never edited.
Corrections create a new version plus a revision row with a reason.

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

- Business logic in `src/features/<domain>/`; `src/app/` is routing + composition.
- No file over ~250 lines. No duplicated business logic.
- Date/time formatting via `src/lib/format.ts` only — never `toLocaleDateString()`
  with the runtime default locale (server/client hydration mismatch).
- Mock data in `src/mocks/` is typed to the real contracts. Swapping in real
  queries should be an import change.
- English-first UI; keep i18n-ready. Bangla patient-facing output comes later.

## Working on this machine

Node is not on PATH. Prefix every PowerShell command:

    $env:PATH = "E:\Minhaz Siraji\Claude\tools\node-v22.16.0-win-x64;$env:PATH"

Before finishing any coding task: `npm run lint`, `npm run typecheck`,
`npm run build`. Dev server: preview_start with the `doctors-diary` config
(port 3200) — never `npm run dev` via Bash.

Report concisely: DONE / FILES CHANGED / TESTS / NEXT ACTION.
Do not scan the whole repo. Read only what the task needs.
