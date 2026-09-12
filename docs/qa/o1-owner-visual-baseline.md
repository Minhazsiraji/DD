# O1 Owner Dashboard — MD2 Visual QA Baseline

Authority base: `7dd53576022fa50706eb5e57a2f34fd59425ad96`

Visual reference: `097955c1b1ce43bcda9b2bc98c141d0487279b4b`

This document is a QA contract only. It does not authorize or implement O1 routes, queries, telemetry, RPCs, database work, Owner business logic, or clinical behavior.

## 1. Accepted DD visual stack

Root order is authoritative and must remain:

1. `globals.css`
2. `branding-logo.css`
3. `canonical-brand.css`
4. `global-background-test.css`
5. `app-unified-liquid.css`
6. `dd-material-system.css`

Typography at the root uses Geist Sans, Geist Mono, and Manrope. Workspace headings use the existing `PageHeader` hierarchy; metric values use tabular numerals where the product already marks clinical/value content.

The accepted global canvas is the lavender/organ treatment from `global-background-test.css` plus `/dd-global-bg.webp`: `#e8e3ee`, fixed organ artwork, 28% pale wash, cover/center placement, 8px blur/1.02 scale on desktop, and center-top 7px blur/1.035 scale on mobile.

## 2. Material hierarchy

The accepted rule remains: **glass for shell/chrome/summary; high-readability solid treatment for critical clinical data.**

- Chrome: `dd-material-chrome`, `dd-topbar`, `dd-sidebar`; major chrome owns blur.
- Summary/major panels: `dd-app-panel`, `dd-material-panel`, `dd-panel-pearl`.
- Child/list records: `dd-material-record`, `dd-record-pearl`; child records must not stack an additional backdrop blur.
- Interactive records: `dd-record-interactive` retains hover lift only for hover-capable fine pointers and removes motion under reduced-motion preferences.
- Quick controls: `dd-quick-row dd-quick-control`; preserve existing hover/focus behavior.
- Clinical/high-readability surfaces: `dd-material-clinical` or the existing solid clinical editor patterns where values/actions require stronger contrast.
- Primary/secondary actions: keep the accepted `dd-primary` / `dd-secondary` families and semantic danger/warning/success colors. Do not recolor semantic states merely to make Owner pages visually uniform.

## 3. Existing shell baseline

### Authenticated clinical app shell

The `(app)` shell currently provides:

- `BackgroundCanvas`
- desktop sidebar from `lg` upward: 76px rail at `lg`, 248px at `xl`
- sticky 64px Top Bar
- mobile bottom navigation
- page content max-width 1400px
- page padding `px-4 py-5`, expanding to `sm:px-6 sm:py-6`, with mobile bottom-nav safe spacing.

This is the visual spacing reference, not permission to reuse clinical navigation in Owner.

### Owner boundary

`/owner` is intentionally outside the `(app)` clinical shell. The accepted Owner layout currently performs only `requirePlatformOwner()` and returns its children. The existing `/owner` page explicitly documents that Owner administration must not inherit location context, patient search, or clinical navigation.

Therefore future O1 Owner chrome may use the accepted DD material language, spacing rhythm, typography and responsive behavior, but QA must fail any accidental import of Doctor/location clinical shell concepts solely for visual convenience.

At the authority base, `/owner/dashboard` and its requested child routes are not implemented. MD2 must not create them in this lane.

## 4. Existing component primitives

### `PageHeader`

- no extra blur/surface of its own
- column on narrow screens, row/action alignment from `sm`
- 2xl/28px title scale, brand eyebrow, secondary subtitle
- actions stack full-width on mobile and collapse to intrinsic width on `sm+`

### `GlassCard`

Variants: `default`, `subtle`, `strong`; rounded 2xl, border + material shadow, with the existing global glass layer supplying final accepted appearance.

### `SectionCard`

Wraps `GlassCard`; section header uses `dd-section-header`, flex-wrap, 5-unit horizontal padding, and 4-unit vertical padding; content uses 5-unit padding.

### `StatCard`

Accepted value hierarchy: uppercase muted label, `text-2xl font-extrabold tracking-tight text-ink` value, optional muted hint. Current icon tones are brand / blue / green. O1 must not overload those tones to encode data truth without explicit text.

### `StatusBadge`

Accepted semantic tones: `neutral`, `info`, `success`, `warning`, `danger`. A badge's label must remain present; color alone is not the meaning.

### `EmptyState`

Centered, deliberately spacious (`py-10`) with title, optional description and action. Empty-state text must describe genuine empty data, not transport/query failure.

### Skeletons

`Shimmer` is `aria-hidden`; the containing dashboard skeleton owns `role=status`, `aria-live=polite`, and `aria-busy=true`. Skeletons mirror final box geometry to minimize layout shift.

## 5. Dense-list / table QA pattern

There is no shared generic Table primitive in the accepted component inventory audited for this baseline. Current dense application lists favor material panels/records (for example patient cards) and Owner verification currently uses responsive cards/definition lists.

If O1 implementation introduces semantic tables, MD2 QA will judge them against these rules rather than inventing business structure:

- use semantic table markup where the O1 implementation genuinely represents columns/rows;
- never allow the entire page to overflow horizontally;
- contain horizontal overflow inside the table region when a true table must remain tabular;
- preserve readable minimum column widths rather than compressing numbers/labels into ambiguity;
- use tabular numerals for metric values;
- keep row hover/focus visible without adding a second blur layer per row;
- at 390px, use the O1-approved responsive adaptation (contained scroll or record/card representation) without changing data meaning or column truth;
- failures/unavailability must not be rendered as an empty table or numeric zero.

## 6. Metric truth contract

These four states are visually and semantically different and must never collapse into one fallback:

| State | Required rendering | Visual rule | Forbidden substitutions |
| --- | --- | --- | --- |
| `0` | literal numeric `0` | normal measured metric/value styling; tabular numeric; high-confidence foreground | `—`, blank, muted placeholder, status badge implying missing data |
| `Not measured` | exact nonnumeric label | neutral absence-of-measurement treatment; subdued but readable | `0`, dash-only, blank, `Unavailable` |
| `Unavailable` | exact label | warning/source-unavailable treatment; stronger attention than Not measured; explicit text | `0`, blank, ordinary empty state |
| `Insufficient cohort` | exact label | informational/privacy/statistical-insufficiency treatment; explicit text; distinct from warning and neutral absence | `0`, `Not measured`, `Unavailable`, hidden value |

Color must not carry the distinction by itself. The exact visible text is mandatory. `Insufficient cohort` is not an error and must not look like a failed query. `Unavailable` is not proof of zero. `Not measured` is not proof of unavailability.

## 7. Responsive QA matrix

Every future route below is to be checked at all three canonical viewports. Until a route exists, its status is **future / not implemented**, not pass/fail.

Routes:

- `/owner/dashboard`
- `/owner/dashboard/doctors`
- `/owner/dashboard/adoption`
- `/owner/dashboard/ai-usage`
- `/owner/dashboard/costs`
- `/owner/dashboard/pilot-health`
- `/owner/dashboard/security`

### 1440 × 900 — desktop

For every route verify: organ canvas remains perceptible through chrome/summary materials; Owner chrome is visually DD-consistent without clinical location/patient shell leakage; headings/actions align to the established page rhythm; metric truth states are unmistakable; cards/tables do not over-stack blur; hover/focus states are visible; dense content fits without clipping; no fixed element obscures content.

### 1024 × 768 — tablet

For every route verify: any Owner navigation adaptation does not collide with content; panels reflow without truncating state labels; long headings/actions wrap safely; tables/list regions contain their own overflow; no page-level horizontal scroll; background remains supportive rather than competing with text; touch targets remain usable.

### 390 × 844 — mobile

For every route verify: one-column reading order follows DOM meaning; no desktop-only hover is required for comprehension; state labels remain fully visible; tables use the approved contained-scroll/card adaptation; controls meet the current mobile height/spacing rhythm; safe-area/bottom spacing prevents obstruction; organ canvas and glass remain readable with the accepted mobile blur; no critical value is placed on ambiguous low-contrast glass.

## 8. CSS-collision checks for future O1 integration

When O1 product files land, MD2 visual QA must compare computed styles and source selectors for:

- Owner shell versus `.dd-topbar`, `.dd-sidebar`, `.dd-material-chrome`;
- major Owner panels versus `.dd-app-panel`, `.dd-material-panel`, `.dd-panel-pearl`;
- record/table rows versus `.dd-material-record`, `.dd-record-pearl`;
- status visuals versus existing semantic danger/warning/info/success rules;
- generic selectors such as `input`, `select`, `textarea`, `.glass*`, and `.clinical-surface` that may unintentionally affect Owner UI;
- responsive overrides at 1279px and 767px;
- reduced-motion and reduced-transparency fallbacks.

A collision requiring product CSS or class changes is a new correction packet; this baseline lane does not fix product UI.

## 9. Appearance regression guard

Settings → Appearance remains an authenticated canvas override only:

- Default / Restore Default returns to the exact accepted DD reference canvas;
- Custom Color and Custom Image apply only after explicit selection;
- image bytes remain local in IndexedDB;
- no URL upload/server fetch is introduced;
- Appearance must not override clinical print output.

Owner pages must observe the same canvas preference because it is rooted at the app body/background layer; O1 must not introduce an Owner-only competing body canvas.

## 10. Prescription print isolation

The accepted background stylesheet contains its own `@media print` override at the layer that owns the organ canvas:

- `html, body` become white;
- background images are disabled;
- `body::before` is removed;
- blur/transform are disabled.

The frozen `print-sheet.tsx` remains byte-locked by QA. O1 visual CSS must not add print-visible backgrounds, fixed chrome, overlays or material effects that survive those rules.

## 11. Screenshot naming / evidence contract

When O1 routes exist and an authenticated browser is available, capture one route × viewport artifact using:

`o1-owner__<route-token>__<width>x<height>.png`

Example: `o1-owner__doctors__390x844.png`.

Each capture must be accompanied by the route, exact application SHA, viewport, data-state fixtures shown, reduced-motion/transparency mode if non-default, and pass/fail notes. Do not claim visual pass from a Vercel login screen or from a route that does not yet exist.
