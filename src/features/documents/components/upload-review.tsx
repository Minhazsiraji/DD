import * as React from "react";
import { formatDate } from "@/lib/format";
import { DOCUMENT_TYPE_LABEL, formatBytes, type DocumentType } from "../types";

/**
 * What is about to be stored, shown before it is.
 *
 * The two mistakes that matter on this screen are the wrong patient and the
 * wrong file, and both are invisible in a form that uploads the instant a
 * button is pressed. Filing a report on the wrong person is not a typo — it is
 * a clinical error in someone else's record, and it is worth one more look.
 */
export function UploadReview(props: {
  patientName: string;
  patientNumber: string;
  documentType: DocumentType;
  title: string;
  documentDate: string;
  fileName: string;
  fileSize: number;
  attached: boolean;
}) {
  const rows: [string, string][] = [
    ["Patient", `${props.patientName} · ${props.patientNumber}`],
    ["Type", DOCUMENT_TYPE_LABEL[props.documentType]],
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
