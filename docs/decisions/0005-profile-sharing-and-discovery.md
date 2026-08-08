# ADR 0005 — Doctor profile sharing and discovery

**Status:** Accepted · 2026-08-08 · **Not built.** Records constraints only.
**Binds:** any future public profile, share, ratings or ranking work.

## The growth loop this exists for

Bangladesh discovers doctors by asking someone. The product should make that one
tap instead of a phone call:

```
verified doctor → real appointment → completed consultation
     → verified rating → someone shares the profile
     → another person views it → booking
```

Every link in that chain depends on the previous one being *real*. That is the
whole constraint set below.

## Shareable profile

A verified public profile gets a stable URL: `/doctor/{public_slug}`.

`public_slug` is immutable once published — a shared link that later 404s or,
worse, resolves to a different doctor is a trust failure. Slug changes must
leave a permanent redirect behind.

Sharing uses the Web Share API where available (which gives WhatsApp, Messenger,
SMS, email and the native sheet for free), with copy-link as the universal
fallback. No per-platform SDKs.

## Social preview metadata

Open Graph / Twitter cards may contain **only verified, already-public** fields:
photo, name, verified status, specialty, designation, verified qualifications,
aggregate rating, practice location, next availability, branding.

Never in a preview, a URL, or an image: patient data, private doctor detail,
**written rating comments**, private feedback, or internal identifiers.

Preview images are fetched by third-party crawlers with no authentication and
are cached publicly and indefinitely. Treat anything rendered into one as
permanently public.

## A share is not an endorsement

Never generate or display claims like *"best doctor for X"* or *"will cure your
X"*. The platform does not have the evidence, and in a medical context an
unfounded superlative is a safety issue as much as a legal one.

"Recommend" in the UI means *"I'm passing this profile along"*, never a clinical
claim by Doctor's Diary.

## Integrity of ranking and reputation

These three must stay strictly separate:

| Signal | May influence |
|---|---|
| Verified ratings (completed appointments only) | reputation |
| Subscription tier | **software features only** |
| Shares / traffic / virality | **nothing about reputation** |

- Share volume must **not** raise a clinical rating. Otherwise the loop becomes
  self-reinforcing marketing rather than evidence of care.
- Subscription must **not** improve rating, ranking, or verification.
- Sponsored placement, if ever introduced, must be visibly labelled **Sponsored**
  and rendered outside trust-ranked results.

See ADR 0003 for the rating rules these depend on.

## Share analytics

May record: `profile_view`, `profile_share`, `share_channel`,
`booking_started_from_share`, `booking_completed_from_share`.

Must **not** record recipient identity, contact details, or message content —
we deliberately do not learn who someone recommended a doctor to. Aggregate
counts are enough for the product; anything more is surveillance of a private
conversation.

## Competitor research rule

Before building any major patient-facing module (discovery, booking, ratings,
public profiles, telemedicine), review comparable products and record: what they
do well, what users now expect by default, where their workflow breaks down, and
where Doctor's Diary can be better.

Research only. Never copy UI, branding, copy, code, or proprietary features.

## Schema impact

**None now.** `public_slug`, `public_profile_enabled` and the rest are nullable
additive columns on `doctor_profiles`; shares, analytics and sponsorship are new
tables. Nothing in the current schema blocks any of it, and adding fields no
workflow maintains would be worse than adding them later (ADR 0003).
