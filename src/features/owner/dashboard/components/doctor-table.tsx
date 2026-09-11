import * as React from "react";
import { CircleSlash, CloudOff, Users } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { DOCTOR_COLUMNS } from "../catalog";
import { formatMeasurement, LANE_LABEL, type Measurement } from "../measurement";
import type { DoctorRow, DoctorRowsResult } from "../sources";

/**
 * The per-doctor usage table — thirteen columns, and never a patient.
 *
 * TWO LAYOUTS, deliberately, not one squeezed one. At `lg` and wider it is a
 * real table with a sticky header, scrolling inside its own container. Below
 * `lg` every doctor becomes a card with their name and pilot status pinned at
 * the top: a thirteen-column grid on a 360px phone scrolls the doctor's name
 * out of view, and that is the one column that gives every other number
 * meaning.
 *
 * ABSENCE IS NOT EMPTINESS. When the doctor directory itself has no approved
 * source, the table does not render "No doctors" — that is a claim about the
 * platform. It shows the columns it will carry and says the directory is not
 * measured yet.
 */

const METRIC_COLUMNS = DOCTOR_COLUMNS.filter((c) => !c.identity);

function Cell({ m, unit }: { m: Measurement | undefined; unit: (typeof DOCTOR_COLUMNS)[number]["unit"] }) {
  const f = formatMeasurement(m ?? { state: "unavailable" }, unit);
  if (f.kind === "value") return <span className="tabular-nums">{f.display}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-muted" title={f.spoken}>
      {m?.state === "unavailable" || !m ? (
        <CloudOff className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <CircleSlash className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span className="sr-only">{f.spoken}</span>
      <span aria-hidden="true">{f.display}</span>
    </span>
  );
}

export function DoctorTable({ result }: { result: DoctorRowsResult }) {
  const rows: DoctorRow[] = result.state === "measured" ? result.rows : [];

  return (
    <SectionCard className="overflow-hidden" data-doctor-table>
      <SectionHeader
        title="Doctors"
        icon={<Users className="size-4" />}
        count={result.state === "measured" ? rows.length : undefined}
      />

      {result.state !== "measured" ? (
        <DirectoryAbsent result={result} />
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-secondary sm:px-5">
          The source reported no doctors for this period.
        </p>
      ) : (
        <>
          {/* ≥ lg — a real table, scrolling inside its own box. */}
          <div className="hidden overflow-x-auto lg:block" data-desktop-doctor-table>
            <table className="w-full min-w-[1100px] border-collapse text-left text-[13px]">
              {/* No backdrop blur here: the material system gives blur to the
                  major container only — a child record never adds another. */}
              <thead className="sticky top-0 z-10 bg-white/85">
                <tr className="border-b border-hairline">
                  {DOCTOR_COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-2.5 font-semibold whitespace-nowrap text-ink-secondary first:pl-5 last:pr-5">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => (
                  <tr key={r.doctorRef}>
                    <th scope="row" className="max-w-[16rem] truncate px-3 py-2.5 pl-5 font-semibold text-ink">
                      {r.doctorLabel}
                    </th>
                    <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary">{r.pilotStatus ?? "—"}</td>
                    {METRIC_COLUMNS.map((c) => (
                      <td key={c.key} className="px-3 py-2.5 whitespace-nowrap text-ink last:pr-5">
                        <Cell m={r.cells[c.key]} unit={c.unit} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* < lg — one card per doctor, identity pinned at the top. */}
          <ul className="divide-y divide-hairline lg:hidden" data-mobile-doctor-cards>
            {rows.map((r) => (
              <li key={r.doctorRef} className="min-w-0 px-4 py-3.5 sm:px-5">
                <p className="min-w-0 truncate text-[15px] font-semibold text-ink">{r.doctorLabel}</p>
                <p className="text-xs text-ink-muted">{r.pilotStatus ?? "No pilot status"}</p>
                <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 min-[480px]:grid-cols-3">
                  {METRIC_COLUMNS.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="truncate text-[11px] text-ink-muted">{c.label}</dt>
                      <dd className="text-[13px] text-ink">
                        <Cell m={r.cells[c.key]} unit={c.unit} />
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

function DirectoryAbsent({ result }: { result: Exclude<DoctorRowsResult, { state: "measured" }> }) {
  const unavailable = result.state === "unavailable";

  return (
    <div className="space-y-4 px-4 py-5 sm:px-5" data-doctor-directory-state={result.state}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true">
          {unavailable ? <CloudOff className="size-5" /> : <CircleSlash className="size-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {unavailable ? "Doctor directory unavailable" : "Doctor directory not measured yet"}
          </p>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {unavailable
              ? "The source did not answer. This is not the same as “no doctors” — try again shortly."
              : `No approved aggregate source exists for the doctor directory. Waiting on ${LANE_LABEL[result.lane]}. This is not the same as “no doctors”.`}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          When measured, each doctor row carries
        </p>
        <ul className="mt-2 flex min-w-0 flex-wrap gap-1.5" data-doctor-column-list>
          {DOCTOR_COLUMNS.map((c) => (
            <li
              key={c.key}
              className="dd-material-record dd-record-pearl rounded-full px-2.5 py-1 text-xs font-medium text-ink-secondary"
            >
              {c.label}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-muted">
          Doctor identity and usage counts only. Never a patient name, diagnosis,
          prescription text, transcript or prompt.
        </p>
      </div>
    </div>
  );
}
