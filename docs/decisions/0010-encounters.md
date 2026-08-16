# 0010 — The encounter is the clinical record; the appointment stays operational

Status: accepted (Stage 6A — database foundation only)
Date: 2026-08-16

## Context

Stage 4 owns the appointment: when a patient was expected, whether they arrived,
whether they were seen. Stage 5 owns the queue: who is next. Neither holds a
single word of clinical content.

Stage 6 adds what the doctor actually writes. The temptation is to hang clinical
fields off the appointment — it already has doctor, patient, location and a
lifecycle. That would be wrong twice over: a consultation can happen without an
appointment at all, and the appointment row is readable by reception, who must
never see clinical content.

## What already exists and is REUSED, not rebuilt

- `current_doctor_id()`, `owns_patient()`, `can_access_patient_as()` — the
  clinical access helpers from ADR 0001's tenancy rules.
- `may_manage_appointments()`, `doctor_practises_at()`, `runs_front_desk_at()`.
- The appointment lifecycle and `set_appointment_status()`. **The encounter does
  not get its own copy of it.**
- `audit_events` and the ADR 0007 rules about when an audit failure must block.
- The RBAC matrix, which already names `encounter` and `private_notes`.
- The patient timeline, which already has a `consultation` slot switched off.
- The established patterns: RPC-only writes with the direct grants revoked,
  `SECURITY DEFINER` with a pinned `search_path` restating every rule it
  bypasses, `RESTRICT` foreign keys on history, `bigserial seq` +
  `clock_timestamp()` for ordering, and the executed `verify-*.mjs` harness.

## Decision

### 1. What an encounter is

ONE consultation episode: one patient, seen by one doctor, at one location, on
one occasion. It is the parent record for everything clinical that happens in
that episode — complaints, history, examination, vitals, assessment, advice,
diagnoses, investigations, and later the prescription.

### 2. Lifecycle

    DRAFT ──▶ COMPLETED
      └─────▶ CANCELLED

`DRAFT` is the only state in which clinical content may change. `COMPLETED` and
`CANCELLED` are terminal and reject every clinical mutation at the database
boundary.

Deliberately small. Immutable snapshots, amendment-with-reason and reopening
belong to Stage 9, where prescriptions make them meaningful; inventing those
states now would leave transitions nothing can reach.

**This is not a second appointment lifecycle.** An encounter may point at an
appointment, but `appointments.status` is owned by Stage 4 and is never written
from here.

### 3. Appointment-linked versus unscheduled

`appointment_id` is nullable. Both paths are first-class: a patient from the
queue, and a patient who simply walked into the chamber.

When an appointment IS linked, its doctor, patient and location must match the
encounter's. A mismatch is rejected — otherwise an encounter could be attached
to someone else's appointment and inherit its operational context.

**A linked appointment must additionally be `IN_CONSULTATION`.** The doctor
starts the consultation from the queue, using the Stage 4 transition that
already exists; only then can a clinical draft be opened against it. Without
this, a record could be written against an appointment that was cancelled,
never attended, or completed last month — a consultation that operationally
never happened.

`open_encounter()` does NOT move the appointment. Stage 4 owns that transition
and a second route into `IN_CONSULTATION` would be exactly the duplicated
lifecycle this ADR refuses. A patient with no appointment is served by the
unscheduled path, not by relaxing this rule.

### 4. How doctor, patient and location are established

From the SERVER, never the payload:

- doctor — `current_doctor_id()` for the authenticated user
- location — the caller's active location, passed by the server, re-checked
- patient — must be owned by that doctor (`owns_patient`)

A client cannot nominate a doctor, and cannot create an encounter in a location
it is not working in even if it belongs to both.

### 5. One active draft

The active-draft identity, exactly:

| linked to an appointment | `(appointment_id)` where `status = 'DRAFT'` |
| unscheduled | `(owner_doctor_id, patient_id, practice_location_id)` where `status = 'DRAFT' and appointment_id is null` |

Enforced by partial unique indexes, not by application checks — two tabs and a
double-click are the normal case, not the exception. The advisory lock taken
before the lookup uses the same key, including the location.

**Location is part of the identity**, because an encounter is one doctor, one
patient, one location, one occasion. Keying the unscheduled draft on
(doctor, patient) alone meant opening that patient at the chamber could hand
back the draft started at the hospital, after which every write would fail the
location check and the doctor would be stuck in a consultation they could not
save. The same patient seen by the same doctor at a different place is a
different occasion and gets its own encounter.

Creating a draft that already exists AT THIS LOCATION returns the existing one
rather than failing. Resuming is what the doctor meant. A draft open elsewhere
is never returned and never mutated from here.

### 6. Concurrency and stale saves

Every clinical write is a compare-and-swap on an integer `version`. A save
carrying an old version is REJECTED, not merged and not overwritten.

Last-write-wins is unacceptable here: two tabs open on one consultation would
silently discard whichever set of notes lost the race, and nobody would know
which. The rejection is a distinct, recognisable outcome so the UI can keep the
doctor's unsaved text and let them reconcile.

Locks are per-row and never held across user interaction.

### 6a. The patch contract

Every clinical write takes a jsonb patch, and all three cases stay distinct:

| key absent | leave the field alone |
| key present with a value | set it |
| key present with JSON `null` | CLEAR it |

`coalesce(p_new, existing)` collapses the first and third into one. That is not
a style preference: it meant a doctor who mistyped a blood pressure could never
remove it, and the record would carry a wrong clinical value permanently.

Keys are whitelisted and type-checked per field; an unknown key is rejected
rather than ignored, so a typo cannot read back as a successful save that
changed nothing. No sentinel values — `-1` is not "no pulse", and `0` is a real
temperature in the wrong unit, not an empty field. A non-integral value for an
integer vital is rejected rather than rounded.

Fields that cannot be cleared because they are the row's meaning — a diagnosis
`label`, its `certainty`, an investigation `name` — reject an explicit null.

### 7. Structured versus free text

Free text: chief complaints, present illness, past history, examination,
assessment, advice. Doctors write differently, and forcing structure produces
either empty fields or lies. Nothing is required to save a draft.

Structured: vitals (numeric, nullable), diagnoses and investigations (their own
ordered rows, so they can be reordered, edited and later attached to a
prescription individually).

Diagnoses and investigations are corrected IN PLACE, through version-checked
update functions that leave `position` and the row id alone. Remove-and-re-add
is not an equivalent: it changes the row's identity, moves it to the end of the
list, and reads in the history as one finding withdrawn and a different one
raised. A doctor fixing a typo did neither.

### 8. Diagnosis coding

Free text is the primary form for Alpha. A `code`/`code_system` pair exists but
stays NULL until a verified source is available — the CLAUDE.md rule against
LLM-generated reference data applies exactly here. No external coding service.

### 9. What reception can see

**Nothing clinical. Not one field.**

Reception's legitimate need is operational: has the consultation started, is it
still going, is it finished. That is served by a narrow function returning a
status and timestamps only — never a row from the encounter table.

Granting reception the row and hiding fields in the UI is not a boundary; RLS
filters rows, not columns (the lesson from Stage 3, which cost a rebuild).

A colleague doctor at a shared location gets nothing either. There is no
care-team sharing rule in this product yet (ADR 0001), so there is nothing to
honour.

### 10. Clinical history versus operational audit

TWO mechanisms, deliberately separate:

- `encounter_events` — the CLINICAL change history. Doctor-only, append-only,
  and it MAY contain clinical detail because it lives behind the same
  doctor-only boundary as the encounter itself.
- `audit_events` — the OPERATIONAL trail. Records that an encounter was created
  or updated, by whom, where. It carries ids and field NAMES only, never
  clinical values, because it is readable by roles that must never see them.

Getting this backwards is how clinical text leaks into an admin-readable log.

## Consequences

- Deleting a patient, doctor, location or appointment cannot erase clinical
  history: those foreign keys are `RESTRICT`, as in Stage 4.
- A doctor who changes their mind mid-consultation edits the draft freely; once
  completed, corrections wait for Stage 9's amendment path.
- The prescription (Stage 7) will reference `encounter_id`, so the encounter is
  the join point — no separate "consultation" concept will be introduced.

## Not decided here

Immutable finalisation snapshots, amendment with reason, reopening a completed
encounter, print/PDF, voice drafting, AI assistance, and follow-up scheduling.
All are later stages and none of them changes the shape above.
