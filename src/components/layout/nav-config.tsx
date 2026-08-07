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
} from "lucide-react";
import type { OrbAccent } from "@/components/common/icon-orb";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Shown as a count chip in the sidebar. Mock values in Phase 1. */
  badge?: number;
}

const ICON = "size-[18px]";

/** Desktop sidebar / tablet rail — the full workspace map. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className={ICON} /> },
  { href: "/queue", label: "Live Queue", icon: <ListChecks className={ICON} />, badge: 7 },
  { href: "/appointments", label: "Appointments", icon: <CalendarDays className={ICON} />, badge: 24 },
  { href: "/patients", label: "Patients", icon: <Users className={ICON} /> },
  { href: "/medicines", label: "Medicines", icon: <Pill className={ICON} /> },
  { href: "/documents", label: "Documents", icon: <FileText className={ICON} /> },
  { href: "/payments", label: "Payments", icon: <CircleDollarSign className={ICON} /> },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: <Settings className={ICON} /> },
];

/**
 * Mobile bottom navigation — exactly five slots, the centre one being the
 * quick-action trigger. Four destinations is the practical ceiling for a
 * thumb-reachable bar; everything else lives behind "More".
 */
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

/** The central "+" menu. Ordered by how often a chamber actually uses them. */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    href: "/patients/new",
    label: "New Patient",
    description: "Register and check for an existing record",
    icon: <UserPlus className="size-[18px]" />,
    accent: "brand",
  },
  {
    href: "/appointments/new",
    label: "New Appointment",
    description: "Book a slot and issue a token",
    icon: <CalendarPlus className="size-[18px]" />,
    accent: "violet",
  },
  {
    href: "/consultation/new",
    label: "Start Consultation",
    description: "Open an encounter for the current patient",
    icon: <Stethoscope className="size-[18px]" />,
    accent: "success",
  },
  {
    href: "/prescriptions/new",
    label: "New Prescription",
    description: "Write a structured prescription",
    icon: <ClipboardPlus className="size-[18px]" />,
    accent: "warning",
  },
  {
    href: "/documents/upload",
    label: "Upload Report",
    description: "Attach a lab or imaging report to a patient",
    icon: <Upload className="size-[18px]" />,
    accent: "info",
  },
];

