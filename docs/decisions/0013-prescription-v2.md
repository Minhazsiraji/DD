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

### 8. The renderer is chosen from `schemaVersion`, by exact match

`renderer-version.ts` holds one table: `2 → v3-linear`, `3 → v3-linear`,
`4 → v4-modular`. Not a comparison, not field presence, not a feature flag, not
the template.

`version >= 4 ? v4 : v3` reads like the same rule and is not: it says "and
everything after 4 as well", so a v5 bundle carrying something v4 never had
would reach a renderer that cannot see it and print a SHORTER prescription than
the one approved, silently. An unknown version is therefore refused outright and
the reader is told the build is old — `UnsupportedSnapshot`, never a blank sheet
and never a fallback.

`SUPPORTED_BUNDLE_SCHEMA_VERSIONS` is derived from that same table. "We accept
this bundle" and "we can print this bundle" must be one statement; as two lists
they drift, and the drift has exactly one shape — a bundle that parses cleanly
and then reaches a switch with no case for it.

The two shapes are also mutually exclusive at the schema: a v4 bundle carrying
top-level `investigations`/`advice` is refused, and so is a v3 bundle carrying
`sections`. Either would be content that was approved and then silently absent
from the paper.

### 9. `layout` is a frozen arrangement, named — not a hint

`two-column` does not mean "two columns, somehow". It names one arrangement and
always the same one: every configured module down the left, the Rx alone on the
right. Which side a module lands on is part of what the doctor approved, so a
build that shuffled it would reprint signed prescriptions differently.

A different arrangement is therefore a NEW TOKEN, and old snapshots keep
rendering under the old one — the same discipline as `schemaVersion`, one level
down. `placeSections()` is the whole contract and a test pins it. Per-section
left/right placement is not doctor-configurable in this stage; when it becomes
so, the placement moves INTO the section rows and the token names that.

An unrecognised layout token is refused, because placement is precisely what
would be guessed.

### 10. An unfamiliar module still prints

`section.module` is a plain string, not an enum of the twelve this build knows.
A section carries its own label and its own shape, so a module added by a newer
server is fully printable; printing it under its own heading is strictly safer
than dropping it, and safer than refusing the whole prescription. Nothing
chooses content from the module name — it is used for placement and as a
harness hook only.

### 11. The two-column band is a table row

`column-count` reflows one column into the other, which would run medicines into
the clinical column. A flex row fragments unevenly across engines. A two-cell
table row is the construct browsers have paginated reliably since printing
existed: each cell continues on the next page in its own column, and nothing is
duplicated. `vertical-align: top` is load-bearing — a table cell centres its
content, which would float a short complaint into the middle of a long medicine
list.

Every module off means no column at all: the medicines take the full width,
rather than an empty 61 mm strip with a rule down it asking the reader what is
missing.

## Consequences

- A doctor who changes their template does not change any prescription already
  finalised, because the old one carries its own `renderConfig`.
- A prescription finalised before V2 keeps its exact appearance.
- The two-column layout invalidates every page-count boundary measured for the
  single-column flow. They are re-measured, and the harness that measures them
  becomes permanent rather than temporary.
- `500g` still prints as `500g`. Nothing in V2 touches strength, dose, schedule,
  duration or instruction text.
