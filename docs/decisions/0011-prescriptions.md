# 0011 — Prescriptions

Status: accepted
Date: 2026-08-17

## Context

The prescription is the one artefact the patient carries home. It is read by a
pharmacist who has never met us, kept in a drawer for years, and produced again
when something goes wrong. Everything below follows from that.

Stage 7A is the DATABASE ONLY: schema, RLS, RPCs, events, the finalisation
contract and its verification. No composer, no medicine search, no print, no
PDF, no voice, no AI.

## Decisions

### 1. A prescription is its own aggregate

It has its own `version` and its own compare-and-swap. It does NOT read or
increment `encounters.version`.

Sharing the encounter's version would make every medicine keystroke conflict
with every note keystroke: two documents a doctor edits in the same sitting
would fight over one counter, and Stage 6's coordinator would have to arbitrate
between them. They share an ENCOUNTER ID and nothing else.

### 2. Identity is derived, never supplied

`encounter_id` is the only identity the caller gives. The owning doctor, the
patient and the practice location are read FROM THAT ENCOUNTER inside the RPC.

A caller cannot name a different doctor, a different patient or a different
location, because it is never asked. This is the same rule the encounter itself
follows, and for the same reason: an honest payload paired with a dishonest key
is how a record ends up under the wrong name.

### 3. One draft, one chain, per encounter

- At most ONE `DRAFT` prescription per encounter, enforced by a partial unique
  index — two tabs and a double-tap are the normal case.
- Opening resumes that draft rather than creating a second.
- A `FINALIZED` prescription is NEVER reopened.
- A correction creates a NEW prescription that points at the one it replaces
  (`replaces_prescription_id`) with a reason. The finalised row is not touched.
- At most one direct replacement per prescription, enforced by a partial unique
  index — the same lineage-forgery guard the appointment reschedule chain uses.

**One logical chain per encounter, for the pilot.** If a finalised prescription
already exists on an encounter, a new draft MUST replace the newest finalised
link in that chain; it cannot start a parallel branch. The alternative —
several independently finalised prescriptions per encounter — is legitimate in
some practices (one for the patient, one for a procedure) but it forces every
reader to decide which one is "current", and a pharmacist holding one of two
valid papers is exactly the ambiguity this stage should not ship. Revisit when
a real practice asks for it; the `replaces_prescription_id` chain is the
migration path.

### 4. Who may see what

| | draft | finalised |
| owning doctor, any of their locations | read + write | read |
| receptionist / location admin, at that location | **never** | read (handover) |
| colleague doctor at a shared location | never | never |

A draft is a doctor thinking aloud. Handing it to reception — or to a colleague
who merely shares a hospital — is the same mistake as showing them the clinical
note, and ADR 0001 has no care-team sharing rule to appeal to.

Staff visibility additionally requires `may_see_patient()`, so the existing
chamber-only patient boundary continues to apply, and the reading path is bound
to the ACTIVE location, so a receptionist at one clinic cannot read another's
paperwork by holding a membership somewhere else.

Staff may never create, edit, remove items from, finalise, void or replace a
prescription. Reading and printing is the whole of their power.

### 5. Medicine lines — one representation each

Free text for the pilot (approved). NO `generic_id` / `brand_id` columns: a
foreign key with no catalogue behind it is a promise the schema cannot keep,
and the identity model has to be chosen with the catalogue, not before it.

| column | meaning |
| `display_name` | what prints — the only required medicine field |
| `brand_name`, `generic_name` | optional, recorded when the doctor states both |
| `strength_text` | the PRODUCT's strength: "500 mg", "125 mg/5 ml" |
| `dose_text` | what the PATIENT TAKES: "1 tablet", "½ tablet", "5 ml" |
| `dosage_form`, `route` | "Tablet", "Syrup" / "Oral", "Topical" |
| `schedule_text` | "1+0+1", "প্রতি ৮ ঘণ্টা", "twice daily" |
| `duration_text` | "7 days", "১০ দিন", "continue" |
| `quantity_text` | optional: "30 tablets", "1 bottle" |
| `food_relation` | "After food", "Empty stomach" |
| `is_prn` | as-needed |
| `instructions` | free text, Unicode/Bangla |
| `substitution_allowed` | boolean |
| `position` | the doctor's order, closed up on removal |

**Strength is not dose.** "500 mg" is what the tablet contains; "1 tablet twice
daily" is what the patient does. Storing only strength leaves a pharmacist
inferring the instruction, which is precisely the inference nobody should be
making from a prescription.

**ONE canonical representation per concept.** There is no `frequency_code`
BESIDE a `frequency_struct`, and no numeric duration beside a duration string.
Two independently editable fields describing one instruction WILL disagree —
and the printed paper and the "machine truth" disagreeing about how often a
patient takes a drug is a worse failure than having no machine truth at all.

Structured scheduling is deferred until something actually consumes it
(interaction checking, AI, dispensing integration). When it arrives the rule is
fixed in advance: the printable text is DERIVED from the structure inside the
database, or validated against it in the same transaction. Never stored twice
and edited separately.

### 6. Finalisation

Only the owning doctor. One transaction, and it fails entirely if any step
fails:

1. lock the prescription row
2. check the expected version (CAS)
3. confirm it is still `DRAFT`
4. confirm doctor ownership and that the active location matches the row
5. validate every item (at least one item; each has a printable name)
6. resolve the template and doctor identity being approved
7. store the immutable snapshots
8. mark it `FINALIZED`
9. write the clinical `prescription_events` row
10. write the operational `audit_events` row
11. commit, or nothing

A finalised prescription and its items reject every content UPDATE and DELETE —
including direct SQL from an authenticated session, because the grants are
revoked and the RPCs refuse a non-draft.

### 7. Snapshots

A finalised prescription must still print correctly after the doctor changes
their name, qualifications, BMDC number, chamber details, template, footer or
signature, and after the patient's demographics are corrected.

So the finalised row carries `snapshot_schema_version` plus four jsonb
snapshots: doctor, location, patient, template. Only what the paper needs —
a patient's phone number, address and private notes are not on the prescription
and are not copied into it.

**Never snapshot a signed URL.** They expire, and a prescription that stops
printing after an hour is not a record. The signature is referenced by an
immutable STORAGE PATH under `prescription-assets/<prescription_id>/`, a bucket
whose policies allow insert and select but no update and no delete for anyone.
Deleting the profile signature afterwards cannot reach it.

Stage 7C must show the doctor exactly what is being snapshotted and finalise
against THAT: the review screen resolves the template and identity, displays
them, and passes the resolved values into `finalize_prescription`, which
re-resolves and refuses if they no longer match. A template edited in another
tab between preview and approval must produce a refusal, not a silent
substitution.

### 8. Two histories

- `prescription_events` — clinical lifecycle, doctor-only, may name items.
- `audit_events` — actor, action, ids, version, field names. **Never** a
  medicine name, dose, schedule or instruction.

Which drug a patient was given is clinical. That a prescription was finalised is
operational. Getting these backwards puts drug names in a log a location
administrator can read.

All history-critical foreign keys are `RESTRICT`. Deleting a patient, encounter,
doctor or location cannot erase a prescription, and deleting a prescription
cannot erase its events.

## Consequences

- `VOIDED` exists in the status enum and nothing in 7A sets it. The void path,
  the correction UI and print all belong to 7C; the chain and the immutability
  rules are in place so they remain possible.
- Autocomplete in 7B reads the doctor's own previously finalised items. No
  catalogue, no monographs, no invented drug facts.
- `architecture.md` described encounters as `FINALIZED`/`AMENDED` with
  `encounter_revisions`. ADR 0010 is authoritative: `DRAFT → COMPLETED |
  CANCELLED`. The document is corrected in this stage, and prescription
  immutability is owned by the prescription aggregate, not by encounter
  snapshots that do not exist.

## Not decided here

Medicine catalogue and identity, interaction checking, structured schedules,
dispensing, patient-facing copies, and whether a practice ever needs several
independently finalised prescriptions on one encounter.
