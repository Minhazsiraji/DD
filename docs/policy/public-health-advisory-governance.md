# Public Health Advisory Governance

> **STATUS: DRAFT · Loop D · 2026-09-02.** Policy-level governance for publishing
> public health information. **No regulatory or legal claim is made anywhere in
> this document.** No DGDA relationship, endorsement, obligation or approval is
> asserted, because none has been evidenced.

---

## 1. What an advisory is, and is not

An advisory is **general public health information for a region and a period**,
sourced from a trusted body, published by a named human.

| An advisory **is** | An advisory **is not** |
|---|---|
| "Dengue activity is increasing in Dhaka. Protect your family from mosquito bites." | Anything about an individual |
| Regional, time-bounded, sourced | A diagnosis, a triage, a treatment instruction |
| A quotation of a trusted body's position | Doctor's Diary's own epidemiological finding |
| Withdrawable and supersedable | A permanent statement |

> **Doctor's Diary does not have epidemiological authority and must never appear
> to.** It relays what trusted sources say, with attribution. It does not
> discover outbreaks, and it must not be readable as if it had.

---

## 2. Trusted source registry

Every advisory rests on registered sources. A source carries:

| Attribute | Purpose |
|---|---|
| Identity | Which body — named, not "public health authorities" |
| Provenance | Where the statement came from, retrievable and checkable |
| Trust level | How much weight it carries (§3) |
| Jurisdiction | Which regions the body speaks for |
| Registered by / when | Attribution for the trust decision |
| Verification date | When someone last confirmed it |
| Status | Active, demoted, retired |

**Registration is a decision, not data entry.** Adding a source asserts that a
body may be relied on for public health claims shown to patients.

---

## 3. Trust levels

| Level | Meaning | May support publication |
|---|---|---|
| **Official** | A government or regulatory body for that jurisdiction | **Yes** |
| **International** | A recognised international health body | **Yes** |
| **Professional** | A recognised professional or academic body | `PENDING OWNER DECISION` |
| **Media** | Press reporting | **No** — may inform a draft; cannot support publication |
| **Unverified** | Anything else, including social media | **No** — may not even inform a draft |

> **An advisory can never be published on the strength of rumour.** A draft
> lacking a source of sufficient trust cannot be published, and the draft itself
> records which sources it read — so "where did this come from" is answerable
> after the fact.

---

## 4. Source trust and publication are separate authorities

> **The authority to say "this source is official" and the authority to say
> "publish this advisory" must not be the same authority.**

If one person can register a source, label it official, cite it and publish, then
the source requirement is not a second control — it is the same control wearing
two hats, and the trust tier is self-bootstrapping.

**Therefore:**
- source registration and trust assignment sit with a **`PUBLIC_HEALTH_SOURCE_STEWARD`**
  authority;
- publication sits with a **`HEALTH_ADVISORY_EDITOR`** authority;
- they are separately granted, and holding one never confers the other;
- **the two roles are mutually exclusive on the same person.**

> **This is stronger than the general non-nesting rule, and deliberately so.**
> Elsewhere a person may legitimately hold two roles provided each grant is
> separately recorded. Here, holding both **is** the attack — one person who can
> register a source, label it official, cite it and publish has defeated the
> control entirely. So the combination is **refused**, not merely audited.

**Reconciled against accepted architecture Rev 4.3.2d §4.1 / §26.2a.**
`PUBLIC_HEALTH_SOURCE_STEWARD` is role 8 of nine; the exclusivity constraint and
the requirement that a source's approval-for-citation **predate** the draft that
cites it are both part of the accepted design.

`PENDING OWNER DECISION` — whether high-severity publication requires a second
human beyond the steward/editor split.

---

## 5. Versioning, applicability and expiry

Every advisory carries:

| Field | Rule |
|---|---|
| **Version** | Every substantive change is a new version. Published text is **never silently edited** |
| **Region applicability** | At least one region. Never global by default |
| **Language** | Explicit. A translation is a version, not a substitute |
| **Effective from** | When it starts applying |
| **Valid until** | When it stops. **Mandatory** — see §5.1 |
| **Severity** | Drives review requirements and how prominently it appears |
| **Sources** | At least one, with the trust levels that supported publication |
| **Published by** | The named human |

### 5.1 An advisory must expire

> **A public health advisory without an expiry becomes a permanent claim about a
> temporary situation.**

Last year's dengue advisory, still displayed, is misinformation — even though it
was accurate when published. Every advisory carries a validity window, and an
expired advisory stops being presented as current.

`PENDING OWNER DECISION` — default validity window per severity, and the review
cadence for long-running advisories.

### 5.2 Supersession and withdrawal

- **Supersession**: a new version replaces an old one, with lineage. Both remain
  in the record.
- **Withdrawal**: an advisory is removed from circulation because it was wrong,
  or the situation ended. Withdrawal is **recorded with a reason** and is itself
  a publication-authority act.
- Withdrawal must be **at least as fast as publication**. A pipeline that can
  publish in minutes and retract in days is a hazard.
- Withdrawn and superseded advisories are **retained**, not deleted — what was
  told to the public, and when, must remain answerable.

---

## 6. What AI may and may not do

| AI may | AI may never |
|---|---|
| Monitor registered sources for change | **Publish** |
| Draft an advisory from sources it read | Register a source or set its trust level |
| Translate a draft | Assert an outbreak of its own |
| Propose coarse regions | Use clinical data for anything |
| Flag a stale advisory for review | Withdraw or supersede a published advisory |

> **Human publication authority is absolute.** There is no auto-publish
> configuration, no confidence threshold that bypasses review, and no "trusted
> draft" path. The branch does not exist.

A draft records that it was AI-produced, so a reviewing editor knows what they
are reviewing.

---

## 7. Targeting

Advisory targeting is **coarse and non-clinical**.

**Permitted inputs:** country, region, language, and the person's own explicit
preferences.

**Prohibited inputs — categorically:** any diagnosis, prescription,
investigation, clinical note, document, inferred condition, family clinical
record, or any value derived from them.

> **Engagement is not inference.** Opening a dengue advisory records that it was
> read. It does not create an interest, a condition, an audience or a targeting
> attribute, and it must never feed a commercial offer.

A **broad public age category** (for example, a childhood vaccination campaign)
is possible only where the age determination happens inside the sending domain at
send time, is never exposed to the advisory engine, and carries a **documented
justification recorded on the campaign**.

`PENDING OWNER DECISION` — whether age-based targeting is enabled at all in the
first release.

---

## 8. Ask DD must retrieve, never fabricate

When a person asks about current health conditions — "what is the dengue
situation in Dhaka?" — the answer is **retrieved from currently published
advisories** and quoted with attribution.

> **When no current advisory matches, the honest answer is "there is no current
> Doctor's Diary advisory for that."**

The assistant has no path to generate an outbreak claim of its own, and "no
advisory" must never be dressed up as reassurance ("there is no outbreak") or as
alarm. Absence of an advisory is absence of information, and must be said that
way.

An advisory answer always carries: what was said, who said it, when it was
published, and until when it applies.

---

## 9. Boundaries

- **No regulatory claim.** This document asserts no relationship with, obligation
  to, or endorsement by any regulator, including DGDA. Any such claim requires
  evidence and its own approval.
- **No clinical advice.** Advisories are general information. They never refer to
  an individual's records or inferred condition.
- **No advertising.** An advisory is not commercial inventory and must never
  carry a sponsored placement.
- **Attribution is not endorsement.** Quoting a body does not imply it endorses
  Doctor's Diary, and the presentation must not suggest it does.

---

## Open decisions

| Ref | Decision | Owner |
|---|---|---|
| PHA-1 | Whether professional-tier sources may support publication | Owner |
| PHA-2 | Default validity window per severity | Owner |
| PHA-3 | Whether high-severity publication requires a second human | Owner |
| PHA-4 | Steward as distinct role vs distinct grant | Owner + Loop F |
| PHA-5 | Whether age-based targeting ships in the first release | Owner |
| PHA-6 | Source-governance separation mechanism | Loop F + C2 (RT-CORR-11) |
| PHA-7 | Retention of withdrawn and superseded advisories | Owner + legal/regulatory |
