# 0006 — Prescription layout belongs to the doctor, not the clinic

Status: accepted
Date: 2026-08-15

## Context

A doctor's prescription is part of their professional identity. Doctors in
Bangladesh commonly work across a personal chamber, one or two clinics and a
hospital, and the paper differs between them: a hospital may supply pre-printed
pads with its own letterhead, while the private chamber uses blank A4.

Software that reformats a prescription, or that ties the layout to whichever
clinic the doctor happens to be sitting in, is software doctors resent — and
resentment here is fatal, because the prescription is the one artefact the
patient carries home.

## Decision

**A prescription template is owned by `owner_doctor_id`, never by a location.**
`practice_location_id` is nullable and means "this layout applies only here".
Moving between chambers, or leaving a clinic entirely, never loses a template.

Resolution order for "which layout prints here":

1. the doctor's default template scoped to this location, if one exists
2. otherwise the doctor's global default (`practice_location_id is null`)

That rule lives in one pure function, `resolveTemplateForLocation`, so the
prescription engine will use the same logic the preview shows.

**"Exactly one default per scope" is enforced by the database**, with two
partial unique indexes — one for the global default and one per location, since
NULL is not comparable in a unique index. Promotion goes through
`set_default_template()`, a single transaction, so there is never a moment with
zero or two defaults. Application-level enforcement alone loses to a second tab
or a retry.

**Staff never see or edit templates.** All four verbs are restricted to the
owning doctor. A receptionist has no business changing what prints above a
doctor's signature.

**Signatures live in a private Storage bucket** (`doctor-assets`), keyed by
`<auth.uid()>/…`, served only through short-lived signed URLs, capped at 2 MB
and restricted to image MIME types. A signature is a reusable authorisation
mark: a permanently addressable URL is a standing forgery risk. Uploads write a
new path and delete the old one rather than overwriting, so a cached copy can
never render as the previous doctor's mark.

## Consequences

- A doctor who leaves a clinic keeps their layouts. The clinic keeps nothing.
- Two "default" badges can be correct at once (one global, one location). The UI
  must name the scope on the badge, or it reads as a contradiction.
- Deleting a default leaves the scope without one; the UI says so rather than
  silently promoting an arbitrary replacement.
- The template stores **layout only**. Prescription contents — medicines, doses,
  safety checks — are a later phase, and the A4 preview deliberately renders a
  labelled empty body rather than sample medicines. A mock drug name on a page
  shaped like a real prescription is a page somebody eventually prints.

## Not decided here

Printing, PDF generation, and the prescription contents themselves. Also
deferred: whether a clinic can *require* its own header on prescriptions written
on its premises. Today it cannot, and the doctor's choice always wins.
