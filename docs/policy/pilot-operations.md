# Friendly Doctor Pilot — Operational Documentation

> ## ⛔ THIS DOCUMENT DOES NOT AUTHORIZE A PILOT
>
> **Documentation readiness ≠ launch authorization.** This document being complete
> means the *paperwork* exists. It does not mean a pilot may start.
>
> **Real-patient use is NOT authorized.** Updated 2026-09-03.
>
> **What changed:** the Database V2 architecture is now independently and finally
> accepted — **Rev 4.3.2d · C2 FINAL: A. ✅ ARCHITECTURE ACCEPTED FOR ISOLATED V2
> IMPLEMENTATION.** The correction pass is complete and has passed C2 re-review.
>
> **What that does NOT change — three separate gates, and only the first has
> moved:**
>
> | Gate | State |
> |---|---|
> | **Architecture accepted** | ✅ **YES** — for **isolated** V2 implementation |
> | **Destructive operations** (reset, cleanup, auth or storage deletion) | ⛔ **PROHIBITED.** G-3 = **FAIL (G3-C)**: no restorable backup, storage byte backup **0 of 40**, and owner-identity restore **unproven** |
> | **Real-patient use** | ⛔ **NOT AUTHORIZED** |
>
> Still unresolved for real-patient use:
> - **no V2 implementation exists yet** — acceptance authorizes building it, and
>   nothing has been built;
> - `docs/data-policy.md` remains a **draft**: retention, account closure,
>   correction process, hosting jurisdiction and the published data contact are
>   all open;
> - the platform runs on **free development infrastructure not approved for real
>   patient data or commercial clinical use**;
> - there is **no signed data-processing agreement**.
>
> **Until the owner records an explicit launch authorization, pilot activity is
> limited to fake data.** See §2.
>
> > **The specific misreading this block exists to prevent:** *"the architecture
> > is accepted, so we can start with real patients."* Architecture acceptance is
> > a statement that the **design** is sound. It is not an implementation, not a
> > backup, not a data policy, and not a clinical-safety approval.

---

## 1. Two separate things

| | Documentation readiness | Launch authorization |
|---|---|---|
| **What it is** | The consent wording, responsibilities, escalation and stop-use criteria exist and are reviewed | A recorded owner decision that a named doctor may use the product with real patients |
| **Who decides** | Loop D prepares; owner reviews | **Owner only**, on evidence |
| **Status** | This document | **NOT GIVEN** |
| **Evidence needed** | — | §10 |

A complete document set is a **precondition** for authorization. It is not
authorization, and it must never be quoted as one.

---

## 2. What pilot data is allowed

### 2.1 Current state — fake data only

| Allowed now | Not allowed now |
|---|---|
| Invented patients, invented histories | Any real patient's identity |
| Realistic workflows with fictional people | Any real clinical content |
| Synthetic documents and reports | A real person's photograph, report or scan |
| The doctor's own real professional details | A real prescription given to a real patient |

**A real patient's data must not be entered "just to test the flow."** Once
entered it is real clinical data under an incomplete policy, and it cannot be
made fake again.

### 2.2 If real-patient use is later authorized

The following must be true first, and each is currently unmet:

- [ ] Owner records an explicit, dated launch authorization naming the doctor
- [ ] Data policy finalised — retention, closure, correction, jurisdiction,
      contact all resolved
- [x] **Database V2 architecture accepted by C2** — Rev 4.3.2d, 2026-09-03 ✅
- [ ] V2 **implemented** in an isolated environment and its verification suite green
- [ ] Infrastructure approved for real clinical data
- [ ] Consent wording (§3) reviewed by someone qualified in Bangladeshi practice
- [ ] Export verified to actually work, end to end
- [ ] Incident contact published and reachable
- [ ] Stop-use criteria (§9) agreed with the doctor **in advance**

---

## 3. Consent and disclosure before real clinical use

`PENDING OWNER + LEGAL/REGULATORY REVIEW` — **the wording below is a
specification of what must be conveyed, not approved consent text.** It must be
reviewed by someone qualified in Bangladeshi practice before use, and translated
for patient-facing use.

### 3.1 To the pilot doctor

The doctor must acknowledge, in writing, that they understand:

1. This is **pilot software** under active development, not a finished product.
2. **They remain the treating clinician.** Every clinical decision, every
   prescription and every record is theirs. The software records; it does not
   practise.
3. **They are the controller of their patients' records** and are responsible for
   informing their patients that a digital record is kept.
4. Some features are **experimental** (§4) and may change or be withdrawn.
5. **Retention, deletion and correction processes are not finalised.**
6. **They must keep their own clinical fallback.** Software may be unavailable.
7. They will report issues (§5) rather than work around them silently.
8. They may **stop at any time**, and may request an export at any time.

### 3.2 To the patient

The patient must be told, in language they understand, before their record is
entered:

1. The doctor keeps a **digital record** of this consultation.
2. **It belongs to this doctor.** Other doctors do not see it.
3. Who else at this location can see what — reception sees scheduling and contact
   details, not clinical content.
4. That the software is **new and in a pilot**.
5. How to ask a question or request a correction — a **named, reachable contact**.
6. That they may **decline** and be treated on paper instead, with no
   disadvantage.

> **A patient who declines must actually be able to decline.** If the workflow
> makes paper impossible, consent is not being obtained — it is being assumed.

---

## 4. Feature maturity

The doctor must be told which features are which. Marking is
`PENDING OWNER CONFIRMATION` against the build actually shipped to the pilot.

| Maturity | Meaning | Doctor's obligation |
|---|---|---|
| **Stable** | Accepted, verified, unlikely to change | Normal care |
| **Experimental** | Working but under change; may be withdrawn | **Check every output** |
| **Draft-producing** | Produces drafts for review — never authoritative | **Review before accepting** |
| **Not for clinical reliance** | Present but not to be relied on | Do not use for decisions |

**Everything AI or voice touches is draft-producing**, without exception.
Transcription is draft input; a draft is not a record.

---

## 5. Issue reporting

**During a pilot session, record issues rather than fixing them.** A live change
during clinical use is a second, unreviewed change on top of the one being
tested.

**Fix live only:** a privacy breach, data loss, a prescription-safety defect, or
a login failure blocking care. Everything else is recorded and triaged after.

Each report captures: what was being done, what happened, what was expected,
when, which screen, and whether any patient record was affected. **No patient
identifiers or clinical content in a report** — reference the record, do not
reproduce it.

| Severity | Definition | Response |
|---|---|---|
| **P0** | Privacy breach, data loss, prescription-safety defect, or care blocked | **Stop use.** Escalate immediately (§8) |
| **P1** | Wrong clinical information displayed; workflow blocked with no workaround | Same day; consider stopping |
| **P2** | Wrong behaviour with a workaround | Next working session |
| **P3** | Cosmetic, wording, convenience | Backlog |

---

## 6. Correction workflow

1. **The doctor is the clinical authority.** A clinical error is corrected by the
   doctor, in the product, as a correction — never by an engineer editing data.
2. **Finalised records are never edited.** A correction supersedes, with lineage.
3. **A patient correction request** goes to the doctor. Identity data is
   corrected directly; clinical content is a clinical judgement.
4. **Engineering never edits a doctor's clinical data to fix a bug.** If a defect
   produced a wrong record, that is a P0/P1 escalation and the remedy is decided
   with the doctor, recorded, and audited — not applied quietly.

`PENDING OWNER DECISION` — the process when a defect has corrupted a clinical
record and no in-product correction can express the fix.

---

## 7. Account and security responsibilities

**The doctor's:**
- keep credentials private; the account is a clinical identity;
- enable the second factor;
- mark shared clinic computers as shared, so the shorter idle lock applies;
- never leave a session open on an unattended shared machine;
- report a suspected compromise immediately (§8);
- ensure reception accounts are individual — **never a shared desk login**, or
  the audit trail cannot say who acted.

**Doctor's Diary's:**
- keep clinical isolation enforced at the database, not the interface;
- never access clinical records for support or debugging;
- notify the doctor of any incident affecting their records, promptly and in
  writing;
- keep the audit trail append-only.

---

## 8. Incident escalation

| Step | Action |
|---|---|
| 1 | **Stop use** if the incident is P0 |
| 2 | Notify the named incident contact immediately, by the agreed channel |
| 3 | Preserve evidence — do not delete, do not "clean up" |
| 4 | Record what was affected, without reproducing clinical content |
| 5 | Owner decides whether the pilot continues (§9) |
| 6 | Written follow-up: what happened, what was affected, what changed |

`PENDING OWNER DECISION` — the named incident contact, the channel, and a
response-time commitment. **A pilot with real patients must not start without
these three.**

`PENDING OWNER + LEGAL/REGULATORY DECISION` — whether any incident requires
notification to a patient or an authority, and on what timeline.

---

## 9. Stop-use criteria

**Agreed in advance, because they are impossible to agree fairly in the middle of
an incident.**

Stop immediately, and do not resume without an owner decision, if:

1. Any patient data is visible to someone who should not see it — **especially
   another doctor**;
2. Clinical data is lost, corrupted, or silently altered;
3. A prescription prints or displays content the doctor did not approve;
4. A finalised record changes;
5. The audit trail is incomplete, wrong, or shows an unexplained privileged
   action;
6. Authentication fails in a way that blocks care, or admits the wrong person;
7. AI or voice output reaches a patient-facing document without review;
8. The doctor loses confidence in the record's accuracy.

**Resumption requires:** cause understood, fix verified, an assessment of what
was affected, and the owner's recorded decision. Not "it seems fine now."

> **Stopping is a success of the pilot, not a failure of it.** A pilot exists to
> find these conditions while the number of affected people is one.

---

## 10. Evidence needed before authorization

| Evidence | Status |
|---|---|
| Owner's recorded launch authorization | **Not given** |
| Data policy finalised | **Draft** — 12 open decisions |
| Database V2 architecture accepted | ✅ **YES** — Rev 4.3.2d, C2 FINAL A (2026-09-03) |
| V2 implemented in an isolated environment, suite green | **Not started.** Acceptance authorizes building it; nothing is built |
| Destructive operations permitted | ⛔ **NO — G-3 FAIL (G3-C).** Not required for a pilot, and listed so the two are never conflated |
| Infrastructure approved for real clinical data | **Not approved** |
| Consent wording reviewed | **Not reviewed** |
| Export verified end to end | `PENDING VERIFICATION` |
| Incident contact published | **Not published** |
| Stop-use criteria agreed with the doctor | `PENDING` |
| Doctor's written acknowledgement (§3.1) | `PENDING` |

---

## Open decisions

| Ref | Decision | Owner |
|---|---|---|
| PIL-1 | Launch authorization itself | Owner |
| PIL-2 | Consent wording — doctor and patient, reviewed and translated | Owner + legal/regulatory |
| PIL-3 | Named incident contact, channel, response time | Owner |
| PIL-4 | Breach notification obligations | Owner + legal/regulatory |
| PIL-5 | Remedy process when a defect corrupts a record | Owner |
| PIL-6 | Feature maturity marking against the shipped build | Owner |
| PIL-7 | Whether a pilot may run on current infrastructure at all | Owner |
