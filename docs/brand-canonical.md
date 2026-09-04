# Doctor's Diary — Canonical Brand + UI/UX Lock

Locked by the owner on 2026-09-04 and extended after visual approval on the `ui/organ-bg-preview` branch.

This document is the source of truth for all future Doctor's Diary presentation work unless the owner explicitly changes it.

## 1. Canonical logo

Use the owner-supplied glossy blue + teal DD notebook logo as the source of truth.
The UI-safe derived mark is stored at:

- `public/brand/dd-logo-mark-canonical.webp`

Do not replace it with a generic medical icon, initials, heart-cross mark, or another logo treatment without explicit owner approval.

## 2. Canonical background

Public/auth preview pages use the owner-approved organ artwork as the background canvas.

Rules:

- keep the artwork globally consistent across pages;
- keep it visually softened/blurred so content remains readable;
- UI content stays sharp;
- do not introduce a different background treatment on login, signup, or other public/auth pages;
- preserve the same light, lavender/pink/aqua atmosphere.

## 3. Canonical liquid-glass material

The approved material stack is:

`canvas -> external light pools -> transparent glass slab -> rim iridescence -> wet gloss/specular -> inner contour -> live content`

Use the implementation in:

- `src/app/approved-liquid-material.css`
- `src/app/organ-bg-polish.css`

Core visual rules:

- near-transparent slab center, never milky opaque cards by default;
- strong white refractive perimeter;
- engraved inner contour;
- localized cyan / mint / pink / violet edge reflections;
- soft floating depth/shadow;
- glossy highlight/streak on the rim;
- clinical text remains high contrast and readable;
- the same material family must be used across Home, Login, Signup, public pages, and later application shell/components.

## 4. Header is a shared canonical component

The approved Home header is the source of truth for all public/auth pages.

Use:

- `PublicGlassHeader` from `src/components/marketing/marketing-shell.tsx`

Do not create separate login/signup headers with different width, composition, materials, or actions. Reuse the same component so Home and auth screens remain visually identical.

Canonical header contains:

- DD logo + Doctor's Diary wordmark/tagline;
- Features / How it works / Pricing / Security / FAQ navigation on desktop;
- aqua secondary `Sign in` action;
- violet primary `Start free` action;
- same glass slab, rim, contour, blur, lighting, spacing, and responsive behavior everywhere.

## 5. Canonical action hierarchy

### Primary CTA

Primary actions use the owner-approved glossy violet -> blue liquid treatment in `src/app/canonical-brand.css`.

Use it for:

- Start free;
- primary form submission;
- primary clinical actions when appropriate;
- active/selected navigation states where emphasis is required.

### Secondary action

Secondary/general navigation actions use the owner-approved aqua liquid treatment represented by the `Consultation` reference.

Use it for:

- Sign in;
- See founding plan;
- View the plan;
- Secure access;
- secondary non-destructive actions where an emphasized but non-primary control is appropriate.

Do not use violet/aqua action colours to replace semantic clinical colours such as success, warning, danger, allergy severity, or other safety indicators.

## 6. Typography and readability

- primary headings: deep navy/violet;
- body text: dark blue-grey with strong contrast;
- avoid tiny grey text;
- avoid low-contrast copy over bright organ artwork;
- use text shadow/light support only where required, not as decoration;
- keep Inter + Noto Sans Bengali as the product typography direction.

## 7. Component consistency rule

Every page must feel like the same Doctor's Diary product.

Do not independently redesign:

- header;
- card material;
- button family;
- inputs;
- chips/tabs;
- navigation;
- background atmosphere;
- logo treatment.

New components must inherit the same canonical visual tokens/material before page-specific variation is added.

Priority remains:

`SPEED -> CLARITY -> SAFETY -> LOW TYPING -> CONSISTENCY -> BEAUTY`

For dense clinical workflows, reduce decorative glass intensity before sacrificing readability or consultation speed.

## 8. Implementation authority

- `src/app/canonical-brand.css` is loaded last to keep brand/action lock authoritative.
- `src/components/brand/brand-mark.tsx` renders the canonical DD mark.
- `src/components/marketing/marketing-shell.tsx` owns the canonical public/auth header.
- `src/app/approved-liquid-material.css` owns the canonical refractive glass construction.
- `src/app/organ-bg-polish.css` owns organ-background preview contrast/material adjustments.

Any future UI work should reuse these components/tokens first rather than create a competing design system.
