"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Check, TriangleAlert, ArrowLeft } from "lucide-react";
import { uploadDocumentAction } from "../actions";
import { emptyDocumentState } from "../schema";
import { classifyUpload, SNIFF_BYTES } from "../file-validation";
import { isDocumentType, type AllowedMimeType, type DocumentType } from "../types";
import type { EncounterOption } from "../queries";
import { UploadFields } from "./upload-fields";
import { UploadReview } from "./upload-review";

/**
 * File a document against one patient.
 *
 * A REVIEW STEP, not a straight submit — see `upload-review.tsx` for why.
 *
 * The file is checked in the browser from its own leading BYTES, using the same
 * pure function the server uses. That is a courtesy, not a control: the server
 * repeats every check on the whole file, and the database repeats it again.
 */
export function UploadForm({
  patient,
  encounters,
  backHref,
}: {
  patient: { id: string; fullName: string; patientNumber: string };
  encounters: EncounterOption[];
  /** Where to go back to when this was reached from a patient record. */
  backHref: string;
}) {
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
    // Filed. Land on the workspace already filtered to this patient, so the
    // doctor sees the thing they just stored rather than a list of everything.
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
    // A scanner names the report better than an empty box does. Only ever a
    // starting point — the doctor can rewrite it, and the filename carries no
    // authority anywhere else in this flow.
    if (!title.trim()) setTitle(chosen.name.replace(/\.[^.]+$/, "").slice(0, 200));
  }

  const canReview = Boolean(file) && !fileError && title.trim().length > 0;
  const type: DocumentType = isDocumentType(documentType) ? documentType : "OTHER";

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

      <UploadFields
        disabled={reviewing || pending}
        encounters={encounters}
        documentType={documentType}
        onDocumentType={setDocumentType}
        documentDate={documentDate}
        onDocumentDate={setDocumentDate}
        title={title}
        onTitle={setTitle}
        notes={notes}
        onNotes={setNotes}
        encounterId={encounterId}
        onEncounterId={setEncounterId}
        onFileChange={onFileChange}
        file={file}
        fileType={fileType}
        fileError={fileError ?? state.fieldErrors?.file?.[0] ?? null}
        titleError={state.fieldErrors?.title?.[0] ?? null}
      />

      {reviewing ? (
        <UploadReview
          patientName={patient.fullName}
          patientNumber={patient.patientNumber}
          documentType={type}
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
