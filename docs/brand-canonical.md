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
- `src/app/app-unified-liquid.css`

Core visual rules:

- near-transparent slab center, never milky opaque cards by default;
- strong white refractive perimeter;
- engraved inner contour;
- localized cyan / mint / pink / violet edge reflections;
- soft floating depth/shadow;
- glossy highlight/streak on the rim;
- clinical text remains high contrast and readable;
- the same material family must be used across Home, Login, Signup, public pages, and the authenticated application shell/components.

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

For authenticated pages, the existing left sidebar + top bar information architecture remains. Only the visual material changes to the same canonical liquid-glass family.

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

## 8. Authenticated application layout lock

The authenticated application keeps the existing placement / information architecture from `main`.

Do not move modules merely to make the liquid design look different.

Examples:

- Dashboard keeps the same `main` placement: greeting -> 4 summary cards -> Work now + Recent patients on the left -> Quick actions on the right.
- Left sidebar stays in its current desktop position.
- Top context/search bar stays in its current position.
- Patients / Appointments / Queue / Consultation / Prescription retain their accepted workflow order and responsive placement.

The UI task is to **skin the existing application**, not rearrange it.

## 9. Hover / interaction lock

Existing card interaction behavior is part of the approved UX.

- interactive dashboard / patient / summary cards keep their current upward hover movement;
- do not remove or neutralize the existing `hover:-translate-y-*` / raised-card behavior;
- the liquid-glass styling may change rim light, shadow, gloss, or colour on hover, but must not remove the movement;
- reduced-motion preferences remain respected.

## 10. App-wide presentation implementation

`src/app/app-unified-liquid.css` is the shared authenticated-app skin. It is presentation-only and must not change page logic, routing, clinical rules, permissions, or data behavior.

It applies the canonical language to:

- app top bar;
- left sidebar;
- mobile bottom navigation;
- dashboard summary cards;
- patient cards;
- section cards;
- clinical surfaces;
- inputs/search/select/textarea;
- quick actions;
- primary/secondary actions;
- consultation/prescription containers.

Clinical/dense content uses a more opaque version of the same material so readability and safety remain stronger than decoration.

## 11. Implementation authority

- `src/app/canonical-brand.css` owns canonical brand/action colours.
- `src/app/app-unified-liquid.css` owns the authenticated app-wide visual skin.
- `src/components/brand/brand-mark.tsx` renders the canonical DD mark.
- `src/components/marketing/marketing-shell.tsx` owns the canonical public/auth header.
- `src/app/approved-liquid-material.css` owns the canonical refractive glass construction.
- `src/app/organ-bg-polish.css` owns organ-background preview contrast/material adjustments.

Any future UI work should reuse these components/tokens first rather than create a competing design system.
