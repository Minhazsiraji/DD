# Doctor's Diary — Policy, Governance & Operations

**Loop D documentation readiness pack · prepared 2026-09-02 · RECONCILED
2026-09-03 against accepted Database V2 architecture Rev 4.3.2d.**

None of these documents is in force. Each carries its own status block and its
own open-decisions table.

> **Database V2 architecture is finally accepted** — Rev 4.3.2d, C2 FINAL:
> **A. ✅ ARCHITECTURE ACCEPTED FOR ISOLATED V2 IMPLEMENTATION.** Every
> architecture dependency this pack carried is **closed**. What remains open is
> owner, legal/regulatory and deployment — not architecture.
>
> **Acceptance is of a design.** No V2 implementation exists, destructive
> operations remain **prohibited** (G-3 = FAIL), and real-patient use remains
> **unauthorized**.

| # | Document | Architecture dependency | Approvable now? |
|---|---|---|---|
| D1 | [Data Policy V2](../data-policy.md) | ✅ closed | **Most sections yes.** Retention, closure, correction, jurisdiction and contact need owner + legal |
| D2 | [Clinical Data Classification](clinical-data-classification.md) | ✅ closed | **Yes** — 12 categories, 4 open items |
| D3 | [Platform Role Governance](platform-role-governance.md) | ✅ closed | **Yes** — nine roles, reconciled |
| D4 | [Clinical Record Lifecycle](clinical-record-lifecycle.md) | ✅ closed | **Yes for principles.** Retention durations need owner + legal |
| D5 | [Personal Vault vs Clinical Documents](personal-vault-and-clinical-documents.md) | ✅ closed | **Yes** — the scoped-share blocker is resolved |
| D6 | [AI / Service-Agent Governance](ai-service-agent-governance.md) | ✅ closed | **Yes** |
| D7 | [Public Health Advisory Governance](public-health-advisory-governance.md) | ✅ closed | **Yes** |
| D8 | [Pilot Operations](pilot-operations.md) | ✅ closed | **As documentation only. Authorizes nothing** |
| D9 | [Glossary](../glossary.md) | ✅ closed | **Yes** — follows the accepted V2 names |

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
4. **Roles do not nest** — and there are **nine**, with `PLATFORM_OWNER` a designated account rather than a tenth.
5. **Clinical data is never sold and never targets marketing.**
6. **No hard delete of clinical records.** Archive, with a reason, reversible.
7. **Finalised records are corrected, never rewritten.**
8. **Revocation is prospective.**
9. **A path, a link and an identifier are never authorization.**
10. **AI output is a draft.**
11. **Operational audit carries names, never clinical values.**
12. **No retention period, jurisdiction or regulatory claim is asserted anywhere.**
13. **The Owner Control Center reports without reading** — aggregate control-plane data only, never clinical records.
14. **Recording consent belongs to each participant**, never routed through the patient's authority.
15. **Geography is configuration, not architecture** — Bangladesh is seed data, not an assumption.

---

## Marker conventions

| Marker | Meaning |
|---|---|
| `PENDING OWNER DECISION` | A product/commercial decision. Not invented here |
| `PENDING OWNER + LEGAL/REGULATORY DECISION` | Needs qualified advice. **Every retention duration is one of these** |
| ~~`PENDING LOOP F + C2 ARCHITECTURE ACCEPTANCE`~~ | **Retired 2026-09-03.** Architecture is accepted; no marker of this kind remains in the pack |
| `PENDING TECHNICAL VERIFICATION` | Answerable by checking, not deciding |

**Nothing in this pack resolves a marker.** Where an unresolved decision affected
wording, the principle is stated and the mechanism is left open — deliberately,
because a guess written into a policy is quoted back as a commitment.

---

## Relationship to other lanes

| Lane | Relationship |
|---|---|
| **Loop F** — Database V2 architecture | **Authoritative on structure and naming, and now ACCEPTED (Rev 4.3.2d).** These documents state properties the architecture satisfies; they never specify mechanism. D9 follows Loop F's names |
| **Loop C2** — red team | **Final: architecture ACCEPTED (Rev 4.3.2d).** Its findings are closed; no policy here is pending on one |
| **Loop A / B** — clinical, commercial | Consume these documents; do not modify them |
| **Loop E, Voice** | On hold / queued. Voice appears only as the standing draft-only rule |

**Precedence.** Where these documents and an accepted Doctor's Diary decision
(an ADR, `CLAUDE.md`, or the Loop F architecture) disagree, **the accepted
decision wins** and the conflict is reported rather than silently resolved.
