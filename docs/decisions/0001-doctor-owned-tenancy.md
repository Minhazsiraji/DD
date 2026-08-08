# ADR 0001 — Doctor-owned tenancy, location-scoped events

**Status:** Accepted · 2026-08-08 (final; supersedes an earlier clinic-owned proposal)
**Binds:** every table, query and policy in the product.

## Decision

Two orthogonal questions, permanently separate:

```
owner_doctor_id        whose patient is this?
practice_location_id   where did this event happen?
```

Doctor's Diary is a **doctor-owned personal clinical repository**, not a
clinic-owned EMR.

- Each doctor has a **completely separate** patient repository.
- The same human seen by two doctors is **two records**. No global patient
  identity, no cross-doctor merge, dedupe, or visibility.
- Within one doctor's repository, visits at a hospital, a clinic, a personal
  chamber and telemedicine form **one continuous timeline**.
- **Staff access is location-scoped** via `practice_location_members` plus the
  session's active location. Reception at Location A never sees Location B.
- The owning doctor sees their full longitudinal history across their own
  locations. Nobody else does.

## Why

Every clinic already runs its own system. The product's value is the doctor's
own continuous record of their own patients, across every place they work.

Pure clinic-owned tenancy would split one person into one record per clinic and
destroy that continuity. Pure doctor-owned with no location scoping would let a
receptionist hired at one chamber see activity from all of them.

## Why it is irreversible

Neither direction is a cheap migration afterwards:

- doctor-owned → clinic-owned requires **splitting** records
- clinic-owned → doctor-owned requires **merging** them

Both are lossy and require clinical judgement per row. This is why it was
settled before the `patients` table existed.

## Consequences

- Cross-doctor referral must be **explicit, consented and audited** — never
  ambient. It is a share, not a join.
- A public booking account is a separate identity from the clinical record.
  See ADR 0002.
- Deduplication is meaningful only inside one `owner_doctor_id`.
