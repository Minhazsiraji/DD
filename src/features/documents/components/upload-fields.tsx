"use client";

import * as React from "react";
import { Paperclip, TriangleAlert } from "lucide-react";
import { formatDate } from "@/lib/format";
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
 * The document's own fields.
 *
 * Split out of `upload-form.tsx` so that file holds the FLOW — fill, review,
 * confirm — and this one holds the inputs. The whole fieldset is disabled while
 * the review panel is up, which is why the values are passed in rather than
 * held here: a disabled input posts nothing, so every one of them has to come
 * back out on submit.
 */

/** 44px tall and 16px text — a thumb target, and iOS will not zoom the page. */
export const FIELD_CLASS =
  "h-11 w-full min-w-0 rounded-xl border border-hairline bg-white px-3 text-base text-ink placeholder:text-ink-muted focus-visible:focus-ring";

const LABEL_CLASS = "mb-1.5 block text-[13px] font-medium text-ink";

export interface UploadFieldsProps {
  disabled: boolean;
  encounters: EncounterOption[];

  documentType: string;
  onDocumentType: (value: string) => void;
  documentDate: string;
  onDocumentDate: (value: string) => void;
  title: string;
  onTitle: (value: string) => void;
  notes: string;
  onNotes: (value: string) => void;
  encounterId: string;
  onEncounterId: (value: string) => void;

  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  file: File | null;
  fileType: AllowedMimeType | null;
  fileError: string | null;
  titleError: string | null;
}

export function UploadFields(props: UploadFieldsProps) {
  return (
    <fieldset
      disabled={props.disabled}
      className="clinical-surface space-y-4 rounded-glass-lg p-4 shadow-soft sm:p-5"
    >
      <legend className="sr-only">Document details</legend>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="documentType" className={LABEL_CLASS}>
            Type
          </label>
          <select
            id="documentType"
            name="documentType"
            className={FIELD_CLASS}
            value={props.documentType}
            onChange={(e) => props.onDocumentType(e.target.value)}
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label htmlFor="documentDate" className={LABEL_CLASS}>
            Date on the document
          </label>
          <input
            id="documentDate"
            name="documentDate"
            type="date"
            className={FIELD_CLASS}
            value={props.documentDate}
            onChange={(e) => props.onDocumentDate(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-muted">
            When the test or scan was done — not today, unless it was today.
          </p>
        </div>
      </div>

      <div className="min-w-0">
        <label htmlFor="title" className={LABEL_CLASS}>
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={200}
          className={FIELD_CLASS}
          value={props.title}
          onChange={(e) => props.onTitle(e.target.value)}
          placeholder="e.g. CBC with ESR"
        />
        {props.titleError ? (
          <p className="mt-1.5 text-[13px] text-danger">{props.titleError}</p>
        ) : null}
      </div>

      {/*
        No consultations yet means no picker — and a HIDDEN input carrying the
        empty value, because a control that is not rendered posts nothing and
        the action would then have to guess what absence meant.
      */}
      {props.encounters.length > 0 ? (
        <div className="min-w-0">
          <label htmlFor="encounterId" className={LABEL_CLASS}>
            Attach to a consultation <span className="text-ink-muted">(optional)</span>
          </label>
          <select
            id="encounterId"
            name="encounterId"
            className={FIELD_CLASS}
            value={props.encounterId}
            onChange={(e) => props.onEncounterId(e.target.value)}
          >
            <option value="">Not attached to a consultation</option>
            {props.encounters.map((e) => (
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
        <label htmlFor="notes" className={LABEL_CLASS}>
          Notes <span className="text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={2000}
          className="w-full min-w-0 rounded-xl border border-hairline bg-white px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus-visible:focus-ring"
          value={props.notes}
          onChange={(e) => props.onNotes(e.target.value)}
          placeholder="Anything you want to remember about this report"
        />
      </div>

      <div className="min-w-0">
        <label htmlFor="file" className={LABEL_CLASS}>
          File
        </label>
        <input
          id="file"
          name="file"
          type="file"
          required
          /* Convenience only. The picker's filter is never the control — the
             server decides from the file's own leading bytes. */
          accept={FILE_ACCEPT}
          onChange={props.onFileChange}
          className="block w-full min-w-0 rounded-xl border border-hairline bg-white p-2.5 text-sm text-ink file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-brand-soft file:px-3 file:text-[13px] file:font-semibold file:text-brand focus-visible:focus-ring"
        />
        <p className="mt-1 text-xs text-ink-muted">
          PDF, JPG or PNG, up to 10 MB. A clear photograph of a paper report is fine.
        </p>

        {props.fileError ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span>{props.fileError}</span>
          </p>
        ) : null}

        {props.file && props.fileType && !props.fileError ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-secondary">
            <Paperclip className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-all">
              {props.file.name} · {MIME_LABEL[props.fileType]} ·{" "}
              {formatBytes(props.file.size)}
            </span>
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
