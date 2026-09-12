# O1 Owner Dashboard — MD2 Visual QA Baseline

Authority base: `7dd53576022fa50706eb5e57a2f34fd59425ad96`

Visual reference: `097955c1b1ce43bcda9b2bc98c141d0487279b4b`

This is a QA contract only. It does not authorize or implement O1 routes, queries, telemetry, RPCs, database work, Owner business logic, or clinical behavior.

## Accepted DD visual stack

Authoritative root order:

1. `globals.css`
2. `branding-logo.css`
3. `canonical-brand.css`
4. `global-background-test.css`
5. `app-unified-liquid.css`
6. `dd-material-system.css`

The root typography at this authority base is **Geist Sans + Geist Mono**. `PageHeader` supplies the established workspace heading hierarchy, and measured values use tabular numerals where appropriate.

The accepted canvas is the lavender/organ treatment from `global-background-test.css` plus `/dd-global-bg.webp`: `#e8e3ee`, fixed organ artwork, pale wash, cover/center placement, 8px blur/1.02 scale on desktop and center-top 7px blur/1.035 scale on mobile.

## Material hierarchy

The accepted rule remains: **glass for shell/chrome/summary; high-readability solid treatment for critical clinical data.**

- Chrome: `dd-material-chrome`, `dd-topbar`, `dd-sidebar`; major chrome owns blur.
- Summary panels: `dd-app-panel`, `dd-material-panel`, `dd-panel-pearl`.
- Child records: `dd-material-record`, `dd-record-pearl`; do not stack another backdrop blur.
- Interactive records: `dd-record-interactive`; hover lift applies only where hover/pointer capability permits and reduced-motion removes motion.
- Quick controls: `dd-quick-row dd-quick-control`; preserve hover/focus behavior.
- Clinical/readability surfaces: `dd-material-clinical` or the existing solid clinical editor patterns.
- Actions: preserve `dd-primary`, `dd-secondary`, and semantic danger/warning/success treatments. Semantic meaning must not be recolored merely for visual uniformity.

## Existing shell baseline

The authenticated `(app)` shell provides `BackgroundCanvas`, a desktop sidebar from `lg` upward (76px at `lg`, 248px at `xl`), sticky 64px Top Bar, mobile bottom navigation, max content width 1400px, and responsive page padding `px-4 py-5` → `sm:px-6 sm:py-6` with mobile safe bottom spacing.

This spacing/material language is a reference only. `/owner` intentionally sits outside the clinical `(app)` shell. Its accepted layout performs `requirePlatformOwner()` and returns children without Doctor/location patient-search chrome. Future O1 Owner chrome may use DD materials and spacing, but visual QA must fail accidental clinical-shell leakage.

At this authority base, `/owner/dashboard` and the requested child routes are not implemented. MD2 does not create them in this lane.

## Accepted component primitives

- **PageHeader:** no own blur layer; narrow-screen column, `sm` row alignment; brand eyebrow, 2xl/28px title, secondary subtitle; actions stack on mobile.
- **GlassCard / GlassPanel:** tone contract `default | strong`; blur explicit. `GlassCard` defaults to flat glass and supports optional interactive hover/focus; `GlassPanel` defaults to blurred strong glass.
- **SectionCard / SectionHeader:** semantic `<section>` with `dd-app-panel dd-material-panel min-w-0 rounded-glass-lg shadow-soft`; SectionHeader uses `dd-section-header`, responsive wrapping, and optional tabular count.
- **StatCard:** summary `GlassCard` with `dd-dashboard-card`; value is top-right, 28px/32px, bold, `text-ink`, `tabular-nums`; existing IconOrb accents are brand/violet/success/warning/danger/info. Color never replaces explicit data truth.
- **StatusBadge:** palette includes neutral/brand/success/warning/danger/critical/info; existing badges always include icon + visible label.
- **EmptyState:** centered; inline state uses `py-10`, page variant uses `min-h-[46vh] py-16`; title, optional description/action. Genuine empty data only—not transport/query failure.
- **Skeletons:** Shimmer is `aria-hidden`; DashboardSkeleton owns `role=status`, `aria-live=polite`, `aria-busy=true`, and responsive geometry to reduce layout shift.

## Dense-list / table QA pattern

No shared generic Table primitive was found in the accepted component inventory audited for this baseline. Current dense lists favor material panels/records; current Owner verification uses responsive cards/definition lists.

If O1 introduces semantic tables: keep semantic rows/columns, contain horizontal overflow inside the table region rather than the page, preserve readable minimum widths, use tabular numerals for metric values, keep row focus/hover visible without adding per-row backdrop blur, and use the O1-approved mobile adaptation without changing data meaning. Failure/unavailability must never become an empty table or numeric zero.

## Metric truth contract

| State | Required rendering | Visual rule | Never substitute |
| --- | --- | --- | --- |
| `0` | literal numeric `0` | normal measured value styling, tabular numeric, high-confidence foreground | dash, blank, placeholder state |
| `Not measured` | exact visible label | neutral nonnumeric absence-of-measurement treatment | `0`, blank, `Unavailable` |
| `Unavailable` | exact visible label | explicit source-unavailable/warning treatment, stronger than Not measured | `0`, blank, ordinary empty state |
| `Insufficient cohort` | exact visible label | informational/privacy/statistical-insufficiency treatment, not error styling | `0`, `Not measured`, `Unavailable`, hidden value |

Color cannot carry these distinctions alone. `Insufficient cohort` is not a failed query; `Unavailable` is not zero; `Not measured` is not unavailability.

## Responsive QA matrix

Future routes:

- `/owner/dashboard`
- `/owner/dashboard/doctors`
- `/owner/dashboard/adoption`
- `/owner/dashboard/ai-usage`
- `/owner/dashboard/costs`
- `/owner/dashboard/pilot-health`
- `/owner/dashboard/security`

Until each route exists, its visual status is **future / not implemented**, not pass or fail.

### 1440×900

Verify canvas visibility; Owner chrome consistency without clinical-shell leakage; heading/action rhythm; unmistakable metric states; no excessive blur stacking; visible hover/focus; readable dense content; no clipping or fixed-element obstruction.

### 1024×768

Verify Owner navigation/content do not collide; panels reflow; state labels and long headings remain readable; table/list overflow is contained; no page-level horizontal scroll; touch targets remain usable.

### 390×844

Verify single-column DOM reading order; no hover-only meaning; all truth-state labels remain visible; table adaptation preserves meaning; controls follow accepted mobile spacing; safe-area/bottom spacing prevents obstruction; canvas/glass stays readable; critical values never sit on ambiguous low-contrast glass.

## CSS-collision checks for future O1 integration

When O1 product files land, compare computed/source behavior for Owner chrome versus `.dd-topbar`, `.dd-sidebar`, `.dd-material-chrome`; panels versus `.dd-app-panel`, `.dd-material-panel`, `.dd-panel-pearl`; row materials versus `.dd-material-record`, `.dd-record-pearl`; semantic status colors; broad `input`, `select`, `textarea`, `.glass*`, `.clinical-surface` selectors; 1279px/767px responsive overrides; reduced-motion and reduced-transparency fallbacks.

Any product CSS/class correction requires a separate Central authorization.

## Appearance regression guard

Settings → Appearance stays an authenticated canvas override only. Default/Restore Default returns to the exact accepted reference canvas. Custom Color/Image apply only after explicit selection. Uploaded image bytes remain local in IndexedDB; no URL upload/server fetch is introduced. Owner pages must not introduce a competing Owner-only body canvas.

## Prescription print isolation

The accepted background owner contains its own `@media print` reset: white `html/body`, no background image, removed `body::before`, no blur/transform. The frozen Prescription `print-sheet.tsx` remains byte-locked by QA. Future O1 visual CSS must not leak backgrounds, fixed chrome, overlays, or material effects into clinical print.

## Screenshot evidence contract

When O1 routes exist and an authenticated browser is available, capture each route at 1440×900, 1024×768 and 390×844. Naming: `o1-owner__<route-token>__<width>x<height>.png`. Record exact app SHA, route, viewport, visible data-state fixtures, any reduced-motion/transparency mode, and pass/fail notes. Never claim a visual pass from a Vercel login screen or an unimplemented route.
