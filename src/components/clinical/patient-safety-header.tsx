import * as React from "react";
import { TriangleAlert, Droplet, Weight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAgeSex } from "@/lib/format";
import { severityIcon } from "@/components/common/status-badge";
import type { PatientSummary } from "@/mocks/types";

/**
 * PatientSafetyHeader — the identity + risk strip that must be visible on every
 * screen where a clinical decision can be made.
 *
 * Deliberately OPAQUE, never glass. Allergies and alerts are the highest-value
 * information in the product; they must be legible at a glance, in a bright
 * chamber, on a cheap screen, at an angle.
 *
 * Kept presentational in Phase 1 — no data fetching, no business logic.
 */

interface PatientSafetyHeaderProps {
  patient: PatientSummary;
  /** `compact` for cards and lists; `full` for the consultation screen. */
  variant?: "compact" | "full";
  className?: string;
}

export function PatientSafetyHeader({
  patient,
  variant = "full",
  className,
}: PatientSafetyHeaderProps) {
  const hasAllergies = patient.allergies.length > 0;
  const criticalAlerts = patient.alerts.filter(
    (a) => a.severity === "serious" || a.severity === "critical",
  );

  return (
    <div
      className={cn(
        "clinical-surface rounded-glass overflow-hidden",
        hasAllergies || criticalAlerts.length > 0
          ? "border-l-4 border-l-danger"
          : "border-l-4 border-l-brand",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
        <h3 className="text-base font-semibold text-ink">{patient.fullName}</h3>
        <span className="text-sm text-ink-secondary tabular-nums">
          {formatAgeSex(patient.ageYears, patient.sex, patient.dobPrecision)}
        </span>
        <span className="font-mono text-xs text-ink-muted">
          {patient.patientNumber}
        </span>
      </div>

      {/* Allergies: the single most important line on the screen. */}
      <div className="px-4 pt-2">
        {hasAllergies ? (
          <p className="flex items-start gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[13px] font-semibold text-[#a81c1c]">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-bold uppercase">Allergy:</span>{" "}
              {patient.allergies.join(", ")}
            </span>
          </p>
        ) : (
          <p className="text-[13px] text-ink-muted">No known drug allergies recorded</p>
        )}
      </div>

      {variant === "full" ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline px-4 py-2.5 text-[13px]">
          {patient.bloodGroup ? (
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <Droplet className="size-3.5 text-ink-muted" aria-hidden="true" />
              Blood group{" "}
              <strong className="font-semibold text-ink tabular-nums">
                {patient.bloodGroup}
              </strong>
            </span>
          ) : null}
          {patient.weightKg ? (
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <Weight className="size-3.5 text-ink-muted" aria-hidden="true" />
              Weight{" "}
              <strong className="font-semibold text-ink tabular-nums">
                {patient.weightKg} kg
              </strong>
            </span>
          ) : null}
          {patient.conditions.length > 0 ? (
            <span className="text-ink-secondary">
              {patient.conditions.join(" · ")}
            </span>
          ) : null}
        </div>
      ) : null}

      {criticalAlerts.length > 0 ? (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {criticalAlerts.map((alert) => (
            <li
              key={alert.id}
              className="flex items-center gap-2 px-4 py-2 text-[13px] text-ink"
            >
              {severityIcon(alert.severity, "size-4 shrink-0")}
              <span>{alert.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
