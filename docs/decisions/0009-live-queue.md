# 0009 — The live queue is a projection, not a second lifecycle

Status: accepted
Date: 2026-08-16

## Context

Stage 4 already models the day: an appointment carries a status
(`SCHEDULED → CONFIRMED → ARRIVED → IN_CONSULTATION → COMPLETED`), a
`session_date` in the location's timezone, and a `token_number` allocated at
arrival under a shared counter.

A Bangladeshi chamber runs on that serial. Patients arrive, take a number, and
an assistant calls them. The obvious way to build it is a `queue_entries` table
with its own status — `WAITING / CALLED / IN_ROOM / DONE / SKIPPED`.

That would be a mistake. `IN_ROOM` and `DONE` are restatements of
`IN_CONSULTATION` and `COMPLETED`, and Stage 4's most expensive bug was exactly
this shape: a row and its history disagreeing after a race. Two tables both
claiming to know whether the patient is with the doctor would drift the first
time an update failed halfway, and the queue screen is the one place where being
wrong is immediately visible to a waiting room.

## Decision

**Queue membership is DERIVED from the appointment, never stored.**

    waiting        status = ARRIVED
    with doctor    status = IN_CONSULTATION
    finished       status IN (COMPLETED, CANCELLED, NO_SHOW)

There is no queue status column. "Start the consultation" and "finish" go
through the existing `set_appointment_status()` — the queue does not get its own
way to move a patient, because a second write path is a second thing that can
disagree.

**`queue_entries` stores only what an appointment genuinely does not know**, one
row per appointment:

- `called_at`, `call_count` — an announcement is not a state change. A patient
  can be called three times and still be sitting outside.
- `skipped_at` — they did not answer. Still ARRIVED, still owed a consultation,
  just no longer at the front.
- `priority`, `priority_reason` — see below.

**Order is computed, not maintained.** No `position` column: a stored ordering
has to be renumbered on every insert, skip and priority change, and every one of
those is a chance to corrupt it under concurrency. The order is

    priority DESC, then token_number ASC

with skipped patients removed from the main line and shown separately, because
that is what actually happens — the assistant calls them again when they appear,
rather than the system silently reinserting them at a position nobody chose.

**Priority always carries a reason.** An elderly patient, a child, someone
visibly unwell, or a doctor's instruction are different justifications, and a
queue that lets people jump without recording why is a queue that will be
accused of taking money to do it. The reason is required by the database, not
by the form.

**Skipping and calling are audited but never fail closed.** They are
operational, not clinical (ADR 0007): losing an audit row for "called serial 12"
must not stop the clinic. Finalising a consultation still fails closed.

## Consequences

- The queue cannot show a patient the appointment list disagrees about, because
  there is only one source for "where are they up to".
- A patient who is cancelled or marked no-show leaves the queue automatically.
  No cleanup, no second write.
- Tokens are per (location, session day) — a Stage 4 decision. Where two doctors
  share a location they share one serial run, and each doctor's screen filters
  to their own patients. Per-doctor serials would be a schema change and are not
  in scope.
- `queue_entries` rows are created lazily on first call/skip/priority action, so
  arriving does not require a second write and the token path stays as it is.

## Not decided here

Public-facing displays (a waiting-room screen or a patient's phone) — that is
Production 2, and it needs a consented, non-identifying view. Nothing here
exposes patient names outside the clinic's own authenticated staff.
