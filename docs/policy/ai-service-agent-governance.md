# AI / Service-Agent Governance Policy

> **STATUS: DRAFT · Loop D · 2026-09-02.** Governance rules for automated actors.
> **No implementation, no credential design, no Voice work.** Voice remains
> queued and outside this document; only the standing draft-only rule is stated.

---

## 1. The four rules

> **A1 — AI output is a draft.** Every AI output is a proposal for a human,
> unless a specific output has been separately approved as something else. No
> such approval exists today.

> **A2 — AI never holds clinical authority.** It cannot finalise a prescription,
> complete an encounter, issue a correction, or take any authoritative clinical
> action. AI proposes; a clinician accepts.

> **A3 — Automated actors read nothing by default.** An agent's access is an
> explicit, enumerated, minimum-scope allowlist. Absence of a grant is refusal.

> **A4 — Every automated action is attributable.** Which agent, what action,
> when, on what — **including refused attempts**.

---

## 2. What a service agent is

A service agent is an **automated actor**: a moderation classifier, a support
assistant, a fraud scorer, a health-intelligence drafter.

It is **not a user** and **not staff**. It holds no human account and no staff
role. Anything expressed as "the signed-in person" excludes it structurally, and
that is the primary containment — not a policy that must be remembered.

---

## 3. The prohibition that must be stated first

> ⛔ **No automated actor may hold or act through an ambient
> bypass-authorization credential** — a database superuser, a service-role key,
> or any credential that sidesteps row-level security.
>
> **There is no configuration in which this is acceptable, including local
> development**, because a development shortcut is exactly how such a credential
> reaches production.

Stated first because it is the default an implementation drifts into when
nothing else is specified. If an agent's real answer to "how does it connect?"
is a bypass key, every other containment claim in this document is void.

**Consequences for governance:**
- an agent's identity must be **individually attributable** — not a shared
  credential;
- an agent's authority must be **enumerated**, not implied by the connection;
- disabling an agent must take effect **immediately**, not at its next session;
- key rotation must not require a window in which an agent is unauthenticated.

`PENDING LOOP F + C2 ARCHITECTURE ACCEPTANCE` — the credential and identity
mechanism (C2 RT-CORR-09).

---

## 4. Risk classes

| Class | Meaning | Automated actor |
|---|---|---|
| **LOW** | Reversible, no authority transfer | May act |
| **MEDIUM** | Affects a person's experience; reversible | May act, or may **propose for confirmation** |
| **HIGH** | Sanctions, money, credentials, clinical content | **Never.** Refused before authorization is consulted |
| **FORBIDDEN** | Never automated, at any risk appetite | **Never** |

An agent carries a maximum risk class, and no agent carries HIGH. The action
carries its own class too. **Both must permit the act** — a single ceiling is one
mistake away from being raised.

---

## 5. Per-agent authority

| Agent | May | May never |
|---|---|---|
| **Clinical drafting assistant** | Draft clinical text for the treating doctor, in their own record, at their explicit request, with opt-in | Finalise anything; write to a clinical record unreviewed; raise a safety warning; act across doctors |
| **Voice transcription** | Produce **draft text** from dictation | Be a clinical record in itself; auto-commit; be finalised without review |
| **Support assistant** | Answer questions; navigate; run LOW-risk actions; **request** a MEDIUM action for confirmation | **Read clinical content**; take a HIGH action; extend its own scope; assert a verification |
| **Moderation classifier** | Classify, score, flag, open a case, queue for human review; act on **obvious** spam under a named rule | Remove disputed content; sanction a professional; revoke a credential; touch a case a human has taken; read clinical records |
| **Fraud / risk scorer** | Score, flag, open a compliance case | Suspend an account; revoke a credential; move, hold or reverse money |
| **Health-intelligence drafter** | Monitor sources, draft advisories, translate, propose coarse regions, flag staleness | **Publish anything**; assert an outbreak of its own; use clinical data |

---

## 6. Clinical access

> **6.1 — Support AI reads no clinical data.** Not by default, not on request,
> not with a supervisor's approval, not to diagnose a bug. If support cannot see
> the problem, the answer is a better diagnostic surface.

> **6.2 — Moderation AI reads no clinical records.** Moderation operates on
> community content. There is no path from a moderation case to a clinical
> record.

> **6.3 — A clinical assistant reads only a purpose-built minimum.** Never a raw
> record, never "the patient's history" wholesale. A restricted, purpose-shaped
> subset, assembled by a component whose job is to decide what may leave — and
> **every disclosure is logged**.

> **6.4 — No broad service-role clinical read exists.** Not for rendering, not
> for notifications, not for search indexing, not for analytics, not for
> background jobs.

**The rendering case, named because it is the likely breach.** A background
service that renders a message containing one clinical field is tempted to
acquire a broad clinical read "just to render". It must instead be authorized
**as the recipient**, for **that message**, and reach nothing else.

`PENDING LOOP F + C2 ARCHITECTURE ACCEPTANCE` — the recipient-scoped rendering
model (C2 RT-CORR-10).

---

## 7. Credentials, money and ownership

> **7.1 — No automated actor revokes, suspends or decides a professional
> credential.** Credential decisions require a named human holding the verifier
> role, and the first verification per regulator requires two. An agent may
> raise a flag; a human decides.

> **7.2 — No automated actor has authority over money.** No payment, refund,
> payout, ledger adjustment, hold or reversal. Scoring and flagging only.

> **7.3 — No automated actor changes clinical ownership.** It cannot transfer,
> reassign, merge or share a clinical record, or create a link that would.

---

## 8. Human review

Required before the action takes effect:

| Action | Automated part | Human part |
|---|---|---|
| Finalising a prescription | Draft only | **Doctor reviews and approves** |
| Completing an encounter | Draft only | Doctor completes |
| Any clinical correction | Draft only | Doctor issues |
| Removing disputed content | Classify and queue | Moderator decides |
| Sanctioning a professional | Flag | Supervisor decides |
| Any credential decision | Flag | Verifier decides (two, on a first verification) |
| Any payment action | Score | Finance operator decides |
| Publishing an advisory | Draft | Advisory editor publishes |
| Enabling or re-keying an agent | None | Platform admin acts |

**Review must be real.** A confirmation step that presents a wall of generated
text with one "Approve" button is not review; it is a signature harvester. The
reviewing human must be shown what changes, in a form they can actually check.

---

## 9. Auditability

Every automated action records the **kind** of actor, its identity, the action,
the target, the time and the outcome — under the same model as human privileged
actions, so one query answers "everything automated actors did today".

Required:
- **refused attempts as well as successful ones.** A refusal is the signal that
  matters;
- every disclosure of clinical context to a model, including what was sent;
- draft provenance: a record that AI produced text, so a reviewer knows what they
  are reviewing.

Prohibited:
- **clinical values in operational audit entries** — identifiers and field names
  only, as for every actor;
- prompt bodies containing clinical content in an operationally readable log.

---

## 10. Compromise

If an agent is compromised:

1. **Disabling takes effect immediately**, mid-session — not at next connection.
2. **The blast radius is bounded by design** — no clinical table, no credential
   decision, no financial write. It reaches community content, support
   conversations, advisory drafts and flags, all of which are recoverable.
3. **The full trail is queryable** by actor kind and identity.

If a proposed design cannot make these three statements, the containment is not
in place.

---

## 11. Explicitly out of scope

- **Voice implementation.** Queued, separately controlled. Only the standing rule
  applies: **transcription is draft input.**
- Model selection, prompting, evaluation and vendor choice.
- The credential mechanism (RT-CORR-09) and rendering authorization (RT-CORR-10).
- Any autonomous clinical agent. Not contemplated; would require its own design,
  its own review, and a clinical safety case this document does not attempt.

---

## Open decisions

| Ref | Decision | Owner |
|---|---|---|
| AIG-1 | Service-agent credential and identity mechanism | Loop F + C2 (RT-CORR-09) |
| AIG-2 | Recipient-scoped notification rendering | Loop F + C2 (RT-CORR-10) |
| AIG-3 | Whether "obvious spam" auto-action is permitted at launch, and its definition | Owner |
| AIG-4 | Retention of AI disclosure logs | Owner + legal/regulatory |
| AIG-5 | Whether any AI output is ever non-draft | Owner (default: **no**) |
| AIG-6 | Provider terms — whether clinical context may leave the jurisdiction at all | Owner + legal/regulatory |
