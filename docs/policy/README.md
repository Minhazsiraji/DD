# Doctor's Diary — Policy, Governance & Operations

**Loop D documentation readiness pack · prepared 2026-09-02 · all documents DRAFT.**

None of these documents is in force. Each carries its own status block and its
own open-decisions table.

| # | Document | Depends on Loop F/C2? | Can be approved now? |
|---|---|---|---|
| D1 | [Data Policy V2](../data-policy.md) | Partly | **Sections yes** — see below |
| D2 | [Clinical Data Classification](clinical-data-classification.md) | Minimally | **Yes**, with 6 open items |
| D3 | [Platform Role Governance](platform-role-governance.md) | No | **Yes** |
| D4 | [Clinical Record Lifecycle](clinical-record-lifecycle.md) | Partly | **Principles yes** |
| D5 | [Personal Vault vs Clinical Documents](personal-vault-and-clinical-documents.md) | **Yes — blocking** | **No** — boundary yes, sharing no |
| D6 | [AI / Service-Agent Governance](ai-service-agent-governance.md) | Partly | **Yes**, except the credential mechanism |
| D7 | [Public Health Advisory Governance](public-health-advisory-governance.md) | Minimally | **Yes** |
| D8 | [Pilot Operations](pilot-operations.md) | **Yes — gate closed** | **As documentation only.** Authorizes nothing |
| D9 | [Glossary](../glossary.md) | **Yes — follows Loop F** | **No** — provisional until V2 names are accepted |

---

## Reading order

**For a decision about what the product promises** — D1, then D2.
**For a decision about who may do what** — D3, then D6.
**For a decision about records over time** — D4, then D5.
**For anything involving a real patient** — D8 first, and note that it authorizes
nothing.
**When a term is ambiguous** — D9, always.

---

## The rules these documents share

1. **Doctor-owned.** Each doctor's clinical repository is separate. The same
   person seen by two doctors is two records with no shared visibility.
2. **Allowlist, never exclusion.** Every reader list is closed. A new actor class
   is refused by default.
3. **No role reaches clinical data** — including the platform owner.
4. **Roles do not nest.**
5. **Clinical data is never sold and never targets marketing.**
6. **No hard delete of clinical records.** Archive, with a reason, reversible.
7. **Finalised records are corrected, never rewritten.**
8. **Revocation is prospective.**
9. **A path, a link and an identifier are never authorization.**
10. **AI output is a draft.**
11. **Operational audit carries names, never clinical values.**
12. **No retention period, jurisdiction or regulatory claim is asserted anywhere.**

---

## Marker conventions

| Marker | Meaning |
|---|---|
| `PENDING OWNER DECISION` | A product/commercial decision. Not invented here |
| `PENDING OWNER + LEGAL/REGULATORY DECISION` | Needs qualified advice. **Every retention duration is one of these** |
| `PENDING LOOP F + C2 ARCHITECTURE ACCEPTANCE` | Depends on Database V2, which is under correction |
| `PENDING TECHNICAL VERIFICATION` | Answerable by checking, not deciding |

**Nothing in this pack resolves a marker.** Where an unresolved decision affected
wording, the principle is stated and the mechanism is left open — deliberately,
because a guess written into a policy is quoted back as a commitment.

---

## Relationship to other lanes

| Lane | Relationship |
|---|---|
| **Loop F** — Database V2 architecture | **Authoritative on structure and naming.** These documents state properties the architecture must satisfy; they never specify mechanism. D9 follows Loop F's names |
| **Loop C2** — red team | Its findings are dependencies here. Where a finding is unresolved, the affected policy is marked pending |
| **Loop A / B** — clinical, commercial | Consume these documents; do not modify them |
| **Loop E, Voice** | On hold / queued. Voice appears only as the standing draft-only rule |

**Precedence.** Where these documents and an accepted Doctor's Diary decision
(an ADR, `CLAUDE.md`, or the Loop F architecture) disagree, **the accepted
decision wins** and the conflict is reported rather than silently resolved.
