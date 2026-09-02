import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { MedicineSearch } from "@/features/medicines/components/medicine-search";
import { ReferenceList } from "@/features/medicines/components/reference-list";
import { LibraryList } from "@/features/medicines/components/library-list";
import { listDoctorMedicines, searchMedicines } from "@/features/medicines/queries";
import { normalizeMedicineText } from "@/features/medicines/medicine";

export const metadata: Metadata = { title: "Medicines" };

/**
 * The medicine workspace.
 *
 * TWO TABS, TWO DIFFERENT THINGS, and the difference is the point:
 *
 *   All Medicines   the shared catalogue — what a medicine IS.
 *   My Medicines    this doctor's saved defaults — what THEY usually write.
 *
 * Tab and query live in the URL so the state is shareable and survives a
 * refresh, and so both lists render on the server under the caller's own RLS.
 */
export default async function MedicinesPage(props: PageProps<"/medicines">) {
  const params = await props.searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const tab = params.tab === "mine" ? "mine" : "all";
  const showArchived = params.archived === "1";

  /**
   * Both lists are needed on both tabs: the catalogue rows must know which are
   * already saved, so they can offer "In My Medicines" instead of an Add button
   * that would fail as a duplicate. Fetched together rather than in sequence.
   */
  const [results, library] = await Promise.all([
    tab === "all" ? searchMedicines(query) : Promise.resolve([]),
    listDoctorMedicines({ includeArchived: true }),
  ]);

  const needle = normalizeMedicineText(query);
  const mine =
    tab === "mine" && needle.length > 0
      ? // Filtering a list the doctor already has in front of them is not a
        // catalogue search: it is narrowing what is on screen, over their own
        // rows, with the same literal containment rule and no substitution.
        library.filter((m) =>
          [m.displayName, m.genericName, m.brandName, m.strengthText]
            .filter(Boolean)
            .some((f) => normalizeMedicineText(f).includes(needle)),
        )
      : library;

  const activeCount = library.filter((m) => m.isActive).length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow="Reference and recall"
        title="Medicines"
        subtitle="Look up a medicine, and save the way you normally write it. Doctor's Diary does not recommend doses — you do."
      />

      <MedicineSearch initialQuery={query} tab={tab} />

      <nav aria-label="Medicine views" className="flex min-w-0 gap-2" data-medicine-tabs>
        <TabLink
          href={`/medicines${query ? `?q=${encodeURIComponent(query)}` : ""}`}
          current={tab === "all"}
          label="All Medicines"
        />
        <TabLink
          href={`/medicines?tab=mine${query ? `&q=${encodeURIComponent(query)}` : ""}`}
          current={tab === "mine"}
          label={`My Medicines${activeCount ? ` (${activeCount})` : ""}`}
        />
      </nav>

      {tab === "all" ? (
        <ReferenceList results={results} library={library} query={query} />
      ) : (
        <div className="min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-center gap-3">
            <Link
              href={
                showArchived
                  ? `/medicines?tab=mine${query ? `&q=${encodeURIComponent(query)}` : ""}`
                  : `/medicines?tab=mine&archived=1${query ? `&q=${encodeURIComponent(query)}` : ""}`
              }
              data-medicine-archived-toggle
              className="inline-flex min-h-11 items-center rounded-xl border border-hairline px-4 text-sm font-semibold text-ink-secondary focus-visible:focus-ring"
            >
              {showArchived ? "Show active" : "Show archived"}
            </Link>
          </div>
          <LibraryList rows={mine} showArchived={showArchived} />
        </div>
      )}
    </div>
  );
}

function TabLink({
  href,
  current,
  label,
}: {
  href: string;
  current: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={
        "inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:focus-ring sm:flex-none " +
        (current
          ? "bg-brand text-white shadow-soft"
          : "border border-hairline text-ink-secondary hover:bg-surface-muted")
      }
    >
      {label}
    </Link>
  );
}
