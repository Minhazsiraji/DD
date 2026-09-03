# Personal Health Vault / Clinical Document Policy

> **STATUS: DRAFT · Loop D · reconciled 2026-09-03 against accepted Database V2
> architecture Rev 4.3.2d.** Conceptual boundary and sharing principles. The
> scoped-share model C2 once classified a blocker is **resolved in the accepted
> architecture**; this document states the properties it delivers, and still
> specifies no table, grant or predicate — that remains Loop F's lane.

---

## 1. The boundary

> **PERSONAL HEALTH VAULT ≠ DOCTOR CLINICAL DOCUMENT REPOSITORY**

Two systems. Different owners, different lifecycles, different storage, different
authorization. A file is never in both at once — moving between them is a
**copy** with recorded provenance.

| | **Personal health vault** | **Clinical document repository** |
|---|---|---|
| **Owner** | The person (health subject) | The owning doctor |
| **What it is** | What a person collected about themselves | Clinical evidence a doctor relies on |
| **Uploaded by** | The person, or someone with a live access relationship | The doctor or their authorised staff |
| **Storage** | Its own private store | Its own private store |
| **A doctor reads it** | **Only** through an explicit, live, scoped share | Always, if they own it |
| **Removal** | The person may archive their own | Archive only, and never by the person |
| **Clinical status** | **Not a clinical record.** Not a chart, carries no diagnosis, is not clinical truth | Clinical evidence within that doctor's record |

### 1.1 Vault contents are never a clinical record

A vault holds what a person kept: a photograph of a lab slip, an old
prescription, a discharge letter. It is not a chart. Nothing in it is presented
to a doctor as clinical truth, and nothing in it acquires clinical status by
being shared.

**A doctor takes responsibility by importing it.** Until then it is a document
someone showed them.

---

## 2. Personal ownership

- The vault belongs to the **health subject**. Not to a doctor, not to a clinic,
  not to the platform.
- The subject, or someone holding a **live access relationship** to them (a
  guardian, a care manager granted by the subject), may read and add to it.
- **A label is not authority.** Being recorded as a relative grants nothing; a
  live access relationship does.
- The platform is a custodian. **Platform staff, moderators, support agents,
  finance operators, the platform owner and every service agent reach no vault
  content.**

---

## 3. Explicit sharing

> **A doctor sees a vault document only because the person deliberately shared
> that document with that doctor. There is no ambient path.**

Sharing is:

- **explicit** — a deliberate act, never inferred from booking, attendance,
  payment, family membership, or a doctor having treated the person before;
- **per-document** — sharing one document shares one document;
- **named** — granted to a specific doctor, never to "doctors" or a location;
- **scoped** — see §4;
- **time-bounded** where the person chooses;
- **revocable** — see §5;
- **recorded** — with purpose, authority and the version of the text the person
  was shown. Consent to a document a person never saw is not consent.

**Notably absent from any share evaluation:** the identity link between a person
and a doctor's clinical record, location membership, platform staff status, and
service-agent identity. None of them is a branch in the rule.

---

## 4. Appointment- and doctor-scoped sharing

A person may want to share a report **for one visit**, not forever. The policy
supports three scopes:

| Scope | Meaning |
|---|---|
| **Doctor-wide** | This doctor may read it whenever they are treating me |
| **Appointment-scoped** | Only in the context of this appointment |
| **Encounter-scoped** | Only in the context of this consultation |

> **A scope must genuinely constrain access.** A share the person believes is
> limited to one visit, but which in practice grants standing access, is worse
> than no scope at all — it is a false promise displayed at the moment of
> greatest trust.

Two rules follow, and the accepted architecture satisfies both:

1. **The acting context is established, not claimed.** Which visit a doctor is
   acting within is determined by a trusted operation that verifies it — never
   inferred from session state or a recently viewed page, and **never accepted
   simply because the caller named the right appointment.** Naming an
   appointment proves nothing: it is a value the doctor already knows, so a
   scope that accepted it would be a password, not a boundary.
2. **Absent context fails closed.** A scoped share evaluated with no established
   context is **denied**, never widened to doctor-wide.

**RESOLVED — accepted architecture Rev 4.3.2d.** An earlier design silently
converted every scoped share into a doctor-wide one; C2 classified that a
blocker. The accepted model delivers both properties above:

- **The acting context is established by a trusted operation, not asserted.** A
  doctor does not reach a scoped document by *naming* an appointment — a value
  they already know. The system establishes an active clinical scope only after
  verifying that this doctor owns that appointment or consultation **and that
  care is actually happening in it**. A scheduled-for-next-month, cancelled or
  no-show visit cannot establish a scope at all.
- **The scope ends when the visit does.** Completing or cancelling the visit
  closes it; it also expires on its own. Replaying it the next morning fails.

`PENDING OWNER DECISION` — the scope lifetime and any post-visit grace window. A
doctor writing notes twenty minutes after the patient leaves is normal; a scope
still live the next morning is not. **No duration is asserted here.**

---

## 5. Revocation

> **Revocation is prospective. It stops what has not happened yet.**

| Revocation stops | Revocation does **not** undo |
|---|---|
| Future reads of the vault document | A clinical document already imported |
| Future signed links | Actions the doctor already took in reliance on it |
| Future browsing by that doctor | The clinical record it informed |

**Future vault browsing stops when authorization is revoked** — immediately, and
including any link previously issued that has not yet expired, to the extent the
link's lifetime allows. This is why links are short-lived.

### 5.1 Why revocation cannot reach backwards

If revoking a share deleted what a doctor had already incorporated, a person
could remove clinical evidence from a record the doctor is professionally
responsible for, after the decision that relied on it.

**So this is stated plainly at the moment of sharing, not discovered at
revocation:** a doctor may keep a copy of what you share with them, and if they
do, revoking the share does not remove their copy.

---

## 6. Import — the one-way door

When a doctor incorporates a shared document into their clinical record:

- the file is **copied** into the clinical repository — never referenced across
  the boundary;
- the new clinical document records its **origin** (a vault import) so the doctor
  can see what they are looking at;
- **provenance is recorded**: which vault document, under which share, by whom,
  when;
- a **content fingerprint** is recorded, so "that is not what I sent" is
  answerable later, and so an archived source does not orphan the clinical
  evidence;
- the import is written into **clinical history** (doctor-visible) and
  **operational audit** (identifiers only).

Afterwards, permanently:

1. **Revoking the share does not touch the import.** Provenance is a record of
   how the document arrived; it is not a permission that is re-checked on every
   read.
2. **Archiving the source vault document does not archive the import.** Two
   objects, two lifecycles, by design.
3. **The imported document is a clinical record** from that point, governed by
   the [Clinical Record Lifecycle](clinical-record-lifecycle.md).

**The doctor must be able to see what they are importing before they import it** —
an import is a responsibility, and it must not be a side effect of viewing.

---

## 7. Location is never authorization

Two rules that apply to both systems, without exception:

> **7.1 — A storage path is not permission.** Knowing where an object lives
> grants nothing. Every read resolves the object back to its record and
> re-evaluates authorization. Paths are server-generated and never
> caller-chosen; a filename never selects a path, an extension, a content type,
> or anything else carrying authority.

> **7.2 — A signed link is not authorization; it is the *result* of one.** A link
> is minted only after the authorization check passes, at mint time, and it is
> short-lived precisely because it is a bearer token afterwards. A link must
> never be stored in a page that may sit open, embedded in an export, sent
> through a notification, or logged.

Neither system uses public storage. There is no listing, no public URL, and no
bucket that can be flipped public without it being a reviewable change.

---

## 8. What this document does not decide

- The tables, columns, grant model or policy predicates — **Loop F's lane**.
- The corrected scoped-share mechanism — **RT-CORR-05, pending**.
- The consent type × grantee × scope matrix — **RT-CORR-06, pending**.
- Link lifetimes, which are an implementation parameter with a security
  consequence and belong with the architecture.
- Whether a person may share with a **practice** rather than a named doctor.
  Not proposed; it would need its own decision, because "the practice" is not a
  clinical authority.

---

## Open decisions

| Ref | Decision | Owner | State |
|---|---|---|---|
| ~~PV-1~~ | Scoped-share grant shape | Loop F + C2 | ✅ **CLOSED** — resolved in accepted Rev 4.3.2d |
| ~~PV-2~~ | Consent matrix for document shares | Loop F + C2 | ✅ **CLOSED** — resolved in accepted Rev 4.3.2d |
| ~~PV-6~~ | Signed-link lifetime | Loop F | ✅ **CLOSED** — an implementation parameter within the accepted design |
| **PV-3** | Who may grant care-manager access — subject only, or staff with evidence | Owner | Open. Architecture defers to subject-only in the baseline |
| **PV-4** | Whether vault contents ever appear in a patient-facing export, and in what form | Owner | Open |
| **PV-5** | Vault retention after account closure | Owner + legal/regulatory | Open |
| **PV-7** | Sharing wording shown at grant time — must state the import consequence (§5.1) | Owner | Open. **Blocks real-patient use**, not implementation |
| **PV-8** *(new)* | Clinical-scope lifetime and post-visit grace window (§4) | Owner | Open. Architecture supports any value |
