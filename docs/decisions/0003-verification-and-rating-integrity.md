# ADR 0003 — Verification and rating integrity

**Status:** Accepted · 2026-08-08
**Binds:** any future public doctor profile, rating, or subscription work.
**Not built yet.** This records the rules so the schema does not foreclose them.

## Verification

`doctor_profiles.bmdc_registration_no` is **self-asserted**. Nobody has checked
it. Today that is fine — it prints on the doctor's own prescriptions.

The moment a profile becomes publicly discoverable it stops being fine: an
unchecked registration number displayed on a public page reads as a credential
the platform has confirmed.

**Rule:** never render a professional claim publicly without a verification
state that says it was checked.

States: `UNVERIFIED` (default) · `PENDING` · `VERIFIED` · `REJECTED` · `SUSPENDED`.
A profile is discoverable only at `VERIFIED`.

Not added as a column now — see "Why no schema change" below.

## Ratings

A rating is a claim about a real encounter, so it must be anchored to one:

```
appointment (status COMPLETED)
   └── exactly one rating, by the patient who attended
```

- No completed appointment → no rating. Not "hidden"; **not creatable.**
- Uniqueness is enforced on `appointment_id`, not on (doctor, patient) — that
  is what makes it one-rating-per-visit rather than one-per-lifetime.
- A rating never crosses doctors. It belongs to the doctor on that appointment.
- Ratings are immutable after a short edit window; deletion is moderation only,
  and audited.

### Public vs private

| Visible publicly | Visible to patient, doctor, and moderation only |
|---|---|
| Aggregate scores per category | The written comment |
| Number of ratings | The doctor's private reply |

Written comments are **private**. A doctor must be able to see criticism and
reply without it becoming a public dispute, and a patient must be able to be
candid without publishing it.

### Subscription must never touch reputation

Paid tiers may unlock **software features**. They must never influence
displayed rating, ranking, or verification. Encoding a commercial relationship
into a trust signal is the failure mode that discredits a directory, and it is
not reversible once users notice.

Concretely: no subscription field may participate in computing an aggregate
rating or a search ordering that is presented as quality.

## Why no schema change now

`doctor_profiles` gains `verification_status`, `public_slug`, `bio`, etc. as
**nullable additive columns** whenever the public profile is actually built.
Adding a column with `DEFAULT 'UNVERIFIED'` is cheap and backfills correctly.

Adding them now would create fields nothing reads or maintains — and a
`verification_status` column that no workflow ever updates is worse than no
column, because it looks authoritative while meaning nothing.
