import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionSkeleton } from "@/components/common/skeletons";
import { DocumentFilters } from "@/features/documents/components/document-filters";
import { DocumentList, DocumentListError } from "@/features/documents/components/document-list";
import { listDocuments } from "@/features/documents/queries";
import { getPatient } from "@/features/patients/queries";
import { isDocumentType, type DocumentType } from "@/features/documents/types";

export const metadata: Metadata = { title: "Documents" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Query {
  q: string;
  type: DocumentType | "all";
  patientId: string;
  from: string;
  to: string;
  archived: boolean;
}

async function Results(query: Query) {
  const result = await listDocuments({
    q: query.q,
    patientId: query.patientId || undefined,
    type: query.type,
    from: query.from || undefined,
    to: query.to || undefined,
    archived: query.archived,
  });

  if (!result.ok) return <DocumentListError />;

  const filtered =
    query.q || query.patientId || query.type !== "all" || query.from || query.to;

  return (
    <>
      <p className="text-xs text-ink-muted" role="status">
        {result.documents.length}{" "}
        {result.documents.length === 1 ? "document" : "documents"}
        {query.archived ? " removed from the record" : ""}
      </p>
      <DocumentList
        documents={result.documents}
        emptyTitle={filtered ? "No document matches those filters" : "No documents yet"}
        emptyDescription={
          filtered
            ? "Try a wider date range, or clear the type filter. A document only appears here once it has been filed against one of your patients."
            : "Lab reports, scans, discharge summaries and letters you file against your patients live here. Every one belongs to you alone."
        }
        emptyAction={
          filtered ? null : (
            <Link
              href="/documents/upload"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring"
            >
              <Upload className="size-4" aria-hidden="true" />
              Upload your first document
            </Link>
          )
        }
      />
    </>
  );
}

export default async function DocumentsPage(props: PageProps<"/documents">) {
  const params = await props.searchParams;

  const one = (key: string) => (typeof params[key] === "string" ? params[key] : "");
  const rawType = one("type");

  const query: Query = {
    q: one("q"),
    type: isDocumentType(rawType) ? rawType : "all",
    patientId: one("patient"),
    // A malformed date is dropped rather than sent to the database, where it
    // would fail the whole query and render as "no documents".
    from: ISO_DATE.test(one("from")) ? one("from") : "",
    to: ISO_DATE.test(one("to")) ? one("to") : "",
    archived: one("archived") === "1",
  };

  /**
   * Only to LABEL the chip. RLS decides whether this patient is readable at
   * all, and a name that comes back null simply renders as "one patient" —
   * never as an error, and never as a hint that the id exists.
   */
  const patient = query.patientId ? await getPatient(query.patientId) : null;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="Your patients' records"
        title="Documents"
        subtitle="Reports and letters filed against your own patients. No other doctor can open them."
        actions={
          <Link
            href="/documents/upload"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100 sm:h-10"
          >
            <Upload className="size-4" aria-hidden="true" />
            Upload document
          </Link>
        }
      />

      <DocumentFilters
        q={query.q}
        type={query.type}
        patientId={query.patientId}
        patientName={patient?.fullName ?? null}
        from={query.from}
        to={query.to}
        archived={query.archived}
      />

      {/* Keyed on the whole filter set, so changing one shows a skeleton rather
          than stale rows while the server round-trips. */}
      <Suspense
        key={JSON.stringify(query)}
        fallback={<SectionSkeleton rows={5} />}
      >
        <Results {...query} />
      </Suspense>
    </div>
  );
}
