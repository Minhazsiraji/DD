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

**The freeze happens before the review the doctor approves — not after it.**

This is the correction that matters most in this document, and the reasoning is
short. The frozen object's identity is *inside* the canonical bundle, and the
digest covers it. So freezing **changes the digest**:

```
before freeze   bundle.signature = null            digest = ABC
after  freeze   bundle.signature = { objectId… }   digest = XYZ
```

An earlier draft of this ADR had the doctor approve `ABC` and then had the
system freeze a signature and finalise `XYZ`. That is not a smaller version of
the same thing — it is the doctor approving one document and a different one
becoming permanent. `finalize_prescription()` would in fact have refused it with
`REVIEW_STALE`, correctly, because it rebuilds the bundle and compares. The
contract was right; the workflow around it was backwards.

So Stage 7C-2A is a **review-preparation** step, not a finalisation step:

```
DRAFT
  │
  ├─ "Prepare for final review"                    ← 7C-2A
  │     server verifies session, doctor, active location, prescription, DRAFT
  │     FREEZE (service role)
  │         read the source object from doctor-assets
  │         write <uid>/<rx-id>/signature into prescription-assets
  │         VERIFY what is now at the destination
  │
  ├─ fetch a FRESH canonical bundle
  │     it now observes the frozen object; the digest is new
  │
  ├─ doctor reads THAT bundle, including the actual frozen signature image
  │
  ├─ doctor approves THAT digest                   ← 7C-2B
  │
  └─ finalize_prescription(…, digest)
        rebuilds the same authoritative bundle
        digest matches → FINALIZED
```

The invariant this preserves is the one the whole design rests on:

> what the doctor sees → what the digest represents → what becomes immutable
> must be exactly the same thing.

Two consequences for the UI, both binding on 7C-2B:

- **The approval control stays disabled until the doctor is looking at a
  post-freeze bundle.** A screen showing `signature: null` may never offer
  approval.
- **The review must render the actual frozen signature image**, retrieved
  through a short-lived authorised URL — not a line labelled "Signature". Today's
  7C-1 preview draws the empty block because nothing is frozen yet and drawing
  the doctor's *live* profile signature would show them something the bundle
  does not attest. That is correct for 7C-1 and must change in 7C-2B.

A frozen object with no finalised prescription is a harmless orphan. A finalised
prescription with no signature is an unprintable permanent clinical record. The
order follows from which of those we would rather have — and, now, from the fact
that the signature must be inside the thing being approved.

## Idempotency and the retry rule

The destination is `prescription_signature_path(uid, rx_id)` — one path per
prescription, forever, so a retry writes the same place. Uploads use
`upsert: false`, and the bucket has no UPDATE policy, so a second write cannot
overwrite the first.

**"The path exists, therefore the signature is trustworthy" is not good enough.**
A partially-written or unexpected object must not become the immutable signature
merely because the name matches.

### The integrity contract, as implemented

Metadata is **not** the control. `metadata.eTag` is not a documented stable
application contract in Supabase's storage schema, and for a medical signature
the cost of not relying on it is negligible — these are a few kilobytes.
Verification is over the **actual bytes**:

```
read source bytes (ONCE)      →  expected = sha256(bytes)
upload to destination, upsert:false
read destination bytes         →  found    = sha256(bytes)
found === expected             →  frozen
found !== expected             →  hard refusal + alert
```

- The source is read **once** and held for the whole attempt. That is what
  closes the race below: the bytes hashed are the bytes written.
- The read-back happens on **both** paths — after our own write, because "the
  API returned success" is not "the right bytes are stored"; and after
  `already exists`, because a path collision is precisely the case where
  trusting the name would be worst.
- **A mismatch is a hard refusal, never an overwrite.** It cannot be repaired,
  because the bucket is append-only by design. It is an operational alert and
  the doctor is told plainly.
- A write that storage accepts but cannot read back is reported as
  **unverifiable**, never as a failure — the same Stage 7B rule that keeps an
  uncertain outcome from being retried into a duplicate.

The computed hash may additionally be attached as custom object metadata for
diagnostics. It must never *replace* the byte comparison.

### File operations go through the Storage API

Never `INSERT INTO storage.objects`. Supabase treats that schema as read-only
metadata; a direct row insert produces an entry with no object behind it, which
reads as success and prints as a broken image on a prescription. Verification
scripts may *read* `storage.objects` — that is how RLS is asserted — and may
write it to build a fixture, but application code never does.

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
| Approval attempted on a pre-freeze bundle | Refused — the control is not offered, and `finalize_prescription` would raise `REVIEW_STALE` anyway |
| Freeze runs twice for one prescription | One object, one identity, one digest |

The standard: **no incorrect prescription, no duplicate finalisation, no mutable
historical asset, and safe retry.**

## What the browser may never do

- supply a frozen signature path;
- write to `prescription-assets` by any route;
- construct or submit snapshot JSON;
- decide that a freeze succeeded.

It holds the prescription id, the selected template id, the expected version,
the canonical bundle and its digest. Nothing else.

## What "Stage 7C-2A" is called, and why it matters

The user-facing action is **"Prepare prescription for final review"**, never
"Finalize". A doctor pressing it has not approved anything and nothing becomes
immutable; they have asked the system to fix the signature so that there is
something complete to read. Naming it as finalisation would make the irreversible
step feel like it had already happened one screen early — which is the same class
of mistake as approving a bundle before the signature is in it.
