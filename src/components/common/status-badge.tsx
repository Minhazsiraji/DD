import * as React from "react";
import {
  CircleCheck,
  CircleAlert,
  TriangleAlert,
  OctagonAlert,
  Clock,
  UserCheck,
  Stethoscope,
  CalendarClock,
  CircleX,
  CircleDollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppointmentStatus, PaymentStatus, Severity } from "@/mocks/types";
import type { AppointmentStatus as LiveAppointmentStatus } from "@/features/appointments/schema";

/**
 * StatusBadge — the single source of truth for how status is rendered.
 *
 * ACCESSIBILITY RULE: status is never communicated by colour alone. Every
 * badge carries an icon and a text label. Roughly 8% of men have red/green
 * colour deficiency; a colour-only clinical warning is not a warning.
 */

type Palette = "neutral" | "brand" | "success" | "warning" | "danger" | "critical" | "info";

const PALETTE: Record<Palette, string> = {
  neutral: "bg-surface-muted text-ink-secondary ring-hairline",
  brand: "bg-brand-soft text-[#0b5f58] ring-[#a9e2da]",
  success: "bg-success-soft text-[#07684a] ring-[#b9e7d5]",
  warning: "bg-warning-soft text-[#8a3f07] ring-[#f2d5b0]",
  danger: "bg-danger-soft text-[#a81c1c] ring-[#f3c2c2]",
  critical: "bg-[#991b1b] text-white ring-[#7f1616]",
  info: "bg-info-soft text-[#0a5a80] ring-[#b6ddf1]",
};

interface BadgeShellProps {
  palette: Palette;
  icon: React.ReactNode;
  label: string;
  className?: string;
}

function BadgeShell({ palette, icon, label, className }: BadgeShellProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 ring-inset",
        PALETTE[palette],
        className,
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      {label}
    </span>
  );
}

const ICON = "size-3.5";

const APPOINTMENT_CONFIG: Record<
  AppointmentStatus,
  { label: string; palette: Palette; icon: React.ReactNode }
> = {
  REQUESTED: { label: "Requested", palette: "neutral", icon: <Clock className={ICON} /> },
  PENDING_CONFIRMATION: { label: "Awaiting confirmation", palette: "warning", icon: <Clock className={ICON} /> },
  CONFIRMED: { label: "Confirmed", palette: "info", icon: <CircleCheck className={ICON} /> },
  PAYMENT_PENDING: { label: "Payment pending", palette: "warning", icon: <CircleDollarSign className={ICON} /> },
  READY: { label: "Ready", palette: "info", icon: <CircleCheck className={ICON} /> },
  CHECKED_IN: { label: "Checked in", palette: "success", icon: <UserCheck className={ICON} /> },
  IN_QUEUE: { label: "In queue", palette: "brand", icon: <Clock className={ICON} /> },
  IN_CONSULTATION: { label: "With doctor", palette: "brand", icon: <Stethoscope className={ICON} /> },
  COMPLETED: { label: "Completed", palette: "success", icon: <CircleCheck className={ICON} /> },
  CANCELLED: { label: "Cancelled", palette: "neutral", icon: <CircleX className={ICON} /> },
  RESCHEDULED: { label: "Rescheduled", palette: "info", icon: <CalendarClock className={ICON} /> },
  NO_SHOW: { label: "No show", palette: "danger", icon: <CircleX className={ICON} /> },
};

export function StatusBadge({
  status,
  className,
}: {
  status: AppointmentStatus;
  className?: string;
}) {
  const cfg = APPOINTMENT_CONFIG[status];
  return <BadgeShell palette={cfg.palette} icon={cfg.icon} label={cfg.label} className={className} />;
}

/**
 * The REAL appointment statuses (Stage 4), as opposed to the mock vocabulary
 * above which still drives the unbuilt phases.
 *
 * Kept in this file rather than hand-rolled in the feature so that every status
 * pill in the product goes on looking and behaving the same — icon plus text,
 * never colour alone.
 */
const LIVE_APPOINTMENT_CONFIG: Record<
  LiveAppointmentStatus,
  { label: string; palette: Palette; icon: React.ReactNode }
> = {
  SCHEDULED: { label: "Booked", palette: "neutral", icon: <CalendarClock className={ICON} /> },
  CONFIRMED: { label: "Confirmed", palette: "info", icon: <CircleCheck className={ICON} /> },
  ARRIVED: { label: "Waiting", palette: "warning", icon: <UserCheck className={ICON} /> },
  IN_CONSULTATION: { label: "With doctor", palette: "brand", icon: <Stethoscope className={ICON} /> },
  COMPLETED: { label: "Seen", palette: "success", icon: <CircleCheck className={ICON} /> },
  CANCELLED: { label: "Cancelled", palette: "neutral", icon: <CircleX className={ICON} /> },
  NO_SHOW: { label: "Did not come", palette: "danger", icon: <CircleX className={ICON} /> },
};

export function AppointmentStatusBadge({
  status,
  className,
}: {
  status: LiveAppointmentStatus;
  className?: string;
}) {
  const cfg = LIVE_APPOINTMENT_CONFIG[status];
  return <BadgeShell palette={cfg.palette} icon={cfg.icon} label={cfg.label} className={className} />;
}

const PAYMENT_CONFIG: Record<
  PaymentStatus,
  { label: string; palette: Palette; icon: React.ReactNode }
> = {
  UNPAID: { label: "Unpaid", palette: "warning", icon: <CircleDollarSign className={ICON} /> },
  PARTIAL: { label: "Part paid", palette: "warning", icon: <CircleDollarSign className={ICON} /> },
  PAID: { label: "Paid", palette: "success", icon: <CircleCheck className={ICON} /> },
  REFUNDED: { label: "Refunded", palette: "neutral", icon: <CircleAlert className={ICON} /> },
  WAIVED: { label: "Waived", palette: "neutral", icon: <CircleCheck className={ICON} /> },
};

export function PaymentBadge({
  status,
  className,
}: {
  status: PaymentStatus;
  className?: string;
}) {
  const cfg = PAYMENT_CONFIG[status];
  return <BadgeShell palette={cfg.palette} icon={cfg.icon} label={cfg.label} className={className} />;
}

const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; palette: Palette; icon: React.ReactNode }
> = {
  none: { label: "No issue", palette: "success", icon: <CircleCheck className={ICON} /> },
  caution: { label: "Review", palette: "warning", icon: <CircleAlert className={ICON} /> },
  serious: { label: "Serious", palette: "danger", icon: <TriangleAlert className={ICON} /> },
  critical: { label: "Critical", palette: "critical", icon: <OctagonAlert className={ICON} /> },
};

export function SeverityBadge({
  severity,
  label,
  className,
}: {
  severity: Severity;
  /** Override the default word; the icon and colour still carry the severity. */
  label?: string;
  className?: string;
}) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <BadgeShell
      palette={cfg.palette}
      icon={cfg.icon}
      label={label ?? cfg.label}
      className={className}
    />
  );
}

export function severityIcon(severity: Severity, className?: string) {
  const map: Record<Severity, React.ReactNode> = {
    none: <CircleCheck className={cn("text-success", className)} />,
    caution: <CircleAlert className={cn("text-warning", className)} />,
    serious: <TriangleAlert className={cn("text-danger", className)} />,
    critical: <OctagonAlert className={cn("text-sev-critical", className)} />,
  };
  return map[severity];
}
