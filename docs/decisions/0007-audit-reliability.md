# 0007 — When a failed audit write must stop the clinical action

Status: accepted
Date: 2026-08-16

## Context

`emitAudit` currently swallows every failure: it logs to the server console and
lets the user's action succeed. That was the right default for sign-in, where
blocking a doctor because a log row could not be written would be absurd.

It is the wrong default for clinical finalisation. A finalised prescription with
no audit row is a legal and clinical artefact that the system cannot account
for — and `FINALIZED` records are never edited (see CLAUDE.md), so the gap can
never be repaired by a later correction.

The two cases are genuinely different, and treating them the same is what makes
the current behaviour wrong.

## Decision

**Fail closed — the clinical write and its audit event go in the SAME database
transaction, and neither lands without the other:**

- finalising a prescription
- finalising an encounter
- amending a finalised clinical record
- creating or deleting clinical document metadata

Because the audit row must share the transaction, these paths cannot use the
current fire-and-forget `emitAudit`. They write the audit row inside the same
plpgsql function that performs the clinical change, in the manner of
`create_patient()`.

**Transactional where practical, but not blocking:** appointment and queue
status changes. Prefer the same-transaction form; do not fail the operation if
only the audit write fails.

**Never blocks — but must raise an operational alert:** viewing a patient
record. A doctor mid-consultation must not be locked out of a record because
logging is degraded. The failure is real and must be visible to us, so it
escalates beyond a console line rather than being swallowed.

**Separate mechanism:** failed sign-ins. These are security telemetry, not
clinical audit, and must not depend on a session that by definition does not
exist yet. Today they fail with `permission denied for table audit_events`,
which is observable proof they need their own server-side path.

## Consequences

- `emitAudit` stays as-is for the non-blocking cases and is explicitly NOT the
  mechanism for the fail-closed list. Reviewers should treat an `emitAudit` call
  next to a finalisation as a bug.
- Every fail-closed clinical operation needs a plpgsql function, which is
  already the established pattern here for multi-table writes.
- "Audit write failed" becomes a user-visible error state on finalisation. The
  message must tell the doctor the record was NOT saved, not merely that
  logging failed — otherwise they will assume the clinical part succeeded.
- We need an operational alerting path for the view case. Until one exists, the
  view case degrades to a console line and that gap is known, not accepted.

## Not decided here

The alerting transport. Free-tier constraints apply (see CLAUDE.md — no paid
services without approval), so this is likely a database table plus a review
surface rather than an external monitoring service.
