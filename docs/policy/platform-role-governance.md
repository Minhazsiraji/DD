# Platform Role Governance Specification

> **STATUS: DRAFT · Loop D · 2026-09-02.** Governance specification. Defines role
> purpose, prohibited authority and separation of duties. **It defines no
> database role, policy, grant or RLS predicate** — that is Loop F's lane.

---

## 1. The governing rule: roles do not nest

> **No platform role implies any other platform role.**
>
> `PLATFORM_ADMIN` ≠ `COMMUNITY_MODERATOR`
> `PLATFORM_ADMIN` ≠ `CREDENTIAL_VERIFIER`
> `PLATFORM_ADMIN` ≠ `FINANCE_OPERATOR`
> `PLATFORM_ADMIN` ≠ `HEALTH_ADVISORY_EDITOR`
> `PLATFORM_OWNER` ≠ `DOCTOR`
> `SUPPORT` ≠ `CLINICAL_ACCESS`
>
> One person may hold several roles. **Each must be granted separately and
> explicitly.** Holding a senior role never confers a specialist one.

**Why this is stated as an absolute.** Role nesting is not a shortcut that saves
a grant; it is a rule that is easy to apply in one place and forget in another.
Inconsistency here has already been found once in the V2 architecture review: a
matrix permitted a platform admin to take high-risk moderation actions while the
advisory section said the opposite for the same reason. One principle, applied
in one place and abandoned in another, is not a principle.

**Seniority is not capability.** A platform admin is senior in *administration*.
That is a different axis from moderating a professional discussion, deciding a
medical credential, approving a payout, or publishing a public health advisory —
each of which demands a specific competence that seniority does not supply.

---

## 2. What honest least privilege can promise here

The person who administers roles can grant themselves a role. Any claim that
"an admin can never moderate" would be theatre.

**The guarantee is different, and it is real:**

> There is no path by which a privileged actor exercises a specialist authority
> without a role grant appearing in the record **first**.

Which means:
- self-granting is **permitted, never silent, and always attributable**;
- the grant is a distinct, audited, timestamped act that precedes the action;
- self-granted roles are **reportable** — a reviewer can list every role where
  the granter and the grantee are the same person;
- two actions are **unreachable by self-grant at all**, because they require a
  second distinct human by construction (§6).

State this honestly in any external description. Over-claiming least privilege is
how a security promise becomes a lie under audit.

---

## 3. Roles

Every role below reaches **no clinical data**. That is not repeated per row; it
is the standing rule of §4.

### PLATFORM_OWNER

| | |
|---|---|
| **Purpose** | Ultimate accountability for the platform as a business |
| **May** | Hold and grant roles; set commercial policy; be accountable |
| **May NOT** | Read any clinical record; act as a doctor; override a clinical authority check; approve their own high-risk action |
| **Notes** | **Not a clinical superuser.** No break-glass exists. Owner is a governance position, not an access level |

### PLATFORM_ADMIN

| | |
|---|---|
| **Purpose** | Operate the platform: configuration, staff membership, role administration |
| **May** | Grant and revoke staff roles; manage staff membership and deactivation; manage platform configuration; manage service-agent enablement; read platform-wide operational audit |
| **May NOT** | Take a moderation action at any risk class; decide a credential; approve a payment, refund or payout; publish a health advisory; read any clinical row |
| **High-risk** | Role grants — especially self-grants — and service-agent enablement |

### COMMUNITY_MODERATOR

| | |
|---|---|
| **Purpose** | Apply the published moderation policy to community content |
| **May** | Review reports, classify, hide, limit reach, open cases, apply the policy within their risk class |
| **May NOT** | Read clinical records; decide credentials; touch payments; review their own action on appeal; act outside the space's access class |
| **High-risk** | Removal of disputed content; any professional-facing sanction |

### MODERATION_SUPERVISOR

| | |
|---|---|
| **Purpose** | Decide escalations and appeals |
| **May** | Take higher-risk moderation actions; decide appeals |
| **May NOT** | Review an appeal of **their own** action; anything outside moderation |
| **Separation** | The appeal reviewer must differ from the original actor |

### CREDENTIAL_VERIFIER

| | |
|---|---|
| **Purpose** | Decide whether a claimed professional credential is genuine |
| **May** | Review evidence; approve, reject or revoke a credential |
| **May NOT** | Read clinical records; grant themselves the capability they verify; verify their own credential; be the sole decider on a first verification for a regulator (§6) |
| **High-risk** | Every decision — this role gates clinical authority itself |

### FINANCE_OPERATOR

| | |
|---|---|
| **Purpose** | Operate invoices, payments, refunds, ledger and payouts |
| **May** | Read and act on financial records; reconcile; process refunds and payouts within limits |
| **May NOT** | Read any clinical record; approve their own payout; alter audit; change subscription entitlement to unlock clinical authority |
| **High-risk** | Refunds; payouts; ledger adjustments |
| **Notes** | Financial records carry no clinical link. Finance sees *that* a consultation was paid; never what it contained |

### SUPPORT_AGENT

| | |
|---|---|
| **Purpose** | Help users with account, booking and product problems |
| **May** | Read **operational** data within a consented, scoped, time-bounded grant; guide; escalate |
| **May NOT** | **Read clinical data — categorically.** Take moderation or finance actions; decide credentials; extend their own scope; act without a consent record where one is required |
| **High-risk** | Any account-state change made on a user's behalf |
| **Notes** | `SUPPORT ≠ CLINICAL_ACCESS` is the single most tempting boundary to erode, because a support agent genuinely cannot see the problem. The answer is a better diagnostic surface, not clinical access |

### HEALTH_ADVISORY_EDITOR

| | |
|---|---|
| **Purpose** | Publish public health advisories |
| **May** | Review drafts; publish, supersede and withdraw advisories |
| **May NOT** | Read clinical records; register a trusted source **or** set its trust level (§6); target an advisory using clinical data |
| **High-risk** | Publication and withdrawal of high-severity advisories |

### ADVISORY_SOURCE_STEWARD

| | |
|---|---|
| **Purpose** | Register sources and assign trust level — **separately from publication** |
| **May** | Register a source; evidence and assign a trust tier; demote or retire a source |
| **May NOT** | Publish an advisory |
| **Notes** | Exists because publication authority and source-trust authority must not be the same authority (§6). See [Advisory Governance](public-health-advisory-governance.md) |

### ORGANIZATION_ADMIN

| | |
|---|---|
| **Purpose** | Administer an organization's branches, staff and operational configuration |
| **May** | Manage branches, membership and operational settings |
| **May NOT** | **Read clinical data of any doctor practising there.** Claim ownership of clinical records; access the doctor's private chamber data |
| **Notes** | **An organization never owns clinical data.** This is a data-policy promise, not an implementation detail |

### LOCATION_ADMIN / RECEPTIONIST

| | |
|---|---|
| **Purpose** | Run the desk at a location |
| **May** | Scheduling, queue, contact details — **at their own location only** |
| **May NOT** | Read notes, conditions, medications, documents or prescriptive content; see another location's data; see the doctor's private chamber |
| **Notes** | Operational, permanently. This is the boundary that has already leaked once and was fixed with an explicit role allowlist |

### SERVICE_AGENT (not a human role)

Automated actors are **not** staff and hold no staff role. See
[AI / Service-Agent Governance](ai-service-agent-governance.md).

---

## 4. The clinical boundary

> **No platform role — owner, admin, moderator, verifier, finance, support,
> advisory editor or organization admin — grants access to clinical data.**

There is no break-glass, no support override, no administrative patient view, and
no owner console that reads records. If clinical support access is ever needed,
it is a **new mechanism** with its own approval, its own consent, its own time
bound and its own audit. It is never an extension of a role that already exists.

Operational necessity is not an authorization. "Support cannot debug without
seeing the record" is a request for a better diagnostic surface.

---

## 5. Separation of duties

| Concern | Must not be the same authority |
|---|---|
| Granting a role | Exercising the specialist authority it confers |
| Taking a moderation action | Deciding its appeal |
| Registering a source and setting its trust | Publishing an advisory citing it |
| Requesting a payout | Approving it |
| Claiming a credential | Verifying it |
| Operating support | Reading clinical content |
| Administering the platform | Any specialist high-risk action |

Where one person legitimately holds both sides, the **acts must remain separately
granted, separately audited and separately reportable** — so that a reviewer can
see the combination existed at the time.

---

## 6. Four-eyes requirements

Two controls are already approved and are recorded here as governance, not
invention:

1. **First credential verification per regulator** requires **two distinct
   verifiers**; the second may not be the first.
2. **Moderation appeals** require a reviewer **distinct** from the staff member
   who took the original action.

A third is specified by the advisory design and belongs in this list:

3. **Advisory source trust and advisory publication are separate authorities.**
   A single person must not be able to register a source, label it official,
   cite it and publish — all within their own authority.

`PENDING OWNER DECISION` — whether four-eyes extends to: payouts above a
threshold (and what threshold), account deletion under a lawful process,
high-severity advisory publication, and service-agent enablement. **No threshold
is proposed here.**

---

## 7. High-risk actions

Actions requiring elevated scrutiny, explicit audit and — where marked —
a second human:

| Action | Role | Second human |
|---|---|---|
| Grant or revoke a staff role | `PLATFORM_ADMIN` | `PENDING OWNER DECISION` |
| Self-grant any role | `PLATFORM_ADMIN` | Not required; **must be reportable** |
| Decide a credential (first per regulator) | `CREDENTIAL_VERIFIER` | **Yes — approved** |
| Revoke a credential | `CREDENTIAL_VERIFIER` | `PENDING OWNER DECISION` |
| Remove disputed community content | `COMMUNITY_MODERATOR` | Appeal is separate |
| Decide a moderation appeal | `MODERATION_SUPERVISOR` | **Yes — approved** (distinct reviewer) |
| Approve a payout or refund | `FINANCE_OPERATOR` | `PENDING OWNER DECISION` |
| Publish a high-severity advisory | `HEALTH_ADVISORY_EDITOR` | `PENDING OWNER DECISION` |
| Set or raise a source's trust tier | `ADVISORY_SOURCE_STEWARD` | `PENDING OWNER DECISION` |
| Enable or re-key a service agent | `PLATFORM_ADMIN` | `PENDING OWNER DECISION` |
| Any lawful hard deletion of clinical data | **No role today** | **Yes — required** |

---

## 8. Audit expectations

Every privileged action records **what kind of actor** took it — a person, a
platform staff member, a service agent, or the system — alongside who, what,
when and from where. One model, so a report can ask "everything an automated
actor did" without joining four shapes.

Required:
- every role grant and revocation, including self-grants, with granter and
  grantee;
- every staff action, successful **or refused** — a refused attempt is the signal
  that matters;
- every service-agent action;
- correlation, so one incident reads as one story.

Prohibited:
- **any clinical value in an operational audit entry.** Identifiers and field
  names only. Audit is readable by roles that must never see clinical content;
- editing or deleting audit entries — by anyone, including the owner. Append-only
  is what makes it evidence.

---

## 9. Lifecycle

- Grants carry **who granted, when, and why**; time-boxed where the need is
  temporary.
- Roles are **reviewed periodically**; an unused specialist role should be
  revoked rather than left dormant. `PENDING OWNER DECISION` — review cadence.
- **Departure revokes every role immediately**, and revocation is audited.
- A **standing report** lists: self-granted roles, dormant roles, and every
  person holding two roles that §5 separates.

---

## Open decisions

| Ref | Decision | Owner |
|---|---|---|
| PRG-1 | Four-eyes scope beyond the two approved controls | Owner |
| PRG-2 | Payout approval threshold | Owner |
| PRG-3 | Role review cadence | Owner |
| PRG-4 | Whether `ADVISORY_SOURCE_STEWARD` is a distinct role or a distinct grant | Owner + Loop F |
| PRG-5 | Whether a lawful clinical-deletion authority is ever created, and its shape | Owner + legal/regulatory |
| PRG-6 | Final staff role enumeration in the V2 schema | Loop F + C2 (RT-CORR-08) |
