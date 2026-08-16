# 0008 — Reception registers patients through a doctor-selection RPC

Status: accepted — to be implemented in Stage 4
Date: 2026-08-16

## Context

The permission matrix grants `RECEPTIONIST: patient RW`, but RLS restricts
patient creation to the owning doctor, so reception currently cannot register
anyone. That mismatch was flagged during Stage 3 review and deferred.

It has to be resolved for Stage 4, because booking an appointment usually starts
at the reception desk with a person who is not yet in the system.

The obvious fix — relaxing the patient INSERT policy so receptionists may insert
— is wrong. `patients.owner_doctor_id` is the ownership boundary for the entire
product (ADR 0001). A policy permissive enough to let a receptionist choose that
value is a policy that lets a receptionist place a record into any doctor's
repository, including a doctor at another location.

## Decision

**Do NOT broaden the patient INSERT policy.** Registration by reception goes
through a dedicated `SECURITY DEFINER` RPC that establishes ownership itself:

1. Reception selects a doctor practising at the **active location**.
2. The function verifies, in the database, that BOTH the calling receptionist
   and the selected doctor hold an ACTIVE membership at that location. The
   caller's location comes from their own membership rows, never from the
   payload.
3. `owner_doctor_id` is set to the **selected doctor** — never to the caller,
   and never to a value the client supplied directly.
4. The patient is linked only to that active location.
5. The audit event records the receptionist as the actor and the doctor as the
   owner. "Who typed it" and "whose patient it is" are different facts and both
   must survive.

**Reception may write demographics and contact details only.** No diagnoses, no
medications, no alerts, no private notes — consistent with the column isolation
already enforced in `0004_clinical_column_isolation.sql`. Allergies remain
readable by reception (they already are) but the clinical lists are not theirs
to populate at registration.

**Duplicate detection runs inside the selected doctor's repository only.**
Searching across doctors to spot a duplicate would leak the existence of another
doctor's patient, which ADR 0001 forbids outright.

## Consequences

- One more plpgsql function in the `create_patient()` family, and the two must
  not drift. A change to patient creation has to be applied to both.
- The registration UI needs a doctor selector when the actor is a receptionist,
  and it must be absent when a doctor registers their own patient.
- `verify-patients.mjs` gains executed cases: a receptionist registering for a
  doctor at their location succeeds; registering for a doctor who is NOT active
  at that location fails; the created row is owned by the doctor and not by the
  receptionist.

## Duplicate protection, and the cost we accepted

Reception's duplicate check searches ONLY patients the caller can already see.

An earlier version searched the doctor's whole repository and returned a count
of matches reception was not allowed to see. That removed the identity but kept
the EXISTENCE — and because the RPC is granted to every front-desk user, it
could be probed with names and phone numbers to learn whether a doctor has a
matching private patient. Withholding it in the UI closes nothing.

Privacy wins. The check now behaves identically whether or not a chamber-only
match exists, which means reception CAN create a duplicate of a patient the
doctor only sees privately. That is a real cost, taken deliberately: a duplicate
is repairable by the doctor later; a disclosure is not.

Two supporting controls, because neither can live in the client:

- the normalised name and phone are DERIVED in the database from the raw values.
  While they were parameters, an honest name could be paired with a dishonest
  search key and walk straight past the guard.
- registration takes transaction-scoped advisory locks on (doctor, name) and
  (doctor, phone) before checking. "Check and insert in one transaction" does
  not serialise two transactions — both can read no-candidate and both insert.

## Not decided here

Whether a doctor can later reassign a patient to another doctor. Today they
cannot, and nothing in this decision creates that path.

**REQUIRED LATER — doctor-only duplicate review and merge.** The privacy
decision above guarantees that duplicates will occasionally be created against
chamber-only records. Only the owning doctor can see both sides, so only they
can resolve it. This is a known, scheduled debt, not an oversight; it must not
be bolted onto a later stage opportunistically.
