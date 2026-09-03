# Data Policy V2 — Doctor's Diary

> ## STATUS: DRAFT V2 · NOT IN FORCE
>
> **Prepared by Loop D (documentation lane), 2026-09-02.** Supersedes the V1 draft
> in this file; the V1 text is preserved in git history.
>
> This document must be reviewed by someone qualified to advise on Bangladeshi
> practice, and formally approved by the owner, **before the first real patient
> record is entered.** Until then the system is development-only and carries
> fake data.
>
> **Every item marked `PENDING OWNER + LEGAL/REGULATORY DECISION` is an open
> question, not a commitment.** Nothing in this document invents a retention
> period, asserts a statutory obligation, or claims a certification.
>
> **This document does not decide architecture.** It states the *principle* the
> architecture must satisfy, never the mechanism.
>
> ### RECONCILED AGAINST ACCEPTED ARCHITECTURE — 2026-09-03
>
> Database V2 architecture **Rev 4.3.2d** is independently and finally accepted:
> **C2 FINAL — A. ✅ ARCHITECTURE ACCEPTED FOR ISOLATED V2 IMPLEMENTATION.**
>
> Every promise below has been checked against it. The dependencies this document
> previously carried as `PENDING LOOP F + C2 ARCHITECTURE ACCEPTANCE` are
> **resolved** and are now stated as commitments the architecture supports.
>
> **Three things acceptance does NOT change, and this document does not imply
> otherwise:**
>
> | | |
> |---|---|
> | **Architecture acceptance ≠ implementation** | It authorizes **isolated V2 implementation**. No schema exists yet |
> | **Architecture acceptance ≠ destructive authorization** | **G-3 = FAIL (G3-C).** Reset, cleanup, auth deletion and storage deletion **remain prohibited** |
> | **Architecture acceptance ≠ real-patient authorization** | Retention, closure, correction, jurisdiction and the data contact remain open. See [Pilot Operations](policy/pilot-operations.md) |
>
> **The current clinical estate is development/test only**, by owner attestation.
> **No clinical-data migration is required.** The one identity that must survive
> is the owner's control-plane account.

**Related:** [Clinical Data Classification](policy/clinical-data-classification.md) ·
[Platform Role Governance](policy/platform-role-governance.md) ·
[Clinical Record Lifecycle](policy/clinical-record-lifecycle.md) ·
[Personal Vault vs Clinical Documents](policy/personal-vault-and-clinical-documents.md) ·
[AI / Service-Agent Governance](policy/ai-service-agent-governance.md) ·
[Glossary](glossary.md)

---

## 1. What this software is

Doctor's Diary is **a doctor's own clinical record of their own patients.**

It is not a clinic EMR, not a hospital information system, and not a
patient-facing health record. A clinic already runs its own system; this is the
record the doctor keeps across every place they practise.

That sentence is not marketing. It is the reason the data model is shaped the
way it is, and every rule below follows from it.

---

## 2. The doctor-owned clinical repository principle

**Each doctor's patient records belong to that doctor.** If a doctor practises
at three places, the records travel with the doctor, not with any of those
places.

- A clinic, hospital or chamber where a doctor practises does **not** gain access
  to that doctor's patient records by hosting them.
- **An organization never owns clinical data.** Organizations and their branches
  describe *where care happened*; they are never the controller of the clinical
  record. This is stated here as a promise, not left as an implementation
  detail. *(Loop F §43 U-14 asks for exactly this statement.)*
- Deactivating a location, leaving a hospital, or an organization closing does
  not transfer, delete or expose the doctor's records.

### 2.1 Separation between doctors is absolute

**The same real person treated by two doctors produces two separate clinical
records, and no shared clinical visibility.**

- There is no cross-doctor patient search, no merge, no dedupe across doctors,
  and no shared timeline. Deduplication applies only *inside* one doctor's own
  repository.
- Two doctors practising at the same hospital, at the same time, on the same
  day, see nothing of each other's records. Being colleagues at a location is
  not a clinical relationship.
- A shared platform identity for the person (so they can book, and hold their
  own documents) **does not** create a clinical join. Identity linkage and
  clinical authorization are permanently different questions.
- Cross-doctor access exists only as an **explicit, consented, time-bounded,
  audited share** — and a share results in a *copy into the receiving doctor's
  record*, never a widened view of the source. It is a share, not a join.

> **This has been breached once and fixed.** Policies `0039` and `0040` record a
> reproduced defect where a second doctor at the same hospital could read the
> first doctor's patient rows, because the rule admitted any active member of a
> shared location without constraining role. The fix — explicit role allowlists,
> never exclusions — is the standing pattern. This history is kept in the policy
> deliberately: the promise above is credible because the one time it failed is
> written down.

---

## 3. Who controls the data, and what Doctor's Diary is

**The doctor is the controller of the clinical record. Doctor's Diary operates
the platform on their behalf.**

Doctor's Diary is a **platform and data processor, not the commercial owner of
clinical data.** Concretely:

- Clinical data is held **for** the doctor, not **as** an asset of the business.
- Paying for a subscription buys access to software. It does not buy the
  doctor's records, and not paying does not forfeit them (§9).
- Doctor's Diary does not acquire rights to clinical content by hosting it.

### 3.1 Clinical and patient data is never sold

**Clinical data, patient identity and personal health data are never sold,
rented, brokered, licensed or exchanged for value with any third party.**

This includes: pharmaceutical companies, insurers, advertisers, data brokers,
researchers, device makers, and any acquirer of the business. There is no
"anonymised" or "aggregated" carve-out in this policy today — an aggregate
product would be a new decision requiring its own approval, its own consent
basis and its own public statement.

`PENDING OWNER DECISION` — whether any future de-identified or aggregate use is
ever contemplated. Until that decision exists and is published, the answer this
policy gives is **no**. *(Loop F §43 U-7 correspondingly recommends removing an
unused `RESEARCH_DEIDENTIFIED` consent type: an unused consent type will
eventually be used by accident.)*

### 3.2 Clinical data is never marketing targeting material

Diagnoses, prescriptions, investigation results, clinical notes, documents,
inferred conditions and family clinical records are **never** inputs to
marketing, offers, promotions or campaign audiences.

Engagement with a health message is not an inference. Opening a public health
advisory records that it was read, and nothing else — it does not derive an
interest, a condition or an audience.

See [Clinical Data Classification](policy/clinical-data-classification.md) for
the per-category rule and
[Public Health Advisory Governance](policy/public-health-advisory-governance.md)
for the advisory case.

---

## 4. Identity distinctions this policy depends on

Four different things could loosely be called "the patient". Conflating them is
how one doctor's records become reachable from another's, so the policy names
them separately. Full definitions in the [Glossary](glossary.md).

| Concept | What it is | Who controls it |
|---|---|---|
| **Account / auth user** | A login. | The person who holds it |
| **Health subject** | A real human being as the platform knows them, so they can book, be a family member, and hold their own documents. | The person, or their guardian |
| **Clinical patient record** | One doctor's clinical record about a person. | That doctor |
| **Booking party** | Whoever made an appointment (may be a relative). | The account holder |

**A platform account is not a clinical record** (ADR 0002). A person having an
account does not create a clinical record; a doctor creating a clinical record
does not create an account for the person.

**The link between a health subject and a clinical patient record is never an
authorization path.** It answers "who is this person, for booking and family
purposes"; it never answers "may this doctor read this record".

**RESOLVED by accepted architecture Rev 4.3.2d.** The four concepts are separate
structures: an auth user and profile carry no persona; a professional identity is
a distinct row; a clinical record is owned by that professional identity, never
by the login; and `patient_subject_links` records who a person is **without ever
appearing in a clinical authorization rule**.

---

## 5. Personal health vault vs doctor clinical document

A person may hold their own health documents. A doctor holds clinical documents
about their patient. **These are different systems with different owners and
different lifecycles**, and a file never exists in both at once — moving between
them is a **copy**, with provenance.

The full boundary, sharing model and revocation semantics are specified in
[Personal Vault vs Clinical Documents](policy/personal-vault-and-clinical-documents.md).
The two consequences that belong in a data policy:

1. **A person's documents are theirs.** A doctor sees one only through an
   explicit share, and only while that share is live.
2. **A document a doctor has already imported into a completed clinical record
   stays in that record.** Revoking a share stops future access to the person's
   copy; it does not reach into and delete clinical evidence the doctor relied on
   and is professionally responsible for. Revocation is **prospective**.

This is the honest position and it is stated plainly rather than softened: a
person cannot retroactively remove what a doctor legitimately incorporated into
their clinical record. What they *can* do is stop any further access, and ask for
correction (§11).

---

## 6. Family and guardian access

- Access to a health subject's data by anyone other than that subject exists
  only through an **explicit, live, recorded access relationship** — never
  inferred from a shared phone number, surname, address or booking history.
- **A label is not authority.** Describing someone as "father" does not grant
  access; a granted access relationship does.
- Access is **derived from live relationships at the time of the request**, not
  from a cached status. When a relationship ends, access ends.
- **One relationship ending must not silently disable a person's own access, or
  another valid guardian's.** Each relationship is evaluated on its own.
- A person reaching the age of majority takes control of their own subject; a
  guardian's access does not silently persist past it.
- Family notification and family access are separate: being able to book for a
  relative does not imply reading their clinical history.

`PENDING OWNER + LEGAL/REGULATORY DECISION` — **the age of majority to apply,
and whether it varies by jurisdiction.** No age is asserted anywhere in this
policy. *(Loop F §43 U-4.)*

**RESOLVED — accepted architecture Rev 4.3.2d.** Access is evaluated from **all
live authority relationships at the moment of the request**, each on its own
terms. One guardian's expiry does not lock the subject and does not revoke
another guardian's authority. A relationship is live only when it has begun, has
not expired and has not been revoked — all three, evaluated at read time, never
materialised by a job.

---

## 7. Consent and revocation

**Consent is one recorded thing, not a scatter of flags.**

- Every consent records **who granted it, on behalf of whom, under what
  authority, for what purpose, at which version of the text they were shown**.
  Consent to a document a person never saw is not consent.
- **Consent is not a substitute for authorization.** A live consent with no
  matching grant reaches nothing. Consent is one step in the chain, never the
  whole chain.
- **Revocation is prospective.** It stops future access. It does not reverse
  actions already taken, and it does not delete records lawfully created under
  the consent while it was live. Where an action is irreversible, that is stated
  at the moment consent is asked for — not discovered at revocation.
- **Revoking marketing consent never suppresses security or care
  notifications.** A person who opts out of promotions still gets told their
  password changed and their appointment moved.

**RESOLVED — accepted architecture Rev 4.3.2d.** Consent is one recorded thing
with a normative type × grantee × scope contract; combinations outside it are
refused at the write boundary rather than merely discouraged.

### 7.1 Recording consent belongs to each participant

**Every participant in a recorded consultation consents in their own right — the
patient, the doctor, an interpreter, an observer.**

- A doctor consenting to being recorded is **not** acting on behalf of the
  patient, and their consent is never expressed through the patient's authority.
  Recording consent is a **separate domain** from subject-authority consent,
  precisely so that it cannot be.
- **Recording requires everyone.** It starts only when every current participant
  has agreed, and **any participant withdrawing stops it immediately**.
- The patient's own consent still flows through their own authority, so a
  guardian consents for a child correctly.

> This is stated because getting it wrong is an audit trap, not just a modelling
> error: routing a doctor's consent through the patient's authority would make
> the record appear to say the **patient** consented on the doctor's behalf.

---

## 8. Who may see clinical data

| Party | Clinical access |
|---|---|
| **The owning doctor** | Full history of their own patients, across every location they practise. |
| **Another doctor** | **Nothing**, including at a shared location. Only an explicit consented share. |
| **Reception / location admin** | Operational only — scheduling, queue, contact details. Never notes, conditions, medications, documents or prescriptive content. Enforced at the database, not by hiding buttons. |
| **Medical students** | No independent clinical authority. |
| **Platform owner** | **Nothing.** See §8.1. |
| **Platform staff** — all nine roles: admin, moderator, moderation supervisor, support, credential verifier, finance operator, advisory editor, source steward, **platform analyst** | **Nothing**, by virtue of role. See §8.1. |
| **Owner Control Center** | **Nothing.** It reports counts and cost from the control plane; it holds no read on any clinical record. See §8.2. |
| **AI / service agents** | **Nothing** by default. See [AI Governance](policy/ai-service-agent-governance.md). |
| **The person themselves** | Their own subject identity, their own vault, and whatever a doctor has shared with them. Not the doctor's private clinical notes by default. |

### 8.1 The platform owner is not a clinical superuser

**Being the owner of Doctor's Diary confers no clinical read access. There is no
"break glass", no support override, and no administrative view of patient
records.**

Equally: **platform staff cannot access clinical data merely because their
operational role requires them to do something else.** A support agent
troubleshooting a booking, a moderator reviewing a post, a finance operator
reconciling a payment and a credential verifier checking a registration number
all reach **no clinical data**. A finance operator can see *that* a consultation
on the 3rd was paid; not who it was with medically, what was prescribed, or why.

If genuine clinical support access is ever required, it is a **new, separately
approved, consented, time-bounded and audited mechanism** — not an extension of
an existing role. It does not exist today, and this policy does not promise it
ever will.

**Doctor-as-patient.** A doctor who becomes another doctor's patient is a patient
in that record and nothing else. Their own professional capability gives them no
access to it; they see their own care the way any person does. The fact that a
patient is themselves a doctor is not visible from the clinical record.

See [Platform Role Governance](policy/platform-role-governance.md) for the full
role model, including the rule that **roles do not nest**.

### 8.2 The Owner Control Center reports without reading

Doctor's Diary runs a private control centre for the owner: how many doctors are
registered and active, how many consultations, prescriptions and appointments
happened, which features are used, what AI and transcription cost, and whether
the platform is healthy.

> **It reports on a clinical estate it is structurally forbidden to read.**

- Counts cross the boundary **as counts**, produced on the clinical side. The
  control plane reads counters, never records. "Fewer columns" is not the
  control — a party that can count rows can filter rows, and a filter is an
  oracle.
- **Owner drill-down is usage and cost drill-down.** It is never patient-record
  browsing, and there is no path from a number to the people behind it.
- Reporting dimensions are an **allowlist**. No clinical value — no diagnosis,
  medicine, document type or inferred condition — is ever a dimension.
- A defective control-centre query **fails rather than discloses**, because the
  machinery behind it holds no permission on any clinical table to begin with.

**This is a standing architectural invariant in the accepted design, not a
configuration choice**, and it applies to the owner exactly as it applies to
everyone else. Analytics is not an exception to §8.1; it is the case §8.1 is
most often asked to bend for.

---

## 9. Subscription lapse must not destroy clinical records

**A lapsed, cancelled, downgraded or unpaid subscription must never silently
destroy, delete or make permanently unreachable a doctor's clinical records.**

- Commercial state is **not** clinical authority. Non-payment may restrict
  *features*; it must not erase *history*.
- A doctor whose subscription lapses retains, at minimum, the ability to
  **read and export their own existing clinical records**.
- Any restriction applied on lapse must be **announced in advance, reversible on
  payment, and never destructive**.

`PENDING OWNER DECISION` — which features are restricted on lapse, the notice
period before any restriction, and how long read/export access persists.
**No duration is asserted here.**

---

## 10. Account closure must not destroy clinical records

**Closing an account is not a delete instruction for clinical records.**

- A doctor closing their account does not trigger destruction of the clinical
  records they created and remain professionally responsible for.
- A person closing their platform account does not delete the clinical records
  their doctors hold about them. Those records are the doctors' — and are subject
  to professional record-keeping obligations, not to a platform button.
- Closure must be preceded by a clear statement of what will and will not be
  removed, and by an opportunity to export.
- **What closure does end** is access, authentication, notifications and
  commercial relationship.

`PENDING OWNER + LEGAL/REGULATORY DECISION` — what is deleted on closure, what is
retained, for how long, and under what lawful basis. **No retention period is
asserted here.**

### 10.1 The current environment, and what happens to it

Stated plainly because this policy would otherwise imply obligations that do not
apply to the data that exists today.

| | |
|---|---|
| **What exists now** | Development/test records only — doctors, patients, encounters, prescriptions, appointments, chambers and assets, all created for testing, by owner attestation |
| **Preservation required** | **None of it.** No clinical history in the current environment is real patient history, so **no clinical-data migration is required** |
| **What must survive** | **The owner's control-plane identity**, and only that. Its authentication account and profile are preserved or re-established; its **test doctor profile and entire clinical subtree are not** |
| **What the owner identity becomes** | The designated `PLATFORM_OWNER` account — a **control-plane** authority that confers **no clinical access** (§8.1) |

> **Identity survives; clinical state does not.** This is a deliberate,
> selective cut, and it is only expressible because a login and a professional
> identity are separate structures (§4): discarding the professional identity
> discards its clinical subtree by construction, while the login is untouched
> because nothing clinical ever pointed at it.

### 10.2 Nothing may be destroyed yet

> ⛔ **Reset, cleanup, authentication deletion and storage deletion are
> PROHIBITED.**

Removing the test estate is a **destructive operation**, and destructive
operations are gated on a rehearsed, restorable backup. **That gate has been
attempted and it FAILED (G-3 / G3-C):** no restorable database dump was
produced, **storage byte backup was 0 of 40 objects**, no isolated restore target
was available, and — most directly — **restoring the owner's authentication
identity could not be proven.**

**The determination in §10.1 does not relieve that gate.** "Nothing needs
preserving, so why back up?" is the wrong question. A backup makes the
*operation* reversible: a half-completed cleanup leaves an environment that is
neither the old shape nor the new one, and the failed rehearsal could not
demonstrate recovering **precisely the one identity §10.1 requires to survive.**

Architecture acceptance does not lift this. Neither does owner attestation. Only
a rehearsed restore that actually worked does.

---

## 11. Retention, correction and the absence of hard delete

### 11.1 No hard delete of clinical records

**Clinical records are not hard-deleted by the application.** Removal from the
working record is an **archive** — a recorded state change with an actor, a
timestamp and a reason — and it is reversible. The row and any stored file
survive.

A hard delete of clinical data happens only under a **separately approved lawful
process** with its own authorization, its own audit and its own human decision.
No user-facing control performs one, and no role possesses one today.

### 11.2 Finalised records are corrected, never rewritten

A finalised prescription is immutable. An error is fixed by issuing a
**correction that supersedes it**, with lineage linking the two, so the record
shows both what was issued and what replaced it. The signature and the approved
content are frozen at finalisation.

Full lifecycle rules: [Clinical Record Lifecycle](policy/clinical-record-lifecycle.md).

### 11.3 Correction requests

A person may ask for correction of factual identity data (name, date of birth,
contact details). **Clinical content is the doctor's professional record**: a
request for clinical correction goes to the treating doctor, who decides
clinically and, where a change is warranted, records it as a correction with
history — never as a silent overwrite.

`PENDING OWNER + LEGAL/REGULATORY DECISION` — the correction request process,
response time, escalation route, and what happens when a doctor declines.

### 11.4 Retention periods

`PENDING OWNER + LEGAL/REGULATORY DECISION` — **every retention duration in this
system.** This includes clinical records, finalised prescriptions, clinical
documents, audit events, notification delivery records, support conversations,
and payment records.

**No retention period is stated anywhere in this policy, deliberately.** Medical
record retention is a statutory and professional question in each jurisdiction,
and inventing a number here would be worse than leaving it open — it would be
quoted back as a commitment. *(Loop F §43 U-6 records the same dependency.)*

---

## 12. The doctor's right to export

**A doctor may export their own clinical records.**

- Export covers the records the doctor owns: patients, encounters,
  prescriptions, documents and history.
- Export must remain available on subscription lapse (§9) and must be offered
  before account closure (§10).
- **Export is a durable right of ownership, not a feature of an active
  subscription or of a currently-valid credential.** A doctor whose registration
  has expired still owns the history they created — what expires is the authority
  to make *new* clinical entries, not the ability to read and export the old ones.
  **This is settled in the accepted architecture (Rev 4.3.2d):** custodial
  authority — "are these your records?" — is durable and survives suspension and
  credential expiry; practice authority — "may you practise right now?" — is
  required only for new and mutating clinical acts. A clinical read of one's own
  records is never capability-gated.

`PENDING OWNER DECISION` — export format, delivery mechanism, completeness
guarantee, and whether a patient-facing export of their own vault is offered in
the same release.

---

## 13. Where data is stored

Data is held on Supabase infrastructure, with row-level security applied **at the
database**, so that a defect in the application cannot by itself expose another
doctor's records. Files are held in private storage and served only through
short-lived links that are minted after an authorization check — a storage path
is never itself permission to read.

### 13.1 Hosting jurisdiction

`PENDING TECHNICAL VERIFICATION AND DEPLOYMENT DECISION` — **no hosting
jurisdiction is claimed in this policy.**

Two separate reasons, and both must be closed before any claim is made:

**1. The environment observed is not the environment that will hold real data.**
The only project that exists today is the **development/test** one. The accepted
architecture calls for V2 to be stood up in an **isolated project**, and which
region that project is created in is a **deployment decision that has not been
made**. A statement about today's endpoint would therefore describe an
environment that real patient data will never live in.

**2. What was observed is an endpoint, not a residency fact.** The development
project's database connection endpoint resolves to
`aws-0-ap-northeast-2.pooler.supabase.com`, and `ap-northeast-2` is AWS's Seoul
region. That is an observation about where a **connection** terminates. It is
not a verified statement about where data resides, and it says nothing about
replicas or backups.

Until an isolated V2 project exists **and** its region, replication and backup
locations are confirmed from the project's own configuration, this policy states
no country, no region and no data-residency guarantee.

### 13.1a Geography is configuration, not architecture

Doctor's Diary is **not architecturally a Bangladeshi product**. Country, region
hierarchy, timezone, currency, phone format and the applicable regulator are
**configuration values resolved per market**, not assumptions baked into the
system.

Bangladesh, BMDC, DGDA and BDT are **seed data** — the first market's values —
and the accepted architecture verifies that none of them is hardcoded anywhere.
A doctor practising in another country is a configuration question, not a
redesign.

**Why this belongs in a data policy.** A hardcoded timezone silently misfiles
which clinical *day* an event belongs to, and a hardcoded regulator implies a
credential means something it does not. Both are accuracy problems in a clinical
record before they are internationalisation problems.

### 13.2 No unsupported legal or regulatory claims

This policy makes **no** claim of compliance, certification, accreditation or
regulatory approval — no HIPAA, no GDPR adequacy, no DGDA endorsement, no ISO
certification, no data-processing agreement. None of those is in place.

Where a regulatory obligation may exist, it is marked pending. Asserting
compliance that has not been established would be a more serious failure than
admitting the gap.

---

## 14. Artificial intelligence

- AI is **off by default** and requires explicit opt-in.
- **AI output is a draft.** AI may propose; only a doctor may accept. AI has no
  write access to clinical tables — a database-level restriction, not a prompt
  instruction.
- AI never finalises a prescription or takes an authoritative clinical action.
- Voice transcription is **draft input**, never a clinical record in itself.
- Patient records are never sent wholesale to a provider. Only a restricted,
  purpose-built subset is sent, and every disclosure is logged.
- Safety warnings are produced by **deterministic rules over the doctor's own
  data**, never generated by AI. AI may explain a warning; it may never raise one.
- **Support and moderation AI reach no clinical data.**

Full rules: [AI / Service-Agent Governance](policy/ai-service-agent-governance.md).

---

## 15. Audit

Two separate histories are kept, permanently, and they are not merged:

- **Operational audit** — who did what, when, from where. Readable by defined
  platform roles. Carries identifiers, action names and field *names*.
  **It never carries clinical values.**
- **Clinical history** — how a record became what it is. Carries clinical detail
  freely, and is readable only by the owning doctor.

The split exists precisely because operational audit is readable by people who
must never see clinical content.

---

## 16. Accuracy and professional responsibility

Doctor's Diary records what the doctor enters. Clinical decisions, and
responsibility for them, remain the doctor's.

A professional registration number displayed in the app is **self-entered and
unverified** unless it has been through an explicit verification process, and the
app must show which of those two states applies rather than implying the stronger
one.

---

## 17. Current limitations — read before any real use

- The system runs on **free development infrastructure not approved for real
  patient data or commercial clinical use**.
- Retention, account closure, correction process and hosting jurisdiction are
  **not finalised**.
- There is **no signed data-processing agreement** in place.
- The database architecture is undergoing a V2 correction pass and the
  implementation gate is **closed**.
- Pilot use with real patients is **not authorized by this document**. See
  [Pilot Operations](policy/pilot-operations.md) for the distinction between
  documentation readiness and launch authorization.

---

## 18. Contact

`PENDING OWNER DECISION` — a named contact for data questions, correction
requests and incident reports must be published here before any real clinical
use. This is not a placeholder that can survive launch.

---

## Open decisions carried by this policy

| Ref | Decision | Owner |
|---|---|---|
| DP-1 | Every retention duration (§11.4) | Owner + legal/regulatory |
| DP-2 | Account closure: what is deleted vs retained (§10) | Owner + legal/regulatory |
| DP-3 | Correction request process and escalation (§11.3) | Owner + legal/regulatory |
| DP-4 | Age of majority / guardian expiry (§6) | Owner + legal/regulatory |
| DP-5 | Subscription-lapse restrictions and notice (§9) | Owner |
| DP-6 | Export format, scope and delivery (§12) | Owner |
| DP-7 | Hosting jurisdiction — verify before claiming (§13.1) | Technical verification |
| DP-8 | Whether de-identified/aggregate use is ever contemplated (§3.1) | Owner |
| DP-9 | Published data contact (§18) | Owner |
| DP-10 | Consent matrix shape (§7) | Loop F + C2 |
| DP-11 | Guardian-expiry evaluation (§6) | Loop F + C2 |
| DP-12 | Durable owner read/export vs current mutation authority (§12) | Loop F + C2 |
