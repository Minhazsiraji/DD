# Frozen Integrity Manifest (engineering copy)

> **This file is engineering checking-metadata, not governance.** CENTRAL is the
> authoritative source for what is frozen, since when, and under what authority.
> This document exists so MD2 / CSU / CAE can verify frozen blobs offline
> without reconstructing the list by hand. If this file and Central disagree,
> Central wins — and this file is the thing that is wrong.

- **CAE-01 base SHA:** `9ec7127611dd5576f9591cbd210be8075b8626ee`
- **Pinned repository `main`:** `5d58f154a8fd18129e28614ccc038f0a6af66b8f`
- Machine-readable copy: [`tools/repo-health/frozen-manifest.json`](../../tools/repo-health/frozen-manifest.json)

## Locked artifacts

Hashes are **git blob object ids** — `git hash-object <path>` — the same form the
candidate-verification workflows under `.github/workflows/` already assert.

| ID              | Path                                                        | Blob hash (`git hash-object`)              |
| --------------- | ---------------------------------------------------------- | ----------------------------------------- |
| 0041            | `supabase/policies/0041_prescription_correction_window.sql` | `b89f8759d737afee950567788a715ba9a947f175` |
| 0042            | `supabase/policies/0042_m3_prescription_reuse.sql`          | `f0d61c8ba472a57513eb0065a294a2ff65a09b69` |
| 0043            | `supabase/policies/0043_m3_signed_medicine_history.sql`     | `16b417bf3117d4e19bb9c52383af5e8608f59a91` |
| 0044            | `supabase/policies/0044_m3_prescription_print_audit.sql`    | `139684e77ef6fa2c5414611c32dfd8c6b9113524` |
| 0045            | `supabase/policies/0045_prelaunch_sec01b_security_closure.sql` | `56a606e200a9f6ea43dd33e572511193a17a5f5a` |
| globals.css     | `src/app/globals.css`                                       | `9e5d07175e729f142b4cff5574ded5af5a61bdbf` |
| print-sheet.tsx | `src/features/prescriptions/components/print-sheet.tsx`     | `0b8afc336ff27faa0a33eaf22f6a8eac1b236c36` |

**Status at CAE-01 base `9ec7127`:** all seven verified `OK` (see the
[repository-health baseline](./repository-health-baseline.md)).

## Verify offline

```
node tools/repo-health/repo-health.mjs            # frozen-artifacts section
node tools/repo-health/repo-health.mjs --strict   # exit 2 on any drift
```

or by hand:

```
git hash-object supabase/policies/0041_prescription_correction_window.sql
# → must print b89f8759d737afee950567788a715ba9a947f175
```

## Related in-repo integrity checks (not maintained by CAE)

These workflow steps assert the same or overlapping sets and remain the
authoritative gates for their milestones:

- `.github/workflows/int-sec01-verify.yml` — "Frozen M3 exact tree integrity",
  "Accepted SEC-01B exact preservation"
- `.github/workflows/pa1-terra-name-fix02.yml` — "Scope main and frozen integrity"
  (also pins `origin/main` to `5d58f154…`)
- `.github/workflows/pa1-terra-schema-01.yml`,
  `.github/workflows/pa1-terra-sem-fix01.yml`,
  `.github/workflows/prelaunch-sec01b-candidate.yml`,
  `.github/workflows/sec01c-dep01-verify.yml` — per-candidate frozen-hash blocks

## Changing this file

Update **only** when Central re-locks an artifact or moves `main`. Edit both this
document and `tools/repo-health/frozen-manifest.json` in the same change, and
record the Central authorization reference.
