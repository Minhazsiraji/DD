# Architecture & Security Glossary

> **STATUS: DRAFT · Loop D · reconciled 2026-09-03 against accepted Database V2
> architecture Rev 4.3.2d.** One consistent vocabulary across policy,
> architecture, product and review.
>
> **Terminology source of truth.** Where a term names a V2 structure, this
> glossary follows the Loop F Database V2 architecture document and **introduces
> no alternative name**. Terms marked **[V2 ACCEPTED]** are part of the finally
> accepted architecture — **accepted as a design; no implementation exists yet.**
> Terms marked **[V1 CURRENT]** exist in the shipped system today.
>
> **If Loop F changes a name, this file follows it.** This document never
> overrides the architecture lane.

---

## How to read the markers

| Marker | Meaning |
|---|---|
| **[V1 CURRENT]** | Exists in the shipped system today |
| **[V2 ACCEPTED]** | Part of the accepted architecture (Rev 4.3.2d). **A design, not an implementation** |
| **[CONCEPT]** | A policy/product idea, not a named structure |
| **[PENDING]** | Named, but its shape is an open decision |

---

## Identity

### Profile / auth user **[V1 CURRENT]**
A login — one authenticated account belonging to one human. It carries no
persona: being signed in says nothing about whether you are a doctor, a patient,
a guardian or a receptionist.

> **A login is not a role and never implies one.**

### Professional profile **[V2 ACCEPTED]**
The professional extension of a person: qualifications, registration,
specialty, and the identity under which clinical records are owned. It replaces
what V1 calls the doctor profile, because a medical student — and later other
professions — need the same extension and none of them is a doctor.

> **[V1 CURRENT]** the equivalent is `doctor_profiles`. The ownership column
> stays `owner_doctor_id` in both, because it names a *role in a relationship* —
> "the doctor who owns this clinical record" — which remains true.

### Doctor capability **[V2 ACCEPTED]**
The resolved answer to "may this person act clinically as a doctor, now?"

Distinct from **having a professional profile** (an identity) and from **holding
a role** (a job). A capability is derived from verified credential state, not
claimed, and not implied by a route or a screen existing.

> **[V1 CURRENT]** `current_doctor_id()` is the legacy clinical-authority gate.
> It proves something narrower: *the authenticated account has an applicable
> doctor profile.* It does **not** prove verified registration and is not a
> capability system. Do not describe it as credential-gated.

### Health subject **[V2 ACCEPTED]**
A real human being as the platform knows them — so they can book, belong to a
family, and hold their own documents.

> **A health subject is not a clinical record.** It holds identity, not a chart.

### Clinical patient **[V2 ACCEPTED]**
**One doctor's clinical record about one person.** Owned by that doctor.

The same human seen by two doctors is **two clinical patients** that share
nothing. There is no query in the product that returns both.

> **[V1 CURRENT]** the table is `patients`. **[V2 ACCEPTED]**
> `clinical_patients` — because in V2 four different things could answer to
> "patient" (the subject, the login, the clinical record, the booking party) and
> the clinical table must stop claiming the bare word.

### `patient_subject_link` **[V2 ACCEPTED]**
The record that a doctor's clinical patient refers to a particular health
subject. It answers *who this person is* for booking and family purposes.

> **It is never an authorization path.** It must not appear in any rule deciding
> whether a doctor may read a clinical record. Joining authorization onto it is
> exactly how one doctor's records become reachable from another's.

### DD Patient Number **[V2 ACCEPTED]**
A durable, human-quotable identifier for a **health subject** — the person, not
the practice's record of them.

> **The DD number is never authorization.** Knowing it grants nothing, anywhere:
> not in support, not in booking, not in clinical access. It is an identifier for
> saying "this person", never a key for reading about them.

Distinct from the per-doctor patient number **[V1 CURRENT]**, which is a
doctor's own sequence for their own records.

**Format, checksum and entropy are settled** in the accepted architecture. The
checksum is DD's own formally specified construction — deliberately **not**
claimed as a published standard. Demonstrating its error-detection properties
remains a technical proof gate before implementation.

### Health subject vs clinical patient — the distinction in one line
> **The health subject is the person. The clinical patient is one doctor's record
> about that person. There are as many clinical patients as there are doctors
> treating them, and exactly one subject.**

---

## Documents

### Personal health vault **[V2 ACCEPTED]**
The person's own store of their own health documents. Owned by the **health
subject**. A doctor reads an item only through an explicit, live, scoped share.

> **Vault contents are never a clinical record.** They carry no diagnosis and are
> not clinical truth. A doctor takes responsibility by importing.

### Clinical document **[V1 CURRENT]**
A patient-scoped clinical asset inside one doctor's repository — a lab report, a
scan, a discharge summary. Owned by the doctor.

> Not a shared drive. Every clinical document is anchored to exactly one clinical
> patient, and the patient carries the authority.

### Import **[CONCEPT]**
A doctor copying a shared vault document into their clinical record. **A copy,
never a reference** — with provenance and a content fingerprint.

> **A one-way door.** Later revocation of the share stops future vault access and
> does not touch the import.

See [Vault vs Clinical Documents](policy/personal-vault-and-clinical-documents.md).

---

## Practice

### Practice **[CONCEPT]**
A doctor's professional activity — the thing that travels with them across
places.

### Practice location **[V1 CURRENT]**
**Where care happened.** A chamber, clinic, hospital or telemedicine context.

> **A location is an attribute of an event, never an owner of records.** Practice
> locations are not facilities in an ownership sense, and staff access is scoped
> to one.

### Organization **[V2 ACCEPTED]**
A body operating one or more branches — a hospital group, a chain.

> **An organization never owns clinical data.** It may administer branches, staff
> and operational configuration. It never becomes the controller of a doctor's
> records, and its administrators reach no clinical content.

---

## Booking and consultation

### Appointment **[V1 CURRENT]**
A scheduled intention to be seen: a patient, a doctor, a location, a time.
**Operational, not clinical** — readable by reception, which is why no clinical
asset hangs off it.

### Booking serial **[V1 CURRENT]**
The number identifying a booking in the booking flow. **Not** a queue position.

### Queue token **[V1 CURRENT]**
The position in the live waiting room on the day.

> **Booking serial ≠ queue token.** Two identifiers, two lifecycles. Booking
> third does not mean being seen third; arrival, priority and walk-ins change the
> order, and conflating them tells a patient a time that is not true.

### Encounter **[V1 CURRENT]**
**One consultation episode: one patient, one doctor, one location, one occasion.**

Deliberately not hung off the appointment — a consultation can happen with no
appointment, and the appointment row is readable by reception, who must never see
clinical content.

### Prescription draft **[V1 CURRENT]**
A prescription being composed. Not issued, not signed, nobody is acting on it.
Freely editable, and clearly distinguishable from something issued.

### Finalized prescription **[V1 CURRENT]**
An issued prescription. **Immutable** — no edit path exists for anyone, including
the owning doctor and the platform owner. Content and every asset printed on it
are frozen at finalisation.

### Correction / replacement **[V1 CURRENT]**
The only way to change a finalized record: issue a **new** record that supersedes
the old, with explicit lineage. Both survive and remain readable.

> **Never a silent rewrite.** A patient may be holding the superseded paper.

### Frozen signature / review digest **[V1 CURRENT]**
The signature is **copied and frozen** at finalisation, not referenced live — a
doctor may change their signature tomorrow, and a document issued today must not
change with it. The digest covers everything approved, so what was reviewed is
provably what was issued.

> **Freezing happens before the review that approves it.** Approving one document
> while a different one becomes permanent is not approval.

---

## Roles and actors

### Platform role **[V2 ACCEPTED]**
An explicitly granted staff authority. **There are nine:** platform admin,
community moderator, moderation supervisor, support agent, credential verifier,
finance operator, health advisory editor, public health source steward and
platform analyst.

> **Roles do not nest.** No role implies another. Holding a senior role never
> confers a specialist one.

> **No platform role grants clinical access.** Not one, including the owner's.

### PLATFORM_OWNER **[V2 ACCEPTED]**
The designated account with ultimate accountability for the platform.

> **Not a role, and not a tenth entry in the inventory.** It confers nothing on
> its own: the owner acts only through roles explicitly granted to them, each
> appearing in the record first. **Not a clinical superuser** — there is no
> break-glass.

### PLATFORM_ANALYST **[V2 ACCEPTED]**
The role that reads the Owner Control Center.

> **Aggregate control-plane data only.** It reads counters and cost, never
> clinical records. Owner drill-down is usage and cost drill-down — never
> patient-record browsing.

See [Platform Role Governance](policy/platform-role-governance.md).

### Service agent **[V2 ACCEPTED]**
An automated actor — a classifier, a support assistant, a drafter.

> **Not a user and not staff.** It holds no human account and no staff role, so
> every rule written as "the signed-in person" excludes it structurally. Its
> authority is an enumerated minimum-scope allowlist, and it never holds an
> ambient bypass credential.

See [AI / Service-Agent Governance](policy/ai-service-agent-governance.md).

---

## History

### Operational audit **[V1 CURRENT]**
"Who did what, when, from where." Readable by defined platform roles.

> **Carries identifiers, action names and field NAMES — never clinical values.**
> Precisely because roles that must never see clinical content can read it.

Append-only. Not editable by anyone, including the owner.

### Clinical event history **[V1 CURRENT]**
"How this record became what it is." Carries clinical detail freely, readable
**only by the owning doctor**.

> **Two histories, permanently separate.** Getting them backwards is how clinical
> text leaks into an administratively readable log.

---

## Permission

### Consent **[V2 ACCEPTED]**
A recorded agreement: **who granted it, on behalf of whom, under what authority,
for what purpose, at which version of the text they were shown.**

> **Consent is not authorization.** It is one step in the chain. A live consent
> with no matching grant reaches nothing.

> **Revocation is prospective.** It stops future access; it does not reverse what
> was lawfully done while it was live.

A **normative type × grantee × scope contract** is part of the accepted
architecture; combinations outside it are refused at the write boundary.

> **Recording consent is a separate domain.** A doctor, interpreter or observer
> consents to being recorded **in their own right** — never through the
> patient's authority.

### Access grant **[V2 ACCEPTED]**
The live, revocable, scoped permission that actually admits a read — the thing
consent authorises the creation of.

> **A grant is evaluated live, at the moment of access.** Not cached, not implied
> by an earlier grant, not inferred from a relationship.

A grant scoped to one visit is satisfied only inside an **established clinical
scope** — a context the system verifies, never one the caller asserts by naming
an appointment. It closes when the visit ends.

### Storage path **[V1 CURRENT]**
Where a stored file lives.

> **A path is never authorization.** Knowing it grants nothing. Every read
> resolves the object back to its record and re-evaluates permission.

### Signed URL **[V1 CURRENT]**
A short-lived link minted **after** an authorization check.

> **A signed link is the result of authorization, never a substitute for it.**
> It is a bearer token once issued — which is why it is short-lived, never
> stored, never logged and never embedded in an export.

---

## Terms deliberately not defined here

| Term | Why |
|---|---|
| Capability projection, RLS predicate, composite tenant FK | Implementation vocabulary — Loop F's lane |
| Break-glass, superuser, clinical override | **No such concept exists.** Naming one invites building it |
| Anonymised clinical data | Not a category in this system today (Data Policy §3.1) |
| Care team, shared record, cross-doctor view | **Do not exist.** This product has no ambient sharing rule |
| Patient portal | Not built. The vault is not a portal |

---

## Consistency rules

1. **Never write "patient" alone** where the health subject and the clinical
   patient could both be meant.
2. **Never write "doctor" alone** where the profile, professional profile and
   capability could be meant.
3. **Never call a location an owner** of anything clinical.
4. **Never call a signed URL, storage path or DD number an authorization.**
5. **Never introduce a synonym.** If a better name exists, change it in Loop F's
   document first and follow it here.

---

## Open decisions

| Ref | Decision | Owner |
|---|---|---|
| GL-1 | Final V2 table names | Loop F + C2 |
| GL-2 | DD Patient Number format and checksum | Loop F + C2 (RT-CORR-01) |
| GL-3 | Capability semantics — durable vs current authority | Loop F + C2 (RT-CORR-03) |
| GL-4 | Consent matrix | Loop F + C2 (RT-CORR-06) |
| GL-5 | Access grant scoping | Loop F + C2 (RT-CORR-05) |
| GL-6 | Whether `PRACTICE_MANAGER` exists in the baseline | Loop F (§43 U-3) |
