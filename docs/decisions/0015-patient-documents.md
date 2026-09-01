# ADR 0015 — Patient documents: ownership, storage and removal

**Status:** accepted for Module D / Phase D1 (`feature/documents-v1`).
**Supersedes nothing.** Applies ADR 0001 (doctor-owned tenancy) and ADR 0007
(audit reliability) to a new clinical table.

## What a document is

A **patient-scoped clinical asset**: a lab report, a scan, a discharge summary,
the prescription some other doctor wrote. It is not a file in a drive. There is
no folder, no sharing, no "documents" that belong to nobody — every row is
anchored to exactly one patient, and the patient is what carries authority.

The same reader has to serve four callers, so it is built for all of them now:
the Documents workspace, the patient record, the consultation screen, and later
Online Consultation and patient-side uploads. Nothing in the table is shaped for
"a doctor uploaded this" specifically — `uploaded_by` is deliberately a separate
question from ownership, so a future receptionist or patient upload changes one
column and no policy.

## Ownership: derived at write time, then guaranteed by the database

`owner_doctor_id` is stored on the row, and it is **not a parameter** of the
write function — `create_patient_document()` reads it from the patient. So a
caller cannot name a doctor.

Storing it at all is a duplication of `patients.owner_doctor_id`, and a
denormalised *authority* column that only application code keeps honest is one
bad write away from being a cross-doctor read. What makes it safe is a composite
foreign key:

```sql
foreign key (patient_id, owner_doctor_id)
  references patients (id, owner_doctor_id)
```

backed by a unique index on `patients (id, owner_doctor_id)`. Postgres now
refuses any pair that is not the patient's actual owner. The copy cannot drift
from the original, including under direct SQL.

The alternative — no column, and an RLS predicate of
`owns_patient(patient_id)` — is equally correct and was rejected for one
reason: a policy that calls a function once per candidate row cannot use an
index, so "list my documents" would walk every doctor's rows to discard them.
The stored column is the leading column of `patient_documents_owner_idx`.

**`practice_location_id` is NOT NULL**, per the tenancy rule that every event
table carries it. It records where the document was filed and is validated
against the caller's own active doctor membership. It is not an access key: a
colleague at that location still reads nothing.

**There is no `appointment_id`.** An appointment is an operational row that
reception can read; hanging a clinical asset off it invites exactly the join
that turns an operational reader into a clinical one. The encounter is the
clinical anchor, and a document filed for a visit with no encounter simply has
none.

## Authority: doctor-only, and no staff authority in V1

`patient_documents_select` is `owner_doctor_id = current_doctor_id()`. One
branch. Not a colleague at the same hospital, not the location administrator,
not reception.

The brief permits operational staff "only where explicitly required for the
upload workflow". Nothing in D1 requires it — the doctor uploads — so nothing is
granted. A staff upload added later is a **new, narrow function that writes a
row it cannot then read back**, not a widening of the read policy. The
upload-side extension point is named in the storage policy.

Writes are RPC-only: `insert`, `update` and `delete` are revoked from
`authenticated` and no write policy exists, so there is no direct path a later
`GRANT` could quietly re-open.

## Storage

A private bucket, `patient-documents`, 10 MB, `application/pdf`, `image/jpeg`,
`image/png`. Path:

    <owning doctor's auth user id>/<patient id>/<random uuid>.<ext>

The **first segment is the owner, not the uploader.** Today they are the same
person. Writing the read policy against the owner is what lets a future
receptionist or patient upload change the INSERT rule alone and find the read
rule already correct.

The last segment is a fresh uuid and never the original filename. A filename is
attacker-controlled text: it must not choose a path, an extension, a content
type, or anything else that carries authority. The extension is derived from the
file's **own bytes**, sniffed server-side — `file.type` arrives from the browser
and is a claim, not a fact.

The path is re-derived and checked inside the write function, not trusted:
exactly three segments, segment one the caller's auth id, segment two this
patient, segment three a uuid with an accepted extension. Storage RLS already
confined the write to segment one; this pins the other two, so a metadata row
can never describe an object it does not own.

Reading is by **short-lived signed URL, minted server-side**. Supabase requires
SELECT on the object before it will sign, so a link cannot be minted for an
object the caller could not have read, and the raw path never reaches a browser.

## Removal: archive, never delete

**The application never destroys a clinical document.** `archive_patient_document`
sets `archived_at`, `archived_by` and a required `archive_reason`; the row stays
and the stored object stays. Archived documents leave the working list and
remain reachable under an explicit filter, and `restore_patient_document` undoes
it.

Considered and rejected:

- **Hard delete.** A clinical asset that one click destroys forever is the
  failure that cannot be undone.
- **No removal at all.** A report attached to the wrong patient is a real and
  urgent problem. It must be removable from the working record.
- **A separate `patient_document_events` history table.** The existing
  `audit_events` row already carries who and when, the reason lives on the row,
  and there is exactly one state transition in each direction. A second history
  table earns its keep when the state machine is bigger than this one.

The storage object is deliberately **not** deleted on archive, and there is no
UPDATE or DELETE policy on the bucket at all — so `remove()` deletes nothing.
Retention and erasure are open items in `docs/data-policy.md` and are a policy
decision, not a UI affordance.

The one place the code does try to delete is orphan cleanup after a failed
metadata write, and it confirms the deletion from the returned rows: a Supabase
storage delete blocked by RLS removes nothing and raises nothing.

## Audit

Document metadata is on ADR 0007's **fail-closed** list. Upload, archive and
restore each write their `audit_events` row inside the same transaction as the
change, from a `SECURITY DEFINER` function — `emitAudit` swallows failures by
design and is the wrong mechanism here.

The audit row carries ids, size and content type. It carries **no title, no
filename, no notes and no document type**: `audit_events` is readable by a
LOCATION_ADMIN at the location, and "IMAGING_REPORT for patient X" is a clinical
disclosure to someone who may not read the document itself.

Viewing is logged best-effort through `emitAudit`. Viewing a record must never
block care.

## Document types

A Postgres enum, mirrored by one TypeScript catalog
(`src/features/documents/types.ts`) that the UI is driven from. Adding a type is
`ALTER TYPE … ADD VALUE` plus one catalog entry — no policy, no query and no
component changes. The enum is preferred over free text because an invalid type
should be impossible in the database, not merely unlikely in the form.
