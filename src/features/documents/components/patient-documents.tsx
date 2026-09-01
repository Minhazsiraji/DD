import * as React from "react";
import Link from "next/link";
import { Paperclip, Upload } from "lucide-react";
import { SectionHeader } from "@/components/common/section-card";
import { getPatientDocuments } from "../queries";
import { DocumentList, DocumentListError } from "./document-list";

/**
 * The patient record's Documents section.
 *
 * The same reader and the same rows as the Documents workspace — deliberately,
 * because there must be exactly one answer to "what documents does this patient
 * have". When Online Consultation needs that answer it renders this, and it
 * cannot drift from what the workspace shows.
 *
 * It is a SECTION, not a tab: the patient record already scrolls as one
 * continuous history, and hiding reports behind a tab is how a doctor misses
 * one. Archived documents are not shown here at all — the workspace's "Show
 * removed" filter is where they live, because a removed report inside a
 * clinical record invites it being read as current.
 */
export async function PatientDocuments({ patientId }: { patientId: string }) {
  const result = await getPatientDocuments(patientId, { limit: 20 });

  if (!result.ok) return <DocumentListError />;

  return (
    <DocumentList
      documents={result.documents}
      showPatient={false}
      header={
        <SectionHeader
          title="Documents"
          count={result.documents.length}
          icon={<Paperclip className="size-4" />}
          action={
            <Link
              href={`/documents/upload?patient=${patientId}`}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-hairline px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:w-auto"
            >
              <Upload className="size-3.5" aria-hidden="true" />
              Add
            </Link>
          }
        />
      }
      emptyTitle="No documents yet"
      emptyDescription="Lab reports, scans and letters you file for this patient appear here, newest first."
      emptyAction={
        <Link
          href={`/documents/upload?patient=${patientId}`}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring"
        >
          <Upload className="size-4" aria-hidden="true" />
          Add a document
        </Link>
      }
    />
  );
}
