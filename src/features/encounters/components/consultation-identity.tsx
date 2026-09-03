import * as React from "react";
import { TriangleAlert, Droplet, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAgeSex } from "@/lib/format";
import { severityIcon } from "@/components/common/status-badge";
import type { Severity } from "@/mocks/types";
import type { PatientDetail } from "@/features/patients/queries";
import { BLOOD_GROUP_LABEL } from "@/features/patients/schema";

const SEVERITIES = new Set(["none", "caution", "serious", "critical"]);

function toSeverity(value: string): Severity {
  const lower = value.toLowerCase();
  return (SEVERITIES.has(lower) ? lower : "caution") as Severity;
}

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
        "dd-consultation-identity clinical-surface overflow-hidden rounded-[18px] border-l-4",
        flagged ? "border-l-danger" : "border-l-brand",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 pt-2.5 sm:px-4">
        <h1 className="text-[15px] font-semibold text-ink sm:text-[16px]">{patient.fullName}</h1>
        <span className="text-[11.5px] text-ink-secondary tabular-nums">
          {formatAgeSex(patient.ageYears, patient.sex, patient.dobPrecision)}
        </span>
        <span className="font-mono text-[10.5px] text-ink-muted">{patient.patientNumber}</span>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-surface-muted px-2 py-1 text-[10.5px] text-ink-muted">
          <MapPin className="size-3" aria-hidden="true" />
          {locationName}
        </span>
      </div>

      <div className="px-3.5 pt-2 pb-2.5 sm:px-4">
        {allergies.length > 0 ? (
          <p className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-2.5 py-2 text-[12px] font-semibold text-[#a81c1c]">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-bold uppercase">Allergy:</span>{" "}
              {allergies.map((a) => a.substance).join(", ")}
            </span>
          </p>
        ) : (
          <p className="text-[11px] text-ink-muted">No known drug allergies recorded</p>
        )}
      </div>

      {(patient.bloodGroup || patient.conditions.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline px-3.5 py-2 text-[11.5px] sm:px-4">
          {patient.bloodGroup && patient.bloodGroup !== "UNKNOWN" ? (
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <Droplet className="size-3 text-ink-muted" aria-hidden="true" />
              <strong className="font-semibold text-ink tabular-nums">
                {BLOOD_GROUP_LABEL[patient.bloodGroup as keyof typeof BLOOD_GROUP_LABEL] ?? patient.bloodGroup}
              </strong>
            </span>
          ) : null}
          {patient.conditions.length > 0 ? (
            <span className="text-ink-secondary">{patient.conditions.map((c) => c.condition).join(" · ")}</span>
          ) : null}
        </div>
      )}

      {alerts.length > 0 ? (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {alerts.map((alert) => (
            <li key={alert.id} className="flex items-center gap-2 px-3.5 py-2 text-[11.5px] text-ink sm:px-4">
              {severityIcon(toSeverity(alert.severity), "size-3.5 shrink-0")}
              <span>{alert.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
