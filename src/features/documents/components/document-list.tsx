import * as React from "react";
import Link from "next/link";
import { Eye, Download, Paperclip, Stethoscope, TriangleAlert, Archive } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { formatDate } from "@/lib/format";
import { DocumentIcon } from "./document-icon";
import { DocumentRowActions } from "./document-row-actions";
import {
  DOCUMENT_TYPE_LABEL,
  MIME_LABEL,
  formatBytes,
  type AllowedMimeType,
  type PatientDocumentSummary,
} from "../types";

/**
 * The document list.
 *
 * Cards, not a table — the same reasoning as the patient list. This is read
 * one-handed between rooms, and a squeezed desktop table loses the two things
 * that matter at 360px: which patient it belongs to, and when it is FROM.
 *
 * Used by both the Documents workspace and the patient record; the patient
 * record hides the patient line because it would repeat the page heading on
 * every row. When Online Consultation needs a document reader, it is this one.
 */

export function DocumentListError() {
  /**
   * An outage must never render as "no documents". On a clinical record those
   * mean opposite things — one is a fact about the patient, the other a fact
   * about the network — and a doctor cannot tell them apart from an empty list.
   */
  return (
    <SectionCard className="overflow-hidden border-l-4 border-l-danger">
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Documents could not be loaded</p>
          <p className="mt-1 text-[13px] text-ink-secondary">
            This is not the same as “no documents”. Do not assume this patient has
            no reports on file — try again in a moment.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

interface DocumentListProps {
  documents: PatientDocumentSummary[];
  /** Off inside a patient record, where the patient is the page. */
  showPatient?: boolean;
  /** A `SectionHeader`, when this list is a section of a larger record. */
  header?: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
}

export function DocumentList({
  documents,
  showPatient = true,
  header,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: DocumentListProps) {
  return (
    <SectionCard className="overflow-hidden">
      {header}
      {documents.length === 0 ? (
        <EmptyState
          icon={<Paperclip className="size-5" />}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} showPatient={showPatient} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function DocumentRow({
  doc,
  showPatient,
}: {
  doc: PatientDocumentSummary;
  showPatient: boolean;
}) {
  const archived = doc.archivedAt !== null;
  const fileLabel = MIME_LABEL[doc.mimeType as AllowedMimeType] ?? "File";

  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"
          aria-hidden="true"
        >
          <DocumentIcon type={doc.documentType} className="size-[18px]" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold text-ink">
            <span className="min-w-0 break-words">{doc.title}</span>
            {archived ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-secondary ring-1 ring-hairline ring-inset">
                <Archive className="size-3" aria-hidden="true" />
                Removed
              </span>
            ) : null}
          </p>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-secondary">
            {/* Type as TEXT, never the icon alone. */}
            <span>{DOCUMENT_TYPE_LABEL[doc.documentType]}</span>
            {showPatient ? (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  href={`/patients/${doc.patientId}`}
                  className="min-w-0 truncate rounded font-medium text-ink hover:underline focus-visible:focus-ring"
                >
                  {doc.patientName}
                </Link>
                {doc.patientNumber ? (
                  <span className="font-mono text-xs text-ink-muted">
                    {doc.patientNumber}
                  </span>
                ) : null}
              </>
            ) : null}
          </p>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted tabular-nums">
            {/*
              The document's OWN date leads, and it says so. A report from March
              uploaded today is a March report; labelling both dates "date" is
              how a history sorts itself into an order that never happened.
            */}
            {doc.documentDate ? (
              <span>Dated {formatDate(doc.documentDate)}</span>
            ) : (
              <span>No document date</span>
            )}
            <span>Filed {formatDate(doc.createdAt)}</span>
            <span>
              {fileLabel} · {formatBytes(doc.sizeBytes)}
            </span>
            {doc.encounterId ? (
              <Link
                href={`/consultation/${doc.encounterId}`}
                className="inline-flex items-center gap-1 rounded text-ink-secondary hover:underline focus-visible:focus-ring"
              >
                <Stethoscope className="size-3" aria-hidden="true" />
                Consultation
              </Link>
            ) : null}
          </p>

          {doc.notes ? (
            <p className="mt-1.5 break-words text-[13px] text-ink-secondary">{doc.notes}</p>
          ) : null}

          {archived && doc.archiveReason ? (
            <p className="mt-1.5 break-words text-[13px] text-ink-muted">
              Removed: {doc.archiveReason}
            </p>
          ) : null}
        </div>
      </div>

      {/*
        Stacked full-width on phones, inline from `sm`. Every control is at
        least 44px tall — these are pressed with a thumb while holding a chart.
      */}
      <div
        data-mobile-document-actions
        className="mt-3 flex w-full min-w-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center"
      >
        <a
          href={`/api/documents/${doc.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-hairline px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:h-10 sm:w-auto"
        >
          <Eye className="size-4" aria-hidden="true" />
          View
        </a>
        <a
          href={`/api/documents/${doc.id}?download=1`}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-hairline px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:h-10 sm:w-auto"
        >
          <Download className="size-4" aria-hidden="true" />
          Download
        </a>
        <DocumentRowActions documentId={doc.id} archived={archived} title={doc.title} />
      </div>
    </li>
  );
}
