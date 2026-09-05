import * as React from "react";
import {
  LayoutDashboard,
  ListChecks,
  CalendarDays,
  Users,
  Pill,
  FileText,
  CircleDollarSign,
  Settings,
  UserPlus,
  CalendarPlus,
  Stethoscope,
  ClipboardPlus,
  Upload,
  Printer,
} from "lucide-react";
import type { OrbAccent } from "@/components/common/icon-orb";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badgeKey?: "waiting" | "appointmentsToday";
}

const ICON = "size-[18px]";

/** Desktop sidebar / tablet rail — keep the full working workspace map from main. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className={ICON} /> },
  { href: "/queue", label: "Live Queue", icon: <ListChecks className={ICON} />, badgeKey: "waiting" },
  { href: "/handover", label: "Hand Over", icon: <Printer className={ICON} /> },
  {
    href: "/appointments",
    label: "Appointments",
    icon: <CalendarDays className={ICON} />,
    badgeKey: "appointmentsToday",
  },
  { href: "/patients", label: "Patients", icon: <Users className={ICON} /> },
  { href: "/medicines", label: "Medicines", icon: <Pill className={ICON} /> },
  { href: "/documents", label: "Documents", icon: <FileText className={ICON} /> },
  { href: "/payments", label: "Payments", icon: <CircleDollarSign className={ICON} /> },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: <Settings className={ICON} /> },
];

export const MOBILE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: <LayoutDashboard className="size-5" /> },
  { href: "/patients", label: "Patients", icon: <Users className="size-5" /> },
  { href: "/appointments", label: "Appointments", icon: <CalendarDays className="size-5" /> },
  { href: "/more", label: "More", icon: <ListChecks className="size-5" /> },
];

export interface QuickAction {
  href: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  accent: OrbAccent;
}

/** Existing working routes only; no clinical authority is changed here. */
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
    description: "Send in the next patient who has arrived",
    icon: <Stethoscope className="size-[18px]" />,
    accent: "success",
  },
  {
    href: "/handover",
    label: "Hand Over a Prescription",
    description: "Print a signed prescription for the patient",
    icon: <ClipboardPlus className="size-[18px]" />,
    accent: "warning",
  },
  {
    href: "/documents",
    label: "Documents",
    description: "Lab and imaging reports",
    icon: <Upload className="size-[18px]" />,
    accent: "info",
  },
];
