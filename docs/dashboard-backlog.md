# Doctor Dashboard — UX backlog

**Status: recorded, NOT scheduled.** Captured during Stage 5 so it is not lost.
Do not act on any of it while another module is in progress; the dashboard is
its own task with its own review.

## What is wrong today

- The greeting block is oversized and dominates a screen a doctor opens dozens
  of times a day.
- It shows development-phase information ("Arrives in Phase 10", "What's live so
  far"). That is a note to ourselves, not to a doctor.
- The primary work focus should be the live queue and the next patient. Today
  those are one tile among four.

## Direction when it is picked up

- Compact the greeting; give the space to the queue.
- Show only real data from completed modules. Remove phase placeholders from the
  doctor's view entirely.
- Make the live queue and next patient the centre of the screen.
- **Reuse `get_queue()` and its ordering.** Do not re-derive queue rules in the
  dashboard — that is the duplication ADR 0009 exists to prevent.
- Scope every count to the authenticated doctor AND the active location.
- Distinguish the shared location token number from *this doctor's* next
  patient. At a shared hospital those are different things and conflating them
  will send the wrong person in.
- Keep honest unavailable states. A failed read must never render as zero
  (already true of the appointment counts; keep it true).
- Improve recent-patient and quick-action usability only where the destination
  actually works.
- Preserve the current visual language.

## Explicitly deferred until their modules exist

Drafts, follow-ups, prescriptions, medicine search, documents, payments, reports
and AI clinical shortcuts. A shortcut to a screen that does not exist is worse
than no shortcut.
