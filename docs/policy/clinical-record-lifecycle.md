# Clinical Record Lifecycle Policy

> **STATUS: DRAFT · Loop D · 2026-09-02.** Lifecycle principles. **No retention
> period is invented anywhere in this document** — every duration is
> `PENDING OWNER + LEGAL/REGULATORY DECISION`.

---

## 1. The three principles

> **P1 — A clinical record is evidence.** It records what a clinician knew and
> decided at a moment in time. Its value depends on still being true about that
> moment later.

> **P2 — Nothing is silently rewritten.** A record changes by producing a new,
> linked state that supersedes the old. Both remain readable, and the record
> shows the change happened.

> **P3 — Authority to act now is separate from authority over what happened
> then.** Losing the ability to write is not losing the record.

---

## 2. States

| State | Meaning | Who may change it |
|---|---|---|
| **Draft** | Being composed. Not clinically issued. Nobody is acting on it | Owning doctor |
| **Reviewed** | Presented in full for approval; content pinned for the decision | Owning doctor |
| **Finalized** | Issued. **Immutable** | Nobody |
| **Corrected / replaced** | Superseded by a linked successor; both survive | New correction only |
| **Archived** | Removed from the working record; retained, reversible, reasoned | Owning doctor |
| **Restored** | Returned to the working record from archive | Owning doctor |
| **Exported** | Copied out. Not a state change — the record is unaffected | Owning doctor |

### 2.1 Draft

A draft is not a clinical statement. It may be edited freely, and it must be
clearly distinguishable in the interface from something issued — a draft that
looks finalised is a clinical safety problem.

- AI and voice output enters here and **only** here. Both are draft input.
- A draft is never presented to a patient as a clinical document.
- Concurrent editing is resolved by **refusing the stale write**, never by
  merging or last-write-wins. A refused save leaves the doctor's typed text in
  their hands; a merged one silently discards one of two clinical intents.

### 2.2 Reviewed

Review is the moment a human takes responsibility.

> **Whatever a doctor approves must contain everything that will be issued —
> including the date it is measured against and the identity of every asset that
> appears on it.**

A value computed from anything outside the reviewed bundle is a value nobody
approved. This is not theoretical: a review that took the date from the clock
instead of the record would age a patient by a year when reprinted a year later.
Any asset that appears on the issued document (a signature, a logo) must be
**frozen before the review that approves it** — otherwise one document is
approved and a different one becomes permanent.

### 2.3 Finalized

**A finalized clinical record is immutable. There is no edit path, for anyone,
including the owning doctor, the platform owner and the database administrator.**

- Content is frozen at finalisation, together with the identity of everything
  printed on it.
- The signature is **frozen as a copy**, not referenced live — a doctor may
  change their signature tomorrow, and a document issued today must not change
  with it.
- Reference data changing later must not alter the meaning of a frozen record. A
  prescription printed today says what it said today, even if a medicine is
  delisted next year.

### 2.4 Corrected / replaced

An error in a finalized record is fixed by **issuing a correction that supersedes
it**, never by editing.

- Both versions survive and are readable.
- The relationship is explicit: the record shows what replaced what.
- The **reason is clinical reasoning** and lives with the clinical record, not in
  an operational log readable by non-clinical roles.
- The interface must make it unmistakable which version is current and which is
  superseded — a patient may be holding the old paper.

### 2.5 Archived

**Archive is the only removal the product has.** It is:

- **recorded** — actor, timestamp and a **required reason**;
- **reversible** — restore exists;
- **non-destructive** — the record and any stored file survive;
- **visible** — an archived record is not pretended out of existence; it leaves
  the working list and remains reachable deliberately.

An archived clinical record is **excluded from clinical history views**, because
a removed report sitting in a timeline reads as a current one.

### 2.6 Restored

Restore is the counterpart that makes archive safe to reach for. It is audited
the same way.

### 2.7 Exported

Export copies; it changes nothing. An export is itself a disclosure and is
audited as one.

---

## 3. No hard delete

> **The application performs no hard delete of clinical records. No user-facing
> control does it, and no role possesses it.**

A lawful destruction — if such a process is ever established — is a **separately
approved process** with its own authorization, a second human, its own audit and
its own legal basis. It is not a feature.

**Stored files are not deleted on archive.** The one deletion the system attempts
at all is cleanup of an orphaned upload whose metadata write failed — and it
verifies the deletion actually happened rather than assuming, because a storage
delete refused by policy removes nothing and reports no error.

`PENDING OWNER + LEGAL/REGULATORY DECISION` — whether a lawful deletion process
is established at all, and if so its basis, authority and evidence requirements.

---

## 4. Actor lifecycle events

The rule for every event in this section:

> **Historical clinical ownership survives. Current mutation authority may be
> restricted separately.**

Read and export authority over records a doctor **already created** is durable.
It attaches to the fact that they created them, not to a currently valid
subscription or credential.

`PENDING LOOP F + C2 ARCHITECTURE ACCEPTANCE` — the mechanism separating durable
owner read/export authority from current verified mutation authority.
*(C2 RT-CORR-03 identifies this as a required correction.)*

### 4.1 Doctor account closure

| | |
|---|---|
| **Ends** | Login, notifications, commercial relationship, new clinical writes |
| **Does NOT end** | Existence of the clinical records created |
| **Required first** | Clear statement of what will and will not be removed; an opportunity to export |
| **Never** | Silent destruction of clinical records |

`PENDING OWNER + LEGAL/REGULATORY DECISION` — retention of the records after
closure, and who is accountable for them.

### 4.2 Doctor suspension

| | |
|---|---|
| **Ends** | New clinical writes; finalisation; public visibility; new bookings |
| **Retains** | Read and export of their own historical records |
| **Never** | Deletion; transfer of records to another party |

Suspension is a **restriction on acting**, not a confiscation of history.
Patients with existing appointments must be handled explicitly, not left silently
booked.

`PENDING OWNER DECISION` — patient communication on suspension.

### 4.3 Credential expiry

| | |
|---|---|
| **Ends** | Authority to create new clinical entries and finalise |
| **Retains** | Read and export of historical records |
| **Never** | Retroactive invalidation of records made while the credential was valid |

**A prescription finalised while a registration was valid stays valid.** Expiry
is not retroactive, and the record must not later imply the doctor was
unregistered at the time.

`PENDING OWNER + LEGAL/REGULATORY DECISION` — grace period, renewal handling, and
whether expiry is announced to patients with future appointments.

### 4.4 Subscription expiry

| | |
|---|---|
| **Ends** | Paid features |
| **Retains** | **Read and export of clinical records — at minimum** |
| **Never** | Deletion, destruction, or permanent inaccessibility of clinical records |

> **Commercial state is never clinical authority.** Payment does not create
> clinical rights and non-payment does not destroy clinical evidence.

`PENDING OWNER DECISION` — which features are restricted, the notice period, and
how long read/export persists.

### 4.5 Guardian change or revocation

| | |
|---|---|
| **Ends** | That guardian's future access |
| **Does NOT end** | The subject's own access; another valid guardian's access; anything a doctor already imported under a live grant |
| **Never** | Retroactive removal of clinical records created while access was live |

**One relationship ending must not lock the subject.** Access is evaluated from
all live relationships at the time of the request.

Consents granted under a guardianship **remain attributable to that guardianship**
after it ends — a consent must not become anonymous because the authority behind
it lapsed.

`PENDING LOOP F + C2 ARCHITECTURE ACCEPTANCE` — expiry evaluation (RT-CORR-04).
`PENDING OWNER + LEGAL/REGULATORY DECISION` — age of majority.

### 4.6 Practice closure

| | |
|---|---|
| **Ends** | Booking at that location; staff access there |
| **Does NOT end** | The doctor's records of care given there |
| **Never** | Transfer of clinical records to the location, its owner, or the organization |

Locations are **deactivated, not removed** — history refers to them and must keep
resolving. **An organization never owns clinical data**, and closing one changes
nothing about who does.

---

## 5. What must survive every event above

| Must survive | Why |
|---|---|
| Finalized prescription content | It was issued and may be in a patient's hands |
| The frozen signature and approved content | It attests to what was approved |
| Correction lineage | Both versions must remain readable |
| Clinical documents already imported into a record | The doctor relied on them and is responsible for them |
| Clinical event history | How a record became what it is |
| Operational audit | Evidence of who did what |
| The doctor's read and export of their own history | Ownership is durable |

---

## 6. Boundaries this policy does not cross

- It defines **no retention duration**.
- It asserts **no statutory obligation**.
- It does not decide whether lawful deletion exists.
- It does not define tables, states-in-schema, policies or grants.
- It does not resolve the durable-authority mechanism (RT-CORR-03).

---

## Open decisions

| Ref | Decision | Owner |
|---|---|---|
| CRL-1 | Every retention duration | Owner + legal/regulatory |
| CRL-2 | Whether lawful hard deletion exists, and its process | Owner + legal/regulatory |
| CRL-3 | Post-closure record custody and accountability | Owner + legal/regulatory |
| CRL-4 | Credential grace period and patient communication | Owner + legal/regulatory |
| CRL-5 | Subscription-lapse restrictions and notice period | Owner |
| CRL-6 | Age of majority / guardian expiry | Owner + legal/regulatory |
| CRL-7 | Durable read/export vs current mutation authority | Loop F + C2 (RT-CORR-03) |
| CRL-8 | Guardian-expiry evaluation | Loop F + C2 (RT-CORR-04) |
