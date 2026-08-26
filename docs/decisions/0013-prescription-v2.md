# ADR 0013 — Prescription V2: doctor-configurable modules, bundle v4

Status: accepted (decisions supplied by the owner, 2026-08-25)
Supersedes nothing. Extends ADR 0011 (prescriptions) and ADR 0012 (signature freeze).

## Context

The pilot doctor's complaint was not that the prescription lacked fields — it
was that there was too much to type. Different doctors also write different
prescriptions: one wants Chief Complaint → Diagnosis → Investigations → Advice,
another wants History → Examination → Diagnosis → Advice → Next Visit, and a
third wants only Diagnosis → Rx → Advice.

So the prescription becomes doctor-configurable, and entry becomes explicit
quick selection rather than typing. What must NOT change is the clinical record
underneath, or any prescription already finalised.

## Decisions

### 1. Clinical modules are doctor-owned. A NEW table, and this is a deviation.

The instruction was to reuse `prescription_templates` "if the existing model can
safely represent this". It cannot, and the reason is structural rather than
stylistic.

`prescription_templates` carries a NULLABLE `practice_location_id`, and
`resolve_prescription_template()` walks a location → global → system chain. That
is exactly right for PAPER: a hospital's letterhead differs from a private
chamber's, and the owner confirmed that behaviour stays.

Clinical module preferences must be the opposite: they follow the doctor across
every chamber and must be INCAPABLE of varying by location. Storing them on a
location-scopable row would let the schema express a state the product forbids,
and "doctor-owned" would survive only as a convention in the resolver — the
class of thing this project has repeatedly found rotting.

So: `doctor_prescription_modules`, keyed on `doctor_profile_id` and `module`
alone. There is no location column to misuse. This is not a second prescription
template; the paper template is untouched and still resolves as it always did.

### 2. Two ownerships, held apart on purpose

    clinical modules   doctor            which sections, what order, what label
    paper identity     doctor + location paper size, margin, letterhead, footer

A doctor's clinical style follows them. A chamber's paper does not.

### 3. Bundle schemaVersion 3 → 4, and no second mechanism

The existing invariant already solves historical immutability:

    IF THE APPROVED DIGEST COVERS IT, FINALISATION PRESERVES IT.

`review_bundle_snapshot` stores the entire approved bundle, so a frozen render
configuration inside the bundle is automatically preserved, automatically
covered by the digest, and automatically reproduced on reprint. Nothing new is
invented.

v4 adds:

    renderConfig   the resolved module list — module, label, order — as it was
                   at the moment of approval, printable modules only
    layout         "two-column" for v4; absent on v3
    frozenFacts    patient-level values (allergies, long-term medicines) copied
                   at approval time, ONLY when the doctor prints them

### 4. v3 renders as v3. Forever.

A v3 snapshot has no `renderConfig`, and its Investigations and Advice printed
FULL WIDTH BELOW Rx. That is how it must keep printing. The renderer branches on
`schemaVersion`, not on a feature flag and not on the presence of a field —
a missing field is how a layout silently changes.

v4 moves Investigations and Advice into the configurable left column, obeying
`show_on_print`, position and empty-section omission, and prints them nowhere
else.

### 5. Patient-level facts are FROZEN when printed

Allergies and long-term medicines are patient-level and longitudinal: they
change after the prescription is signed. Printing them therefore copies their
VALUES into `frozenFacts` at approval, and a reprint years later shows what was
true that day.

Rendering a historical prescription from today's `patient_allergies` would make
the paper disagree with itself over time. Off by default; only frozen when the
doctor turns printing on.

### 6. Symptoms and Next Visit get real columns

Neither exists today. Overloading `present_illness` or `advice` would make the
record lie about what the doctor wrote. `encounters.symptoms` is free text like
its neighbours; `encounters.next_visit_note` plus `next_visit_on` is the
minimum that prints usefully and freezes cleanly. No follow-up automation.

### 7. Favourites are doctor-owned, explicit, and never written by typing

One table, one row per reusable phrase per doctor per kind, with a usage counter
bumped only when the doctor APPLIES one. Typing creates nothing. Applying one
inserts text into a field the doctor is already editing — it never writes a
clinical row by itself, so a quick selection costs no round trip.

## Consequences

- A doctor who changes their template does not change any prescription already
  finalised, because the old one carries its own `renderConfig`.
- A prescription finalised before V2 keeps its exact appearance.
- The two-column layout invalidates every page-count boundary measured for the
  single-column flow. They are re-measured, and the harness that measures them
  becomes permanent rather than temporary.
- `500g` still prints as `500g`. Nothing in V2 touches strength, dose, schedule,
  duration or instruction text.
