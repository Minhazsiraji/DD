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

**Tenancy — HYBRID. Read this before writing any query or policy.**

Patient *identity* is doctor-owned; every clinical *event* is clinic-scoped.
This is deliberate: it gives the doctor one continuous timeline per patient
across all their chambers, while keeping each clinic's staff boxed into that
clinic. Neither half is optional.

- `patients.owner_doctor_id` — the patient belongs to the **doctor**. One human
  seen at two clinics is **one record with one timeline**. Patient numbers come
  from a per-doctor sequence.
- **`clinic_id` is mandatory on every event table**: `appointments`,
  `appointment_confirmations`, `tokens`, `queue_events`, `encounters`, `vitals`,
  `diagnoses`, `investigation_orders`, `investigation_results`, `prescriptions`,
  `documents`, `followups`, `payments`, `notifications`, `audit_events`,
  `ai_sessions`. Never rely on `doctor_id` alone for authorization.
- Access runs through `clinic_members(clinic_id, user_id, role)` plus the
  session's **active clinic**. Staff see only events at their own clinic.
- `patient_clinic_links(patient_id, clinic_id)` records which clinics a patient
  has ever been seen at. Non-doctor roles may only reach a patient through a
  link for their active clinic.
- **The doctor who owns a patient sees that patient's full timeline across
  clinics; nobody else ever does.** Clinic staff see only their clinic's events.
- Cross-doctor sharing (referral) must be explicit, consented and audited.
  Never ambient.

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

- **shadcn here is Base UI, not Radix — it is stricter.** Most training data and
  most shadcn snippets online assume Radix and will compile but crash at runtime.
  Known trap: `DropdownMenuLabel` (= `Menu.GroupLabel`) **must** be inside a
  `DropdownMenuGroup`, or it throws `MenuGroupContext is missing`. Assume other
  compound parts have the same requirement, and always open a menu/dialog/popover
  in the browser before calling it done — typecheck will not catch this class of
  bug. A crash in a shared component (e.g. `TopBar`) takes down the whole layout.
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
