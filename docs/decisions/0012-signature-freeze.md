# ADR 0012 — Freezing a prescription's signature

**Status:** planned (Stage 7C-2A). Nothing in this document is built yet.
**Supersedes nothing.** Extends ADR 0011 §6–7.

## The problem

A finalised prescription must print identically forever, including its
signature. The doctor's profile signature is theirs to change — they can replace
it or delete it tomorrow — so a finalised prescription cannot reference it.
It needs its own frozen copy.

Copying an object into storage and marking the prescription FINALIZED are two
different systems. **They cannot be one transaction.** Postgres can roll back;
S3-compatible storage cannot enlist in that rollback. So the design cannot aim
for atomicity. It has to be *recoverable*, and it has to fail in the direction
that does the least harm.

## The two trust classes

| | `doctor-assets` | `prescription-assets` |
|---|---|---|
| Holds | the doctor's profile signature | frozen clinical snapshots |
| Written by | the doctor, from the browser | trusted server code only |
| Path | `<uid>/signature-<ts>.<ext>` | `<uid>/<rx-id>/signature` |
| Replaceable | yes | never |
| INSERT policy | yes, own uid prefix | **none** |
| UPDATE / DELETE policy | delete allowed | **none** |

The second column had an INSERT policy until the storage correction that
precedes this stage. It let the owning doctor pre-create the destination and,
because the bucket has no UPDATE or DELETE policy, that planted object would
have been permanent — attested by the review bundle and printed as the frozen
signature. The path is derivable from the prescription id, so secrecy was never
the control. Removing the write privilege is.

Closing the clinical bucket must not cost a doctor the ability to manage their
own profile signature. The two buckets stay separate for exactly that reason,
and the verification asserts both halves.

## Order of operations

Freeze **first**, finalise **second**.

```
doctor asks to finalise
        │
        ├─ server verifies session, doctor, active location, prescription,
        │  still-DRAFT, and that the review digest still matches
        │
        ├─ FREEZE (service role)
        │     read the source object from doctor-assets
        │     write <uid>/<rx-id>/signature into prescription-assets
        │     VERIFY what is now at the destination
        │
        └─ finalize_prescription(...)   ← rebuilds the bundle, which now
                                           observes the frozen object
```

A frozen object with no finalised prescription is a harmless orphan. A finalised
prescription with no signature is an unprintable permanent clinical record. The
order follows from which of those we would rather have.

## Idempotency and the retry rule

The destination is `prescription_signature_path(uid, rx_id)` — one path per
prescription, forever, so a retry writes the same place. Uploads use
`upsert: false`, and the bucket has no UPDATE policy, so a second write cannot
overwrite the first.

**"The path exists, therefore the signature is trustworthy" is not good enough.**
A partially-written or unexpected object must not become the immutable signature
merely because the name matches. On finding an object already at the
destination, trusted code must verify it is *the expected object* before
treating the freeze as done:

- the source object is read and its identity recorded (`storage.objects.id`,
  `metadata.size`, `metadata.mimetype`, and `metadata.eTag` where Supabase
  populates it — the eTag is the strongest content-derived value the existing
  storage model exposes);
- the destination is compared against those values;
- a match means the freeze already succeeded — proceed;
- **a mismatch is a hard refusal, never an overwrite.** It cannot be repaired
  automatically, because the bucket is deliberately append-only. It is an
  operational alert, and the doctor is told the prescription cannot be finalised
  right now.

The review bundle already attests object identity (`objectId`, `path`, `size`,
`mimetype`) rather than mere existence, and the digest covers it — the Stage
7C-1 suite proves that changing the frozen object's metadata changes the digest.
Verification therefore has a definition of "the expected object" that the doctor
has already approved.

## Orphans

An object under `prescription-assets/<uid>/<rx-id>/signature` whose prescription
is still DRAFT after a threshold is an orphan from a freeze that never
finalised.

For the pilot: **report, do not delete.** Cleanup would be service-role only,
and automatically deleting frozen clinical assets is a larger risk than the
storage cost of leaving them. If a doctor retries, the same path is reused and
the orphan becomes the real signature.

## Source deletion

The source is **not** deleted after a successful freeze. It is the doctor's
profile signature and the source for their next prescription. Only the
superseded copy is removed when a doctor uploads a replacement, which is
existing Stage 2.6 behaviour.

## Retrieval

`may_read_prescription_asset(name)` — the owner by path prefix, or anyone who
`may_hand_over_prescription(rx)`: FINALIZED only, front desk or location admin
at that location, and only for patients they may see. Unauthorised retrieval
returns **zero rows and no error**, so tests must assert from the returned rows,
never from the absence of an error.

Delivery uses short-lived signed URLs generated per request. **No signed URL is
ever stored** — not in `prescriptions`, not in `prescription_events`, not in
`audit_events`. `signature_asset_path` holds the path; a URL that expires would
turn a permanent record into a temporary one.

## Failure tests required before 7C-2B

| Scenario | Required outcome |
|---|---|
| Copy succeeds, DB finalisation fails | DRAFT intact, orphan object, retry succeeds |
| Request dies after the copy | Same; next attempt reuses the path |
| Retry after timeout | Idempotent; exactly one finalisation |
| Two finalise requests race | One wins; loser gets `PRESCRIPTION_VERSION_CONFLICT` or `PRESCRIPTION_NOT_DRAFT` |
| Source signature missing before freeze | Refuse before any DB write |
| Destination already exists, matching | Treated as success |
| Destination already exists, **not** matching | Hard refusal, alert, no overwrite |
| Ordinary user tries to create the frozen object | Refused (asserted today) |
| Ordinary user tries to replace or delete it | Refused (asserted today) |
| Unauthorised retrieval | Zero rows, asserted from rows |

The standard: **no incorrect prescription, no duplicate finalisation, no mutable
historical asset, and safe retry.**

## What the browser may never do

- supply a frozen signature path;
- write to `prescription-assets` by any route;
- construct or submit snapshot JSON;
- decide that a freeze succeeded.

It holds the prescription id, the selected template id, the expected version,
the canonical bundle and its digest. Nothing else.
