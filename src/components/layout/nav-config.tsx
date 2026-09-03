import * as React from "react";
import {
  CalendarDays,
  Users,
  MoreHorizontal,
  UserPlus,
  CalendarPlus,
  Stethoscope,
  ClipboardPlus,
  Upload,
  Home,
} from "lucide-react";
import type { OrbAccent } from "@/components/common/icon-orb";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badgeKey?: "waiting" | "appointmentsToday";
}

const ICON = "size-[18px]";

/**
 * Friendly Doctor Pilot navigation — deliberately patient-flow first.
 * Deeper modules stay contextual or live behind More.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: <Home className={ICON} /> },
  { href: "/patients", label: "Patients", icon: <Users className={ICON} /> },
  {
    href: "/appointments",
    label: "Appointments",
    icon: <CalendarDays className={ICON} />,
    badgeKey: "appointmentsToday",
  },
  { href: "/more", label: "More", icon: <MoreHorizontal className={ICON} /> },
];

/** Settings and operational modules are intentionally accessed through More. */
export const SECONDARY_NAV: NavItem[] = [];

/** Mobile bottom navigation mirrors the locked Pilot IA. */
export const MOBILE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: <Home className="size-5" /> },
  { href: "/patients", label: "Patients", icon: <Users className="size-5" /> },
  { href: "/appointments", label: "Appointments", icon: <CalendarDays className="size-5" /> },
  { href: "/more", label: "More", icon: <MoreHorizontal className="size-5" /> },
];

export interface QuickAction {
  href: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  accent: OrbAccent;
}

/** Quick actions remain task-based, never module-based. */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    href: "/patients/new",
    label: "New Patient",
    description: "Register and check for an existing record",
    icon: <UserPlus className="size-[18px]" />,
    accent: "brand",
  },
  {
    href: "/appointments",
    label: "Book Appointment",
    description: "Book a slot for today or another day",
    icon: <CalendarPlus className="size-[18px]" />,
    accent: "violet",
  },
  {
    href: "/queue",
    label: "Start Consultation",
    description: "Open the live queue and start the next patient",
    icon: <Stethoscope className="size-[18px]" />,
    accent: "success",
  },
  {
    href: "/handover",
    label: "Hand Over Prescription",
    description: "Print or hand over a finalized prescription",
    icon: <ClipboardPlus className="size-[18px]" />,
    accent: "warning",
  },
  {
    href: "/documents",
    label: "Documents",
    description: "Open lab, imaging and uploaded documents",
    icon: <Upload className="size-[18px]" />,
    accent: "info",
  },
];
