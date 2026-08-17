import * as React from "react";
import { TriangleAlert, Droplet, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAgeSex } from "@/lib/format";
import { severityIcon } from "@/components/common/status-badge";
import type { Severity } from "@/mocks/types";
import type { PatientDetail } from "@/features/patients/queries";
import { BLOOD_GROUP_LABEL } from "@/features/patients/schema";

const SEVERITIES = new Set(["none", "caution", "serious", "critical"]);

/**
 * Alert severities arrive as plain strings from the database.
 *
 * An unrecognised one still gets an icon rather than a blank space: an alert we
 * cannot categorise is exactly the alert that must not silently disappear from
 * a consultation screen.
 */
function toSeverity(value: string): Severity {
  const lower = value.toLowerCase();
  return (SEVERITIES.has(lower) ? lower : "caution") as Severity;
}

/**
 * Who this consultation is about — pinned to the top of the screen for its
 * whole duration.
 *
 * Not decoration. A doctor moving between patients at speed needs the name,
 * number and allergies in the same place every time, and the single worst
 * outcome this screen can produce is notes written into the wrong record. It is
 * sticky and opaque for that reason: it must stay legible over scrolling text,
 * in a bright chamber, on a cheap screen.
 */
export function ConsultationIdentity({
  patient,
  locationName,
  className,
}: {
  patient: PatientDetail;
  locationName: string;
  className?: string;
}) {
  const allergies = patient.allergies;
  const alerts = patient.alerts.filter((a) => {
    const s = a.severity.toLowerCase();
    return s === "serious" || s === "critical";
  });
  const flagged = allergies.length > 0 || alerts.length > 0;

  return (
    <div
      className={cn(
        "clinical-surface rounded-glass overflow-hidden border-l-4",
        flagged ? "border-l-danger" : "border-l-brand",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
        <h1 className="text-base font-semibold text-ink sm:text-lg">{patient.fullName}</h1>
        <span className="text-sm text-ink-secondary tabular-nums">
          {formatAgeSex(patient.ageYears, patient.sex, patient.dobPrecision)}
        </span>
        <span className="font-mono text-xs text-ink-muted">{patient.patientNumber}</span>
        <span className="flex items-center gap-1 text-xs text-ink-muted">
          <MapPin className="size-3.5" aria-hidden="true" />
          {locationName}
        </span>
      </div>

      {/* The highest-value line on the screen. Never collapsed, never truncated. */}
      <div className="px-4 pt-2 pb-3">
        {allergies.length > 0 ? (
          <p className="flex items-start gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[13px] font-semibold text-[#a81c1c]">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-bold uppercase">Allergy:</span>{" "}
              {allergies.map((a) => a.substance).join(", ")}
            </span>
          </p>
        ) : (
          <p className="text-[13px] text-ink-muted">No known drug allergies recorded</p>
        )}
      </div>

      {(patient.bloodGroup || patient.conditions.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline px-4 py-2 text-[13px]">
          {/*
            Through the label map, never raw. The database stores B_POS; a
            clinical strip that prints "B_POS" is showing a doctor a column
            name where a blood group should be.
          */}
          {patient.bloodGroup && patient.bloodGroup !== "UNKNOWN" ? (
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <Droplet className="size-3.5 text-ink-muted" aria-hidden="true" />
              <strong className="font-semibold text-ink tabular-nums">
                {BLOOD_GROUP_LABEL[patient.bloodGroup as keyof typeof BLOOD_GROUP_LABEL] ??
                  patient.bloodGroup}
              </strong>
            </span>
          ) : null}
          {patient.conditions.length > 0 ? (
            <span className="text-ink-secondary">
              {patient.conditions.map((c) => c.condition).join(" · ")}
            </span>
          ) : null}
        </div>
      )}

      {alerts.length > 0 ? (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {alerts.map((alert) => (
            <li key={alert.id} className="flex items-center gap-2 px-4 py-2 text-[13px] text-ink">
              {severityIcon(toSeverity(alert.severity), "size-4 shrink-0")}
              <span>{alert.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
