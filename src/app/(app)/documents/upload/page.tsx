import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Users, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { UploadForm } from "@/features/documents/components/upload-form";
import { listEncountersForPatient } from "@/features/documents/queries";
import {
  getCurrentDoctorId,
  getPatient,
  searchPatients,
} from "@/features/patients/queries";
import { formatAge } from "@/features/patients/identity";

export const metadata: Metadata = { title: "Upload a document" };

/**
 * Upload, as a STEP FLOW: choose the patient, then describe the document.
 *
 * The patient step is a server-rendered search rather than a dropdown inside
 * the form, for two reasons. A doctor's repository is far too long for a
 * `<select>`, and a phone has no room for a combobox above a form — so the
 * choice gets a screen, exactly as the mobile consultation flow does.
 *
 * Which patient is in the URL, so the back button works, the choice survives a
 * refresh, and a patient record can link straight past this step.
 */
export default async function UploadDocumentPage(props: PageProps<"/documents/upload">) {
  const params = await props.searchParams;
  const patientId = typeof params.patient === "string" ? params.patient : "";
  const query = typeof params.q === "string" ? params.q : "";

  const patient = patientId ? await getPatient(patientId) : null;

  if (patient) {
    const encounters = await listEncountersForPatient(patient.id);
    return (
      <div className="space-y-4 sm:space-y-5">
        <Link
          href="/documents"
          className="inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Documents
        </Link>

        <PageHeader
          eyebrow="Step 2 of 2"
          title="Describe the document"
          subtitle="What it is, when it is from, and the file itself."
        />

        <UploadForm
          patient={{
            id: patient.id,
            fullName: patient.fullName,
            patientNumber: patient.patientNumber,
          }}
          encounters={encounters}
          backHref="/documents/upload"
        />
      </div>
    );
  }

  /**
   * Scoped to the caller's OWN repository, in the query. RLS legitimately shows
   * a doctor their colleagues' patients at a shared location — that is how
   * reception works — and a document may only be filed against a patient the
   * caller owns. Offering one they cannot file against would produce a refusal
   * at the last step, after the file had been chosen.
   */
  const doctorId = await getCurrentDoctorId();
  const result = doctorId ? await searchPatients(query, 20, doctorId) : null;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Link
        href="/documents"
        className="inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Documents
      </Link>

      <PageHeader
        eyebrow="Step 1 of 2"
        title="Whose document is this?"
        subtitle="A document belongs to one patient. Choose them first."
      />

      {patientId && !patient ? (
        <p className="flex items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
          <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          That patient could not be opened. Choose one below.
        </p>
      ) : null}

      {!doctorId ? (
        <SectionCard>
          <EmptyState
            icon={<Users className="size-5" />}
            title="Only a doctor can file a document"
            description="Documents are filed against a doctor's own patients. Your account is not set up as a doctor at this location."
          />
        </SectionCard>
      ) : (
        <>
          <PatientSearchForUpload initialQuery={query} />

          {!result?.ok ? (
            <SectionCard className="overflow-hidden border-l-4 border-l-danger">
              <div className="p-4 sm:p-5">
                <p className="text-sm font-semibold text-ink">
                  Patient search is temporarily unavailable
                </p>
                <p className="mt-1 text-[13px] text-ink-secondary">
                  This is not the same as “no patient found”. Try again in a moment
                  rather than registering someone who may already exist.
                </p>
              </div>
            </SectionCard>
          ) : result.patients.length === 0 ? (
            <SectionCard>
              <EmptyState
                icon={<Users className="size-5" />}
                title={query ? `No patient matches “${query}”` : "No patients yet"}
                description="A document can only be filed against a patient you have registered."
              />
            </SectionCard>
          ) : (
            <SectionCard className="overflow-hidden">
              <ul className="divide-y divide-hairline">
                {result.patients.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/documents/upload?patient=${p.id}`}
                      className="flex min-h-[56px] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted active:bg-surface-muted focus-visible:focus-ring sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-ink">
                          {p.fullName}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-secondary tabular-nums">
                          <span className="font-mono text-ink-muted">{p.patientNumber}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {formatAge({
                              years: p.ageYears,
                              isApproximate: p.ageApproximate,
                            })}
                          </span>
                          {p.phone ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{p.phone}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}

/**
 * NOT `PatientSearch`. That component pushes its query to `/patients`, which is
 * right everywhere else and would navigate the doctor out of the upload flow
 * here. A plain GET form is smaller, works without JavaScript, and keeps the
 * choice in this route's own URL.
 */
function PatientSearchForUpload({ initialQuery }: { initialQuery: string }) {
  return (
    <form action="/documents/upload" method="get" role="search">
      <label htmlFor="upload-patient-search" className="sr-only">
        Search your patients by name, phone or patient number
      </label>
      <input
        id="upload-patient-search"
        name="q"
        type="search"
        inputMode="search"
        autoComplete="off"
        defaultValue={initialQuery}
        placeholder="Name, phone or patient number…"
        /* h-12 / text-base — 16px stops iOS zooming the page on focus. */
        className="h-12 w-full rounded-glass border border-hairline bg-white px-4 text-base text-ink shadow-soft placeholder:text-ink-muted focus-visible:focus-ring"
      />
    </form>
  );
}
