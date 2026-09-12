import * as React from "react";
import { CircleSlash, CloudOff, EyeOff, Users } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { PARTICIPATION_COLUMNS } from "../catalog";
import { formatMeasurement, type Measurement, type MetricUnit } from "../measurement";
import { LIFECYCLE_LABEL, type ParticipationRow } from "../contract";
import type { CohortDetailResult } from "../sources";

/**
 * Pilot participations, and never a patient.
 *
 * WHAT THIS TABLE DELIBERATELY DOES NOT CONTAIN. O1-F's approved cohort
 * contract publishes a participation handle, a lifecycle, an enrolment date, a
 * measurement state and four counters. It publishes no doctor name and no
 * doctor id, so the dashboard shows none — and it reaches this data through
 * the cohort surface rather than the per-participation lookup precisely so
 * that no doctor-shaped identifier ever has to appear in a URL.
 *
 * TWO LAYOUTS, deliberately, not one squeezed one. At `lg` and wider it is a
 * real table with a sticky header scrolling inside its own container. Below
 * `lg` each participation becomes a card with its handle and lifecycle pinned
 * at the top: an eight-column grid on a 360px phone scrolls the row's identity
 * out of view, and that is the column giving every number its meaning.
 *
 * ABSENCE IS NOT EMPTINESS. When the source cannot answer, the table shows the
 * columns it will carry and says so. It never renders "no doctors".
 */

const METRIC_COLUMNS = PARTICIPATION_COLUMNS.filter((c) => !c.identity);

function Cell({ m, unit }: { m: Measurement | undefined; unit: MetricUnit }) {
  const measurement: Measurement = m ?? { state: "unavailable" };
  const f = formatMeasurement(measurement, unit);
  if (f.kind === "value") return <span className="tabular-nums">{f.display}</span>;

  const Icon =
    measurement.state === "insufficient-cohort" ? EyeOff : measurement.state === "not-measured" ? CircleSlash : CloudOff;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{f.spoken}</span>
      <span aria-hidden="true">{f.display}</span>
    </span>
  );
}

/** The handle, shortened for reading, with the whole value still selectable. */
function Handle({ id }: { id: string }) {
  return (
    <span className="font-mono text-[12px] tabular-nums" title={id}>
      {id.slice(0, 8)}…
    </span>
  );
}

function Lifecycle({ row }: { row: ParticipationRow }) {
  if (!row.lifecycle) {
    return <span className="text-xs text-ink-muted">Unavailable</span>;
  }
  return <span className="text-[13px] text-ink-secondary">{LIFECYCLE_LABEL[row.lifecycle]}</span>;
}

function MeasurementState({ row }: { row: ParticipationRow }) {
  const label =
    row.measurementStatus === "OK"
      ? "Measured"
      : row.measurementStatus === "NOT_MEASURED"
        ? "Not measured"
        : "Unavailable";
  return <span className="text-xs text-ink-muted">{label}</span>;
}

export function ParticipationTable({ result, cohort }: { result: CohortDetailResult; cohort: string | null }) {
  const rows: ParticipationRow[] = result.state === "measured" ? result.participations : [];

  return (
    <SectionCard className="overflow-hidden" data-participation-table>
      <SectionHeader
        title={cohort ? `Participations · ${cohort}` : "Participations"}
        icon={<Users className="size-4" />}
        count={result.state === "measured" ? rows.length : undefined}
      />

      {result.state !== "measured" ? (
        <DirectoryUnavailable />
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-secondary sm:px-5">
          The approved source answered for this cohort and returned no participations.
        </p>
      ) : (
        <>
          {/* ≥ lg — a real table, scrolling inside its own box. */}
          <div className="hidden overflow-x-auto lg:block" data-desktop-participation-table>
            <table className="w-full min-w-[960px] border-collapse text-left text-[13px]">
              {/* No backdrop blur here: the material system gives blur to the
                  major container only — a child record never adds another. */}
              <thead className="sticky top-0 z-10 bg-white/85">
                <tr className="border-b border-hairline">
                  {PARTICIPATION_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className="px-3 py-2.5 font-semibold whitespace-nowrap text-ink-secondary first:pl-5 last:pr-5"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => (
                  <tr key={r.participationId}>
                    <th scope="row" className="px-3 py-2.5 pl-5 font-semibold text-ink">
                      <Handle id={r.participationId} />
                    </th>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Lifecycle row={r} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary tabular-nums">
                      {r.enrolledOn ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <MeasurementState row={r} />
                    </td>
                    {METRIC_COLUMNS.map((c) => (
                      <td key={c.key} className="px-3 py-2.5 whitespace-nowrap text-ink last:pr-5">
                        <Cell m={r.metrics[c.key as keyof typeof r.metrics]} unit={c.unit} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* < lg — one card per participation, identity pinned. */}
          <ul className="divide-y divide-hairline lg:hidden" data-mobile-participation-cards>
            {rows.map((r) => (
              <li key={r.participationId} className="min-w-0 px-4 py-3.5 sm:px-5">
                <p className="min-w-0 truncate text-[15px] font-semibold text-ink">
                  <Handle id={r.participationId} />
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Lifecycle row={r} />
                  <span aria-hidden="true" className="text-ink-muted">
                    ·
                  </span>
                  <MeasurementState row={r} />
                  {r.enrolledOn ? (
                    <span className="text-xs text-ink-muted tabular-nums">enrolled {r.enrolledOn}</span>
                  ) : null}
                </p>
                <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 min-[480px]:grid-cols-4">
                  {METRIC_COLUMNS.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="truncate text-[11px] text-ink-muted">{c.label}</dt>
                      <dd className="text-[13px] text-ink">
                        <Cell m={r.metrics[c.key as keyof typeof r.metrics]} unit={c.unit} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

function DirectoryUnavailable() {
  return (
    <div className="space-y-4 px-4 py-5 sm:px-5" data-participation-state="unavailable">
      <div className="flex min-w-0 items-start gap-3">
        <CloudOff className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Participation list unavailable</p>
          <p className="mt-1 text-[13px] text-ink-secondary">
            The approved owner cohort surface did not answer. This is not the same as “no doctors”
            and not the same as “no activity”.
          </p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          When it answers, each row carries
        </p>
        <ul className="mt-2 flex min-w-0 flex-wrap gap-1.5" data-participation-column-list>
          {PARTICIPATION_COLUMNS.map((c) => (
            <li
              key={c.key}
              className="dd-material-record dd-record-pearl rounded-full px-2.5 py-1 text-xs font-medium text-ink-secondary"
            >
              {c.label}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-muted">
          Pilot participation and usage counts only. Never a patient, a diagnosis, prescription
          text, an investigation, a transcript or a prompt.
        </p>
      </div>
    </div>
  );
}
