# Clinical Data Classification Standard

> **STATUS: DRAFT · Loop D · reconciled 2026-09-03 against accepted Database V2
> architecture Rev 4.3.2d.** Documentation-level standard. Defines categories and
> the rules each category carries. **It defines no table, column, policy or
> grant.** Every category below has been checked against the accepted
> architecture; a twelfth category — **control-plane analytics** — is added
> because the Owner Control Center is now part of the accepted design.

**Why this exists.** "Sensitive" is not a category anyone can enforce. A rule
like "staff may not see patient data" fails the first time someone must decide
whether an appointment time is patient data. This standard names twelve
categories and answers the same eight questions for each, so the answer is
looked up rather than argued.

**How to use it.** Every new table, payload, log line, export, notification and
AI context window is assigned to exactly one category **before** it is built. If
it does not fit a category, that is a decision to be escalated — not a reason to
pick the nearest one.

---

## The eight questions

| Question | What it settles |
|---|---|
| **Controller** | Whose data is it, in the sense of who decides |
| **Allowed readers** | The complete list. Anyone not named is prohibited |
| **Prohibited readers** | Named explicitly where the temptation is real |
| **Export** | Whether it appears in an export, and in whose |
| **Retention / deletion** | Archive vs delete, and who may |
| **Operational audit** | May the *value* appear in `audit_events` |
| **Platform staff** | May staff read it by role alone |
| **AI / service agents** | May an automated actor read it |
| **Marketing** | May it influence targeting, ever |

**Two rules override every row below.**

> **R1 — Allowlist, never exclusion.** Every "allowed readers" list is complete
> and closed. A reader class invented later is refused by default. Never write a
> rule as "anyone except X".

> **R2 — Clinical content is never marketing material.** No category marked
> clinical may influence an audience, an offer, a campaign or a ranking, by any
> path, including inference from engagement.

---

## 1. Clinical record

The doctor's clinical content: encounters, notes, findings, diagnoses,
investigations, prescriptions, clinical documents, private notes, safety entries.

| | |
|---|---|
| **Controller** | The owning doctor |
| **Allowed readers** | The owning doctor, and only the owning doctor. Plus a recipient of an explicit, consented, time-bounded share — who receives a **copy into their own record**, not a view of this one |
| **Prohibited readers** | Every other doctor (including at the same location); reception; location and organization admins; platform owner; all platform staff; all service agents; the organization; any AI by default |
| **Export** | In the **doctor's** export. Not in a patient-facing export by default |
| **Retention** | Archive only. **No hard delete** by any application path. `PENDING OWNER + LEGAL/REGULATORY DECISION` on duration |
| **Operational audit** | **Never as a value.** Identifiers and field *names* only |
| **Platform staff** | **No.** Not by any role, including owner |
| **AI / agents** | Only a purpose-built, minimal, logged subset, only with doctor opt-in, and only in a draft-producing direction |
| **Marketing** | **Never**, by any path |

**A count is a disclosure.** "There are 2 records you may not see" removes the
identity and keeps the existence. Where a party must not learn something exists,
the answer must be identical whether it exists or not.

---

## 2. Clinical metadata

Facts *about* a clinical record that are not its content: that an encounter
exists, its status, its timestamps, its location, version numbers, document
counts, content hashes.

| | |
|---|---|
| **Controller** | The owning doctor |
| **Allowed readers** | The owning doctor. **Narrowly and specifically**, an operational status answer to staff who need it to run the room — delivered as a purpose-built answer ("consultation finished"), never as a row |
| **Prohibited readers** | Anyone reading it as a proxy for content. Other doctors. Platform staff. Service agents |
| **Export** | Doctor's export |
| **Retention** | Follows the record it describes |
| **Operational audit** | Yes — this is largely what operational audit *is* |
| **Platform staff** | No |
| **AI / agents** | No by default |
| **Marketing** | **Never.** "Attends often" is a clinical inference |

**The trap this category exists to name.** Metadata leaks content by pattern: a
psychiatry-clinic appointment every Tuesday says something the appointment row
does not contain. Treat frequency, location and specialty combinations as
clinical whenever they are exposed outside the room.

---

## 3. Personal health data

What the person holds about themselves: their vault documents, their own health
notes, their identity health attributes.

| | |
|---|---|
| **Controller** | **The person** (or their guardian under a live access relationship) |
| **Allowed readers** | The person; anyone with a live access relationship to that subject; a doctor named in a live, scoped share grant |
| **Prohibited readers** | Doctors without a live grant; a doctor whose grant has expired or been revoked; reception; platform staff; service agents; family members without a live relationship |
| **Export** | The **person's** export |
| **Retention** | The person may archive their own. Archiving does not touch anything a doctor already imported |
| **Operational audit** | Never as a value |
| **Platform staff** | No |
| **AI / agents** | No |
| **Marketing** | **Never** |

**This is not a clinical record.** It is what a person collected. It carries no
diagnosis, it is not clinical truth, and a doctor who uses one takes
responsibility by importing it. See
[Personal Vault vs Clinical Documents](personal-vault-and-clinical-documents.md).

---

## 4. Operational metadata

Running the practice: appointments, booking serials, queue tokens, location
membership, working hours, closed dates.

| | |
|---|---|
| **Controller** | The doctor, for their practice; the location, for its schedule |
| **Allowed readers** | The doctor; reception and location admin **at that location**, by explicit role allowlist; the booking party for their own booking |
| **Prohibited readers** | Staff at other locations; other doctors' operational data; platform staff by role alone |
| **Export** | Doctor's export |
| **Retention** | `PENDING OWNER DECISION` |
| **Operational audit** | Yes |
| **Platform staff** | **Support only, consented, scoped and time-bounded** — for a specific conversation, on a named set of fields. Never ambient |
| **AI / agents** | A support agent may read a **minimal, consented** operational scope to answer a booking question |
| **Marketing** | Aggregate service messaging only. Never an individual's pattern |

**Reception at Location A must never see Location B**, or the doctor's private
chamber. Location scoping is part of the rule, not a UI convenience.

---

## 5. Authentication and account data

Credentials, sessions, MFA enrolment, device and lock state, recovery contacts,
security events.

| | |
|---|---|
| **Controller** | The account holder |
| **Allowed readers** | The account holder, for their own security surface |
| **Prohibited readers** | **Everyone else, including the platform owner.** No staff role reads a secret |
| **Export** | Security *events* may appear in the holder's export. **Secrets never leave** |
| **Retention** | Security events retained for investigation. `PENDING OWNER + LEGAL/REGULATORY DECISION` |
| **Operational audit** | The **event**, yes. **Never** the secret, token, code or session id |
| **Platform staff** | May see that an event occurred, for support. Never a secret value |
| **AI / agents** | **Never.** No agent participates in authentication or recovery |
| **Marketing** | Never |

**Security notifications are never suppressed by a marketing preference.**

---

## 6. Billing and payment data

Subscriptions, invoices, payments, refunds, ledger entries, payouts.

| | |
|---|---|
| **Controller** | Doctor's Diary as the commercial party; the doctor for their own account |
| **Allowed readers** | The doctor for their own; a finance operator holding that explicit role |
| **Prohibited readers** | Doctors other than the account holder; support and moderation staff without the finance role; service agents; anyone reading it to reach clinical data |
| **Export** | Doctor's export |
| **Retention** | Likely a statutory financial obligation. `PENDING OWNER + LEGAL/REGULATORY DECISION` |
| **Operational audit** | Yes — amounts, currency, identifiers |
| **Platform staff** | Finance role only |
| **AI / agents** | A fraud agent may **score and flag**. It may never move money, suspend an account or decide an outcome |
| **Marketing** | Commercial standing may inform commercial offers. **No clinical input, ever** |

**Payment data holds no clinical link.** The deepest reference is an appointment
— an operational row. A finance operator can see that a consultation was paid;
not who it was with medically, what was prescribed, or why.

---

## 7. Audit data

The operational trail: actor, action, resource id, time, origin, correlation.

| | |
|---|---|
| **Controller** | Doctor's Diary, as an integrity record |
| **Allowed readers** | The actor, for their own actions; defined platform roles, platform-wide; a location admin for their location |
| **Prohibited readers** | Anyone seeking clinical content through it |
| **Export** | The actor's own entries |
| **Retention** | Append-only. **Never editable by anyone, including the owner.** Duration `PENDING OWNER + LEGAL/REGULATORY DECISION` |
| **Operational audit** | It *is* the audit |
| **Platform staff** | Yes, by role |
| **AI / agents** | Agents **write** to it on every action. Reading is limited to their own trail |
| **Marketing** | Never |

**The load-bearing rule:** because audit is readable by roles that must never see
clinical content, audit entries carry **identifiers and field names, never
clinical values**. A payload containing a diagnosis, a medicine name, a document
title, a filename or a note is a defect — not a verbose log.

---

## 8. Public professional data

What a doctor chooses to publish: name, qualifications, specialty, chambers,
public booking profile, photograph.

| | |
|---|---|
| **Controller** | The doctor |
| **Allowed readers** | Anyone, once published — including anonymous visitors |
| **Prohibited readers** | None, by definition. **But publication must be opt-in and revocable** |
| **Export** | Doctor's export |
| **Retention** | Withdrawn on unpublication; search-engine copies are outside our control and this must be said honestly |
| **Operational audit** | Yes |
| **Platform staff** | Yes |
| **AI / agents** | Yes — this is discovery data |
| **Marketing** | Yes, with the doctor's agreement |

**Private by default.** A professional profile is not public until the doctor
publishes it. Directory information and clinical information are in different
domains and share no row.

---

## 9. Community content

Posts, comments, reactions, professional discussion, moderation reports.

| | |
|---|---|
| **Controller** | The author, within the space's rules |
| **Allowed readers** | Members of that space's access class; moderators holding the explicit moderation role |
| **Prohibited readers** | Anyone outside the access class. **Moderators reach community content only — never clinical records** |
| **Export** | The author's export |
| **Retention** | Removal is moderation state, with appeal. `PENDING OWNER DECISION` |
| **Operational audit** | Moderation actions, yes |
| **Platform staff** | Moderation role only |
| **AI / agents** | A moderation agent may classify, score and flag. It may not remove disputed content, ban a professional, or touch a case a human has taken |
| **Marketing** | Not without explicit author consent |

**Community is not clinical.** A doctor discussing a case in a professional space
is publishing community content, and it must never be linked to, joined with, or
resolved against a clinical record. De-identified clinical case discussion is
**out of scope** and would require its own design and review.

---

## 10. Support metadata

Support conversations, tickets, diagnostic context, resolution notes.

| | |
|---|---|
| **Controller** | Doctor's Diary, with the requester as subject |
| **Allowed readers** | The requester; support staff holding the role, **within a consented scope** |
| **Prohibited readers** | Support staff outside the granted scope; any staff reading it to reach clinical data |
| **Export** | Requester's export |
| **Retention** | `PENDING OWNER DECISION` |
| **Operational audit** | Yes |
| **Platform staff** | Support role, scoped and time-bounded |
| **AI / agents** | A support assistant may operate within the same consented scope. **No clinical read, ever** |
| **Marketing** | Never |

**Support consent is granted to a role, not to a named employee.** A person
consents to "support may see my booking status for this conversation" — a grant
that survives a shift change without tempting a wider re-grant.

---

## 11. Regulatory and medicine reference data

Medicine references, manufacturers, regulator-sourced records, source provenance,
published health advisories.

| | |
|---|---|
| **Controller** | The issuing source. Doctor's Diary is a custodian, never an author |
| **Allowed readers** | Authenticated users, per feature. Published advisories may be public |
| **Prohibited readers** | None — but **write** access is tightly held |
| **Export** | Not doctor-specific. A doctor's own medicine list is clinical-adjacent and exports with them |
| **Retention** | Versioned, never silently overwritten. A frozen prescription must keep meaning when reference data changes |
| **Operational audit** | Yes — especially source ingestion and status changes |
| **Platform staff** | Yes, per role |
| **AI / agents** | May **draft** and monitor sources. **May never publish** |
| **Marketing** | No. Reference data is not promotional inventory |

**Never generate drug facts with an LLM and store them as reference data.** Every
field carries a source and a verification date. No source means it does not
render as reference data.

**Prescribing search is literal, never fuzzy.** A search must not offer a
different molecule than the one typed. Any spelling aid is a separately labelled,
separately selected feature — never a silent fallback.

---

## 12. Control-plane analytics

*Added 2026-09-03. The Owner Control Center is part of the accepted architecture,
and its data is a category of its own — not a variety of clinical metadata.*

Counters and rollups the owner reads: registered/active/paid doctors, counts of
consultations, prescriptions and appointments, feature adoption, AI and
transcription usage, cost, budget state, provider errors, system health.

| | |
|---|---|
| **Controller** | Doctor's Diary, as operator of the platform |
| **Allowed readers** | `PLATFORM_ANALYST` — **aggregate control-plane data only**. `PLATFORM_ADMIN` for budgets and metric definitions; `FINANCE_OPERATOR` for provider invoices and manual cost adjustments |
| **Prohibited readers** | Anyone reading it as a route to clinical content — including the platform owner. **A dimension that identifies a patient is prohibited outright** |
| **Export** | Not part of a doctor's or a person's export. It is the platform's operating data |
| **Retention** | `PENDING OWNER DECISION` |
| **Operational audit** | Yes — and **reads are audited as well as writes**, because reading the control centre is itself a privileged act |
| **Platform staff** | Only the three roles named above, each separately granted |
| **AI / agents** | No |
| **Marketing** | Aggregate platform reporting only. **Never an individual doctor's clinical pattern**, and never anything derived from a patient |

**The rule that makes this category safe:** its numbers are produced **on the
clinical side of the boundary and cross as numbers**. The control plane reads
counters, never records, and holds no permission on any clinical table — so a
defective analytics query **fails rather than discloses**.

**Reporting dimensions are an allowlist.** Doctor, date, provider, service,
model, feature and market are dimensions. **Diagnosis, medicine, document type
and inferred condition are not, and cannot become dimensions by configuration.**

> **Why this is its own category and not "clinical metadata".** Clinical metadata
> is *about* a clinical record and inherits its restrictions. Control-plane
> analytics is deliberately **downstream of an aggregation** — the individual
> record is gone before the control plane sees anything. Filing it under clinical
> metadata would either over-restrict the owner's legitimate operating data, or —
> far worse — invite someone to argue the reverse: that because analytics is
> permitted, the metadata behind it is too.

---

## Assignment rules

1. **One category per artefact.** If two fit, take the more restrictive and
   escalate the ambiguity.
2. **Mixing categories in one payload takes the strictest rule in the mix.** A
   notification carrying an appointment time and a diagnosis is clinical.
3. **Derived data inherits.** Anything computed from clinical data is clinical,
   including counts, flags and scores.
4. **Rendering is not reading.** A service that renders a message to a recipient
   must be authorized as that recipient; it does not acquire a broad clinical
   read because it needs one field.
5. **A new reader class is a decision.** Adding an actor requires revisiting
   every "allowed readers" list explicitly. Silence is refusal.

---

## Open decisions

| Ref | Decision | Owner |
|---|---|---|
| CDC-1 | Retention duration for every category | Owner + legal/regulatory |
| CDC-2 | Whether a patient-facing export includes clinical-record extracts | Owner |
| CDC-3 | Support scope field list — exactly which operational fields | Owner + Loop F |
| CDC-4 | Community content removal and appeal retention | Owner |
| ~~CDC-5~~ | Notification rendering authorization model | Loop F + C2 | ✅ **CLOSED** — recipient-scoped rendering, accepted Rev 4.3.2d |
| ~~CDC-6~~ | Consent type × grantee × scope matrix | Loop F + C2 | ✅ **CLOSED** — normative matrix, accepted Rev 4.3.2d |
