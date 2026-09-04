# Doctor's Diary — Canonical Brand Assets

Locked by the owner on 2026-09-04.

## Canonical logo

Use the owner-supplied glossy blue + teal DD notebook logo as the source of truth.
The UI-safe derived mark is stored at:

- `public/brand/dd-logo-mark-canonical.webp`

Do not replace it with a generic medical icon, initials, or an unrelated logo treatment without explicit owner approval.

## Canonical primary action colour

Primary CTAs and active/selected interactive controls use the owner-approved violet liquid button treatment referenced in `src/app/canonical-brand.css`.

Use it for:

- primary CTAs
- primary form submission actions
- active navigation where the design calls for an emphasized state
- selected tabs / selected filters

Do not use it to replace clinical semantic colours such as success, warning, danger, allergy severity, or other safety indicators.

## Implementation

- `src/app/canonical-brand.css` is loaded last to keep this lock authoritative.
- `src/components/brand/brand-mark.tsx` renders the canonical DD mark.
