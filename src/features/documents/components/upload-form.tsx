"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Paperclip, Check, TriangleAlert, ArrowLeft } from "lucide-react";
import { formatDate } from "@/lib/format";
import { uploadDocumentAction } from "../actions";
import { emptyDocumentState } from "../schema";
import { classifyUpload, SNIFF_BYTES } from "../file-validation";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABEL,
  FILE_ACCEPT,
  formatBytes,
  MIME_LABEL,
  type AllowedMimeType,
} from "../types";
import type { EncounterOption } from "../queries";

/**
 * File a document against one patient.
 *
 * A REVIEW STEP, not a straight submit. The two mistakes that matter here are
 * the wrong patient and the wrong file, and both are invisible in a form that
 * uploads the instant a button is pressed. So the fields are filled, then the
 * doctor is shown what is about to be stored — this patient, this file, this
 * date — and confirms it.
 *
 * The file is checked in the browser from its own leading BYTES, using the same
 * pure function the server uses. That is a courtesy, not a control: the server
 * repeats every check, and the database repeats it again.
 */

const field =
  "h-11 w-full min-w-0 rounded-xl border border-hairline bg-white px-3 text-base text-ink placeholder:text-ink-muted focus-visible:focus-ring";

interface UploadFormProps {
  patient: { id: string; fullName: string; patientNumber: string };
  encounters: EncounterOption[];
  /** Where to go back to when this was reached from a patient record. */
  backHref: string;
}

export function UploadForm({ patient, encounters, backHref }: UploadFormProps) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(uploadDocumentAction, emptyDocumentState);

  const [reviewing, setReviewing] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [fileType, setFileType] = React.useState<AllowedMimeType | null>(null);

  const [documentType, setDocumentType] = React.useState<string>("LAB_REPORT");
  const [title, setTitle] = React.useState("");
  const [documentDate, setDocumentDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [encounterId, setEncounterId] = React.useState("");

  React.useEffect(() => {
    if (state.ok) router.push(`/documents?patient=${patient.id}`);
  }, [state.ok, router, patient.id]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    setFileType(null);
    setFileError(null);
    if (!chosen) return;

    const head = new Uint8Array(await chosen.slice(0, SNIFF_BYTES).arrayBuffer());
    const verdict = classifyUpload({
      sizeBytes: chosen.size,
      leadingBytes: head,
      claimedType: chosen.type,
    });

    if (!verdict.ok) {
      setFileError(verdict.message);
      return;
    }
    setFileType(verdict.mimeType);
    // A file usually names the report better than an empty box does.
    if (!title.trim()) setTitle(chosen.name.replace(/\.[^.]+$/, "").slice(0, 200));
  }

  const canReview = Boolean(file) && !fileError && title.trim().length > 0;
  const serverFileError = state.fieldErrors?.file?.[0] ?? null;

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="patientId" value={patient.id} />

      <section className="clinical-surface rounded-glass-lg p-4 shadow-soft sm:p-5">
        <p className="text-xs font-semibold tracking-wide text-brand uppercase">Patient</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-ink">
          <span className="min-w-0 break-words">{patient.fullName}</span>
          <span className="font-mono text-xs text-ink-muted">{patient.patientNumber}</span>
        </p>
        <a
          href={backHref}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Choose a different patient
        </a>
      </section>

      <fieldset
        disabled={reviewing || pending}
        className="clinical-surface space-y-4 rounded-glass-lg p-4 shadow-soft sm:p-5"
      >
        <legend className="sr-only">Document details</legend>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="documentType" className="mb-1.5 block text-[13px] font-medium text-ink">
              Type
            </label>
            <select
              id="documentType"
              name="documentType"
              className={field}
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label htmlFor="documentDate" className="mb-1.5 block text-[13px] font-medium text-ink">
              Date on the document
            </label>
            <input
              id="documentDate"
              name="documentDate"
              type="date"
              className={field}
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-muted">
              When the test or scan was done — not today, unless it was today.
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <label htmlFor="title" className="mb-1.5 block text-[13px] font-medium text-ink">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={200}
            className={field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. CBC with ESR"
          />
          {state.fieldErrors?.title ? (
            <p className="mt-1.5 text-[13px] text-danger">{state.fieldErrors.title[0]}</p>
          ) : null}
        </div>

        {encounters.length > 0 ? (
          <div className="min-w-0">
            <label htmlFor="encounterId" className="mb-1.5 block text-[13px] font-medium text-ink">
              Attach to a consultation <span className="text-ink-muted">(optional)</span>
            </label>
            <select
              id="encounterId"
              name="encounterId"
              className={field}
              value={encounterId}
              onChange={(e) => setEncounterId(e.target.value)}
            >
              <option value="">Not attached to a consultation</option>
              {encounters.map((e) => (
                <option key={e.id} value={e.id}>
                  {formatDate(e.startedAt)}
                  {e.locationName ? ` · ${e.locationName}` : ""}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="encounterId" value="" />
        )}

        <div className="min-w-0">
          <label htmlFor="notes" className="mb-1.5 block text-[13px] font-medium text-ink">
            Notes <span className="text-ink-muted">(optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={2000}
            className="w-full min-w-0 rounded-xl border border-hairline bg-white px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus-visible:focus-ring"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything you want to remember about this report"
          />
        </div>

        <div className="min-w-0">
          <label htmlFor="file" className="mb-1.5 block text-[13px] font-medium text-ink">
            File
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept={FILE_ACCEPT}
            onChange={onFileChange}
            className="block w-full min-w-0 rounded-xl border border-hairline bg-white p-2.5 text-sm text-ink file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-brand-soft file:px-3 file:text-[13px] file:font-semibold file:text-brand focus-visible:focus-ring"
          />
          <p className="mt-1 text-xs text-ink-muted">
            PDF, JPG or PNG, up to 10 MB. A clear photograph of a paper report is fine.
          </p>
          {fileError || serverFileError ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger">
              <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
              <span>{fileError ?? serverFileError}</span>
            </p>
          ) : null}
          {file && fileType && !fileError ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-secondary">
              <Paperclip className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-all">
                {file.name} · {MIME_LABEL[fileType]} · {formatBytes(file.size)}
              </span>
            </p>
          ) : null}
        </div>
      </fieldset>

      {reviewing ? (
        <ReviewPanel
          patientName={patient.fullName}
          patientNumber={patient.patientNumber}
          documentType={documentType}
          title={title}
          documentDate={documentDate}
          fileName={file?.name ?? ""}
          fileSize={file?.size ?? 0}
          attached={encounterId !== ""}
        />
      ) : null}

      {state.message && !state.ok ? (
        <p className="flex items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
          <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          {state.message}
        </p>
      ) : null}

      <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {reviewing ? (
          <>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring disabled:opacity-60 sm:h-11 sm:w-auto"
            >
              <Upload className="size-4" aria-hidden="true" />
              {pending ? "Uploading…" : "Upload document"}
            </button>
            <button
              type="button"
              onClick={() => setReviewing(false)}
              disabled={pending}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-hairline px-5 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring disabled:opacity-60 sm:h-11 sm:w-auto"
            >
              Change something
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setReviewing(true)}
            disabled={!canReview}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring disabled:opacity-50 sm:h-11 sm:w-auto"
          >
            <Check className="size-4" aria-hidden="true" />
            Review
          </button>
        )}
      </div>
    </form>
  );
}

function ReviewPanel(props: {
  patientName: string;
  patientNumber: string;
  documentType: string;
  title: string;
  documentDate: string;
  fileName: string;
  fileSize: number;
  attached: boolean;
}) {
  const rows: [string, string][] = [
    ["Patient", `${props.patientName} · ${props.patientNumber}`],
    ["Type", DOCUMENT_TYPE_LABEL[props.documentType as keyof typeof DOCUMENT_TYPE_LABEL]],
    ["Title", props.title],
    ["Document date", props.documentDate ? formatDate(props.documentDate) : "Not recorded"],
    ["Consultation", props.attached ? "Attached" : "Not attached"],
    ["File", `${props.fileName} · ${formatBytes(props.fileSize)}`],
  ];

  return (
    <section
      data-document-review
      className="clinical-surface rounded-glass-lg border-l-4 border-l-brand p-4 shadow-soft sm:p-5"
    >
      <h2 className="text-[15px] font-semibold text-ink">Check before filing</h2>
      <p className="mt-1 text-[13px] text-ink-secondary">
        This is stored on this patient&rsquo;s record. Filing a report on the wrong
        person is the mistake worth one more look.
      </p>
      <dl className="mt-3 divide-y divide-hairline text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start gap-3 py-2">
            <dt className="w-32 shrink-0 text-ink-muted">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
