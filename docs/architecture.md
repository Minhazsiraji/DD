# Doctor's Diary — Architecture

Approved Phase 0 architecture, as corrected. `CLAUDE.md` holds the short rules
loaded every session; this file holds the detail. Keep them consistent.

---

## 1. What this product is (and is not)

**Is:** the doctor's own record of their own patients, across every place they
practise — own chamber, clinics, hospitals, telemedicine.

**Is not:** clinic management software. Every clinic already runs its own
system. Doctor's Diary does not try to replace or integrate with them.

That single decision drives the data model below.

---

## 2. Tenancy — FINAL (doctor-owned identity, location-scoped events)

> **Settled 2026-08-08.** Two orthogonal questions, permanently separate:
> `owner_doctor_id` = *whose patient is this?* ·
> `practice_location_id` = *where did this event happen?*
>
> **Each doctor has a completely separate patient repository.** The same human
> seen by two doctors is TWO records — no global patient identity, no
> cross-doctor merge, dedupe, or visibility. Deduplication applies only *inside*
> one doctor's repository.
>
> **Within one doctor's repository**, visits at a hospital, a clinic, a personal
> chamber and telemedicine form ONE continuous timeline.
>
> **Staff access is location-scoped** via `practice_location_members` + the
> session's active location. Reception at Location A never sees Location B.
>
> `clinic_*` was renamed to `practice_location_*` before patient tables existed,
> because a doctor practises in hospitals and chambers too — forcing those to
> masquerade as "clinics" would have been permanent schema debt.
> Types: `PERSONAL_CHAMBER` · `CLINIC` · `HOSPITAL` · `TELEMEDICINE` · `OTHER`.
> Roles: `DOCTOR` · `RECEPTIONIST` · `LOCATION_ADMIN`.

### Superseded reasoning (kept for context)

Decided 2026-08-07 after weighing two conflicting requirements: the doctor wants
one continuous record of a patient across every chamber they practise in, and
each clinic's staff must not see another clinic's activity. The hybrid satisfies
both; neither pure model does.

```
clinics ──── clinic_members(clinic_id, user_id, role) ──── auth users
   │                                                          │
   │                                              doctor_profiles
   │                                                          │
   │                                     patients.owner_doctor_id
   │                                        (identity: doctor-owned)
   │                                                          │
   └──► appointments · encounters · prescriptions · documents · payments …
                       every one carries clinic_id
                                  │
                   patient_clinic_links(patient_id, clinic_id)
```

**Identity layer — doctor-owned**

- `patients.owner_doctor_id`. One human seen at two clinics is **one record with
  one timeline**. This is the product's core value.
- Patient numbers come from a per-doctor sequence (`AR-000124`), generated with a
  row lock — never `COUNT(*)+1`, which races.

**Event layer — clinic-scoped**

- `clinic_id` is **mandatory** on `appointments`, `appointment_confirmations`,
  `tokens`, `queue_events`, `encounters`, `vitals`, `diagnoses`,
  `investigation_orders`, `investigation_results`, `prescriptions`, `documents`,
  `followups`, `payments`, `notifications`, `audit_events`, `ai_sessions`.
- Authorization never relies on `doctor_id` alone. Every policy checks
  `clinic_id ∈ (clinics the user is an active member of)` and, for most roles,
  `clinic_id = session.active_clinic_id`.
- `patient_clinic_links` records where a patient has been seen. Non-owner roles
  reach a patient only via a link for their active clinic.

**Visibility, stated plainly**

| Actor | Sees |
|---|---|
| Owning doctor | the patient's **full** timeline, across every clinic |
| Another doctor at clinic B | only clinic B's events for that patient |
| Receptionist at clinic B | clinic B's appointments/tokens/payments; no clinical notes |
| Clinic admin at clinic B | clinic B operational data; never `private_notes` |

Cross-doctor sharing (referral) is explicit, consented and audited — never
ambient.

**Why not either pure model.** Clinic-owned alone splits the same person into one
record per clinic, destroying the continuous timeline the product exists to
provide. Doctor-owned alone gives no clinic boundary, so a receptionist hired at
one chamber could see activity from all of them. Note that neither pure model is
a cheap migration target from the other — doctor→clinic requires *splitting*
records, clinic→doctor requires *merging* them — which is exactly why this is
settled before the first schema is written.

---

## 3. Runtime

One Next.js app. RSC pages + Server Actions + Route Handlers. No separate API
service, no microservices, no native app.

```
Browser / installed PWA
        │ HTTPS
Next.js ── authorization ── Zod validation ── audit emitter
        │
        ├── Supabase Postgres (RLS, pg_trgm)
        ├── Supabase Storage (private, signed URLs)
        └── Provider ports: AI · Notification · Payment · Storage
                             └── mock adapters by default
```

**Three invariants**

1. The browser is never trusted. Every mutation: session → authorization →
   validation → write → audit.
2. External services sit behind ports. Feature code imports the interface,
   never a vendor SDK. CI runs against mocks.
3. AI proposes, the doctor disposes. AI output writes to drafts only.

### Drizzle + RLS

Drizzle owns schema, migrations and typed query building. Request-path queries
run on a connection carrying the **user's JWT** so RLS applies. The service-role
connection lives only in `src/db/admin.ts`, used by jobs and seeding, and is
import-restricted. Application-layer authorization is still mandatory — RLS is
the backstop that catches bugs, not the design.

---

## 4. Data model

UUID primary keys. `doctor_id` everywhere. `created_at` / `updated_at` /
`created_by`. Soft delete only — never hard-delete a medical record. Money is
`numeric(12,2)`.

### Identity & practice

```
auth.users ─1:1─ profiles(id, full_name, phone, avatar_url, locale)
                    └─1:0..1─ doctor_profiles(user_id, qualification,
                                specialization, bmdc_registration_no,
                                signature_url, patient_number_prefix,
                                patient_number_seq)
practice_locations(id, doctor_id, name, type, address, phone,
                   consultation_fee, followup_fee, followup_free_days,
                   slot_minutes, is_active)
practice_sessions(id, location_id, weekday, start_time, end_time)
practice_members(id, doctor_id, user_id, role, permissions jsonb, status)
```

`role ∈ {DOCTOR, ASSISTANT, RECEPTIONIST}` — scoped to a doctor's practice.

### Patients

```
patients(id, doctor_id, patient_number, full_name, name_normalized,
         dob, dob_precision, sex, phone, phone_e164, email, address,
         blood_group, height_cm, weight_kg, guardian_patient_id,
         relationship_to_guardian, is_deceased, merged_into_id)
  ├── patient_contacts        ├── patient_allergies
  ├── patient_conditions      ├── patient_medications (PRESCRIBED | REPORTED)
  └── patient_alerts
```

- **BMI is computed, never stored** — height and weight change.
- `dob_precision ∈ {DAY, MONTH, YEAR, AGE_ONLY}`. Many patients do not know an
  exact birth date; storing a fake `1970-01-01` corrupts every weight/age-based
  dose calculation. This one column prevents a whole class of clinical error.
- Dedupe on create: trigram match on `name_normalized` + `phone_e164`, surfaced
  as a **suggestion**. Never auto-merge. `merged_into_id` preserves history.

### Appointments, tokens, queue

```
appointments(id, doctor_id, location_id, patient_id, scheduled_at,
             duration_minutes, visit_type, status, source, fee_amount, …)
  ├── appointment_events(from_status, to_status, actor_id, reason)  append-only
  ├── appointment_confirmations(channel, recipient, delivery_status, response)
  └── tokens(id, appointment_id, doctor_id, location_id, session_date,
             token_number, queue_position, priority, expected_at,
             checked_in_at, called_at, consultation_started_at,
             consultation_ended_at, status)
        └── queue_events(token_id, event_type, actor_id, meta)
```

Status is a **state machine**, not a free string column. Legal transitions live
in one module with exhaustive tests; ad-hoc status assignment anywhere else is a
bug.

`visit_type ∈ {NEW, FOLLOWUP, REPORT_REVIEW, PROCEDURE, EMERGENCY}` drives both
fee logic and the queue estimator.

**Queue estimation:** median consultation duration per
`(doctor_id, location_id, visit_type)` over recent completed encounters, falling
back to the configured slot length. Plain SQL, ~30 lines. No ML.

### Clinical encounter

```
encounters(id, doctor_id, location_id, patient_id, appointment_id?,
           encounter_date, status ∈ {DRAFT, FINALIZED, AMENDED},
           chief_complaint, hpi, examination, assessment, advice,
           private_notes, finalized_at, version)
  ├── encounter_revisions(version, snapshot jsonb, changed_by, reason)
  ├── vitals · diagnoses · investigation_orders · investigation_results
  └── prescriptions
        └── prescription_items(generic_id?, brand_id?, presentation_id?,
              display_name, strength_text, form, route,
              dose_amount, dose_unit, frequency_code, frequency_struct jsonb,
              duration_value, duration_unit, prn, food_relation,
              instruction_text, substitution_allowed)
```

- `private_notes` is a **separate column with its own policy** — staff never see
  it. This only works as a distinct column, not a UI flag.
- `FINALIZED` encounters and prescriptions are **immutable**. A correction
  creates a new version plus a revision row with a reason. Trivial now, painful
  to retrofit, and what makes the record defensible.
- `frequency_code` stores `"1+0+1"` for fast entry and display;
  `frequency_struct` stores the machine-readable truth. Both, always.

### Medicine Intelligence

```
manufacturers · drug_classes
generics(id, name, name_normalized, class_id, atc_code?)        ← molecule
generic_synonyms(generic_id, term)                              ← "acetaminophen"
brands(id, name, generic_id, manufacturer_id, regulatory_status)← marketed product
presentations(id, brand_id, strength_value, strength_unit,
              dosage_form, route, pack_size, mrp_bdt?)
monographs(id, generic_id, locale)
  └── monograph_sections(section_key, body_md,
                         source_id, source_url, last_verified_at, verified_by)
interactions(generic_a_id, generic_b_id, severity, mechanism, management, …)
sources(id, name, kind, url, license_note)
doctor_favorite_medicines(doctor_id, presentation_id, use_count, last_used_at)
```

The generic → brand → presentation model makes every search direction fall out
of one index: generic→brands, brand→generic, manufacturer→medicines,
class→medicines, indication→medicines.

**Fuzzy search** ("Paracitamol", "Napa") = one materialised view over generic
names + synonyms + brand names with a **`pg_trgm` GIN index**. Free, in-database,
no vector store, no external search service.

**Provenance is per-section**, because you will realistically have a licensed
source for interactions and an open source for indications in the same
monograph. A field with no source does not render as reference data.

**Ingestion** is versioned and reviewable: import → normalise → human review
queue → publish. No auto-publish. Reversible.

### Everything else

```
documents(doctor_id, patient_id, encounter_id?, doc_type, storage_path, …)
followups(mode ∈ {ON_DATE, AFTER_DAYS, AFTER_WEEKS, AFTER_REPORTS},
          target_date?, depends_on_orders uuid[], status, booked_appointment_id)
payments ─ payment_transactions(amount, method, reference, is_refund)
notifications(channel, template_key, recipient, delivery_status, cost_units)
ai_sessions ─ ai_messages ─ ai_context_disclosures(fields_sent jsonb, provider)
audit_events(actor_id, action, resource_type, resource_id, ip, meta)  append-only
```

`ai_context_disclosures` records exactly which patient fields left the system,
to which provider, when. Without it you cannot answer "what did you send about
my patient?" — and that question will be asked.

### Indexes from day one

`(doctor_id, patient_number)` · `(doctor_id, phone_e164)` · trigram on
`patients.name_normalized` · `(doctor_id, location_id, scheduled_at)` ·
`(doctor_id, location_id, session_date, token_number)` ·
`(patient_id, encounter_date DESC)` · trigram on the medicine search view ·
`(doctor_id, occurred_at DESC)` on audit.

---

## 5. Security

```
1. Transport      HTTPS · HSTS · secure cookies
2. Authentication Supabase Auth · email verify · session rotation · MFA (P13)
3. Authorization  requireUser() → requireDoctorContext() → can(role, action, res)
4. Validation     Zod at every trust boundary, server-side
5. RLS            policies scoped by doctor_id + role — the backstop
6. Column policy  private_notes and diagnosis detail hidden from staff
7. Storage        private bucket · short-lived signed URLs · access logged
8. Audit          append-only, no UPDATE/DELETE grant, written server-side
9. Secrets        env only; .env.example committed, .env.local never
```

### Permission matrix

| Resource | Doctor | Receptionist | Assistant |
|---|---|---|---|
| Patient demographics | RW | RW | RW |
| Allergies / conditions | RW | R | RW |
| Encounter (clinical) | RW | ✗ | R |
| `private_notes` | RW | ✗ | ✗ |
| Prescription | RW | R (print only) | R |
| Investigation results | RW | metadata only | R |
| Documents | RW | upload + metadata | RW |
| Appointments / tokens / queue | RW | RW | RW |
| Payments | R | RW | R |
| Locations / members | RW | ✗ | ✗ |
| Audit log | R | ✗ | ✗ |
| AI assistant | ✅ | ✗ | ✗ |

**Nobody but the doctor reads `private_notes`.** There is no admin override.

### Audited actions

Patient viewed/created/updated/merged · encounter opened/finalized/amended ·
`private_notes` accessed · prescription created/finalized/printed · document
viewed/downloaded/uploaded · appointment status change · payment recorded/
refunded/waived · member invite/remove · login/logout/failed login · **every AI
call with the context disclosed** · export.

Never logged: passwords, tokens, session ids, document contents, raw AI prompts
containing PHI (log field *names* via `ai_context_disclosures`).

### Compliance posture

Technical safeguards ≠ compliance. Doctor's Diary makes **no** HIPAA/GDPR/local
compliance claim. Honest position: *built with healthcare-grade technical
safeguards; formal certification is a separate, later workstream.*

Before the first real patient: a documented backup/restore procedure that has
been **tested by actually restoring**, plus a data retention and export/delete
policy.

---

## 6. AI architecture

```ts
type AICapability =
  | 'patient-summary' | 'record-search' | 'drug-information'
  | 'interaction-check' | 'report-summary' | 'evidence-search'
  | 'documentation-draft' | 'referral-draft' | 'visit-summary';

interface AIProvider {
  invoke(req: {
    capability: AICapability;
    input: string;
    context?: RedactedPatientContext;   // never a raw patient row
    locale: 'en' | 'bn';
  }): Promise<AIResult>;   // content · citations · confidence · usage
}
```

### Context minimisation (mandatory)

```
Patient record ─► ContextBuilder(capability)   whitelist per capability
                        │  drops name, phone, email, address, ID, photo,
                        │  exact DOB (sends age band + weight)
                        ▼
                RedactedPatientContext ──► logged to ai_context_disclosures
                        ▼
                   AIProvider (external)
                        ▼
                Safety post-processor  strip imperative prescribing language,
                        │              force disclaimer + citations
                        ▼
                Doctor reviews ─► [Accept] [Edit] [Discard]
                        ▼ only on Accept
                Clinical record (versioned, ai_assisted = true)
```

**Whitelist, never blacklist.** A blacklist leaks the field you forgot to add.

### Gating and cost

- `AI_MODE=mock` by default, in CI, and in every local env.
- Live AI additionally requires a **per-clinic/per-doctor opt-in flag in the
  database**. A live API key alone must never be sufficient.
- Model tiering: cheap model for extraction/formatting; mid for summaries and
  drafts; large only for evidence reasoning, doctor-initiated.
- Hard per-doctor daily token cap. Summaries cached on
  `(patient_id, last_encounter_id)`.
- **No AI call fires on page load, ever.** Every call is an explicit user action.

### Retrieval — no vector database

"Why was Metformin stopped?" is answered by **structured SQL** over
`prescription_items` and the surrounding encounter notes, then a small model call
to phrase it with links back to source encounters. More accurate, auditable,
cheaper and simpler than embedding a patient's history. pgvector stays available
for a future evidence corpus; no external vector service.

### Hard prohibitions (enforced by grants, not prompts)

The AI layer has **no write access to any clinical table**. It writes only to
`ai_*` tables and `*_draft` records. Prompts can be talked around; grants cannot.

AI must not autonomously diagnose or prescribe, modify records silently, or alter
a prescription. Every AI surface carries a persistent, non-dismissible badge.

---

## 7. Medicine Intelligence UX

Three tiers, **visually distinct and never interleaved** — different background,
accent rail and icon:

| Tier | Rail | Source |
|---|---|---|
| **Verified reference data** | blue | `monograph_sections` + source + verified date |
| **Patient-specific consideration** | amber | deterministic rules over our own data |
| **AI explanation** | violet | model-generated, cited, never stored |

A doctor must be able to tell at a glance, without reading, whether they are
looking at a regulator-approved fact or a language model's paraphrase.

**Patient-aware checks are deterministic** — allergy match on generic,
interaction lookup, weight-based paediatric dose, renal/hepatic flag, pregnancy
status. Testable and reproducible. AI *explains* a flag; it never *raises* one.

**Severity ladder:** 🟢 none · 🟡 review · 🔴 serious · ⛔ critical (blocks
finalisation until acknowledged with a reason). Only 🔴/⛔ interrupt. Alert
fatigue is a documented patient-safety hazard: a system that warns about
everything warns about nothing.

**Compare / alternatives** never ranks a drug as universally better. It shows
typical role, key advantage, important limitation, and patient-specific
considerations, and requires doctor judgement.

---

## 8. Design system

**The rule: glass on chrome and summary, solid on clinical data.**

| Utility | Blur? | Use for |
|---|---|---|
| `glass`, `glass-strong` | yes | sidebar, top bar, bottom nav, sheets — **max 2 visible** |
| `glass-flat`, `glass-flat-strong` | no | all cards (`GlassCard` default) |
| `clinical-surface` / `SectionCard` | no, opaque | vitals, doses, lab values, prescriptions, forms |
| `inset-panel` | no | recessed sub-panels inside a card |
| `icon-orb` + `orb-*` | no | circular gradient icon badges (decorative, aria-hidden) |

Each `backdrop-filter` element is its own compositing pass. The first build used
11 and would have stuttered on a budget Android device; cards moved to
`glass-flat` and it is now 3.

### Tokens

Canvas is deliberately blue (`#e4edfd → #c9dbf9`) — on a near-white canvas a
translucent card looks flat, not like glass. Shadows are soft and diffuse with a
light top edge (`inset 0 1px 0 rgb(255 255 255 / .8)`).

Text: `ink` #0F1B2D (15.9:1) · `ink-secondary` #47566B (7.6:1) ·
`ink-muted` #6B7A90 (4.6:1 — never for clinical values).

Radius 20/24px. Spacing 4/8/12/16/24/32/48. Motion 150–220ms, opacity and
transform only.

### Accessibility (requirements, not niceties)

- Never communicate clinical status by colour alone — always icon + text.
- `prefers-reduced-transparency` → solid surfaces; `prefers-reduced-motion` →
  no animation. Both implemented.
- Touch targets ≥ 44px. Zoom is never blocked (`maximumScale: 5`).
- Tabular numerals on every clinical value.

### Layout

Desktop ≥ xl: 248px sidebar · lg: 76px icon rail · < lg: top bar + bottom nav
(Home / Patients / **+** / Appointments / More).

Mobile consultation (Phase 6) is a purpose-built **step flow**, not a responsive
squeeze, and hides the bottom nav — the step bar owns the bottom of the screen.

---

## 9. Phases

| Phase | Scope |
|---|---|
| 0 | Architecture ✅ |
| **1** | **Scaffold · design system · app shell · mock dashboard ✅** |
| 2 | Auth · doctor profile · locations · **RBAC + RLS + audit** |
| 3 | Patients · search · dedupe · profile · timeline |
| 4 | Appointments · state machine · calendar · confirmation records |
| 5 | Tokens · live queue · reception desk · realtime |
| 6 | Consultation (+ mobile step flow) · vitals · diagnosis · investigations |
| 7 | Medicine schema · catalogue · fuzzy search · seed pipeline |
| 8 | Prescription builder · safety rules · **A4 PDF** |
| 9 | Medicine Intelligence UI · compare · patient-aware checks |
| 10 | Documents vault · signed URLs · follow-ups |
| 11 | Payments (manual methods) |
| 12 | AI assistant UI · mock provider · context minimisation |
| 13 | Security review · threat model · backup restore drill · a11y · perf |
| 14 | Real AI / SMS / voice / payment gateway — explicit approval each |

Security is **not** a late phase: RLS, RBAC and audit land in Phase 2 and every
later phase ships its own policies and audit events as part of done.

Each phase ends with lint → typecheck → test → build → one clean commit.

### Prescription output (Phase 8)

A4 default. Must carry: doctor name, qualification, specialization, BMDC
registration number, location details, patient identity and number, date, Rx
items, advice, follow-up, and a signature area. Architect for A5 and custom
templates later.

---

## 10. Cost

**Free:** Next.js, React, TypeScript, Tailwind, shadcn/ui, Lucide, Drizzle, Zod,
RHF, TanStack Query, Recharts, Postgres + pg_trgm + pgvector, Vitest/Playwright,
GitHub private repos, service-worker PWA.

**Free tier now → paid later:** Supabase (~500 MB DB / 1 GB storage; **pauses
after ~7 days idle**) → ~$25/mo. Vercel Hobby (**non-commercial only**, no
password-protected previews) → ~$20/mo. Resend ~3k emails/mo.

**Deferred, explicit approval required:** SMS (~৳0.30–0.60 each), voice IVR,
AI tokens, **licensed drug database (the wildcard — can exceed everything else
combined)**, payment gateway.

Realistic cost for the first live chamber: **~$45–50/mo** plus metered SMS and AI.

> **Hard rule:** Vercel Hobby and Supabase Free are for development and demo with
> **fake data only**. No real patient data, no commercial use. Disable Hobby
> model-training settings for this project.

---

## 11. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Unverified drug data reaches a prescription | 🔴 | Per-field provenance; no source → not shown; AI never writes reference data |
| 2 | Alert fatigue → real warnings ignored | 🔴 | Only 🔴/⛔ interrupt; every alert states why; tune with real doctors |
| 3 | RLS bypassed by service-role connection | 🔴 | Single admin module, import-restricted; RLS policy test suite |
| 4 | PHI sent to AI without disclosure | 🟠 | Whitelist context builder; disclosure log; per-doctor opt-in; mock default |
| 5 | Consultation too slow → doctors revert to paper | 🟠 | 60-second returning-patient target is a Phase 6 acceptance criterion |
| 6 | Storage cost explosion (imaging) | 🟠 | Size limits, client-side compression, model cost before onboarding |
| 7 | Glass UI janky on low-end Android | 🟡 | Solid clinical surfaces; 2-blur cap (enforced, verified); test on a real budget device |
| 8 | Backups never tested | 🟡 | Restore drill is a Phase 13 deliverable |
| 9 | Duplicate patient records | 🟡 | Trigram dedupe on create; `merged_into_id`; never auto-merge |
| 10 | Compliance claimed too early | 🟡 | Explicit "not certified" posture |

---

## 12. Deferred decisions

- **Production data region** — decided at first real deployment, after checking
  residency requirements. Cannot be changed later without migration.
- **Bangla UI** — English-first now, i18n-ready. Patient-facing Bangla output
  later; bundle the Bangla face then rather than reworking the type scale.
- **Medicine data licensing** — architecture built now, no purchase. Scope the
  commercial question before Phase 7.
- **Group practices** — doctor-owned today; add a practice layer if and when
  real demand appears.
