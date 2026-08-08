# ADR 0002 — A public patient account is not a patient record

**Status:** Accepted · 2026-08-08
**Binds:** Phase 3 (patients), Phase 4 (appointments), and any future public platform.

## Decision

Two different things, permanently separate, that both describe "a patient":

| | `patients` | `patient_accounts` *(future)* |
|---|---|---|
| What it is | A doctor's **clinical record** | A human's **login for booking** |
| Owned by | `owner_doctor_id` | the person |
| Created by | the doctor | the person, on signup |
| Exists today | Phase 3 | not yet |
| Contains clinical data | yes | **never** |

One human booking with two doctors produces **one** account and **two**
independent clinical records:

```
patient_accounts (one human)
   ├── books Doctor A ──► patients(owner_doctor_id = A)   history A
   └── books Doctor B ──► patients(owner_doctor_id = B)   history B
                                    (never joined)
```

## Why it must be settled before Phase 3

`patients` is created in Phase 3. If it is built assuming the doctor's record
*is* the person's identity, then adding public booking later requires either
splitting rows or merging histories — both unacceptable.

## Constraints this places on Phase 3

1. `patients` carries a **nullable** `patient_account_id`. Null is the normal
   case: most patients are walk-ins the doctor typed in, and will never have an
   account. Never make it required.
2. **`patient_account_id` must never appear in a clinical RLS policy predicate.**
   Authorization keys off `owner_doctor_id` and `practice_location_id` only.
   The moment a policy joins on the account, one doctor's records become
   reachable from another's — the exact failure this ADR exists to prevent.
3. Linking a record to an account is **consent-based and per-doctor**. An
   account link never propagates to another doctor's record.
4. Deduplication operates strictly **within one `owner_doctor_id`**. There is no
   global patient identity and no cross-doctor merge.
5. `patient_number` stays per-doctor (`doctor_profiles.patient_number_prefix` +
   `patient_number_seq`). It is meaningless outside that doctor's repository.

## Why `patient_accounts` will be its own table, not a flag on `profiles`

`profiles` already means "an authenticated human", and a patient account is
exactly that — so a future patient signs up into `profiles` like anyone else.
`patient_accounts` then holds the booking-side persona, mirroring how
`doctor_profiles` holds the clinical-side one.

No `account_type` column on `profiles`: personas are proven by the existence of
a `doctor_profiles` / `patient_accounts` row, which lets one human be both (a
doctor booking their own appointment) without a contradictory type field.

## Consequences

- A doctor cannot see that their patient also sees another doctor. Intended.
- "Verified rating" resolves as
  `appointment → patients → patient_account_id`, so only the human who actually
  attended can rate. See ADR 0003.
- If a person deletes their public account, the doctors' clinical records
  survive — they are the doctors' records, not the person's copy.
