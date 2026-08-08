# ADR 0004 — A practice location is not a facility

**Status:** Accepted · 2026-08-08
**Binds:** public discovery ("find doctors at Square Hospital"), schedules.

## The situation today

`practice_locations` means *"a place where **this doctor** practises"*. Each row
is created by one doctor and owned through `practice_location_members`.

So if forty doctors practise at Square Hospital, there are forty rows named some
variation of "Square Hospital" — plus typos, plus abbreviations.

That is **correct** for what the app does today: it is the doctor's own list of
where they work, and their schedule, fees and staff hang off it.

It is **wrong** for public search, which needs one canonical Square Hospital
that forty doctors point at.

## Decision

Keep `practice_locations` as the doctor-scoped concept. Do **not** try to make
it double as a shared directory entity.

When public discovery is built, add a separate `facilities` table for the
real-world place, and a nullable `practice_locations.facility_id` pointing at
it. Rows without a link (a personal chamber, a home visit) simply stay null —
which is most of them, and correct.

```
facilities (Square Hospital, curated, one row)
   ▲
   │ facility_id (nullable)
   │
practice_locations (Dr A @ Square, Dr B @ Square, Dr C's chamber)
```

## Why not fix it now

The link is **additive and backfillable**: a later matching pass plus admin
curation can populate `facility_id` without touching a single existing row's
meaning. Nothing about today's schema blocks it.

Building a facilities directory now would mean maintaining a curated national
list of hospitals before a single patient can search — cost with no current use.

## The risk being accepted

Backfilling forty spellings of "Square Hospital" into one canonical row is
tedious and imperfect. That work is real and deferred deliberately.

Mitigation available cheaply whenever discovery starts: normalise on entry
(trim, collapse whitespace, case-fold for comparison) and suggest existing
nearby names at creation time. Not worth building before it is needed.
