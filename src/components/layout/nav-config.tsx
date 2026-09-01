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
  /**
   * Which live count belongs beside this item, if any.
   *
   * A KEY, not a number. The numbers were the literals 7 and 24, written as
   * Phase-1 placeholders and never replaced — so the sidebar said "Live Queue
   * 7" above an empty waiting room, and every doctor saw the same 7 and 24. A
   * number beside "Live Queue" is read as a fact about the room.
   *
   * The value is resolved per request, from the caller's own authorised reads,
   * scoped to their ACTIVE location. Nothing static can be shown here again.
   */
  badgeKey?: "waiting" | "appointmentsToday";
}

const ICON = "size-[18px]";

/** Desktop sidebar / tablet rail — the full workspace map. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className={ICON} /> },
  { href: "/queue", label: "Live Queue", icon: <ListChecks className={ICON} />, badgeKey: "waiting" },
  /*
    Reception's way to a signed prescription. Listed for everyone because the
    page shows only what the caller is already authorised to hand over — a
    doctor sees their own, and nobody sees another location's. Hiding it by
    role would be authorisation in the menu, which is not authorisation.
  */
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

/**
 * The central "+" menu. Ordered by how often a chamber actually uses them.
 *
 * EVERY ENTRY MUST GO SOMEWHERE THAT EXISTS.
 *
 * Four of these were Phase-1 placeholders pointing at routes that were never
 * built — `/appointments/new`, `/consultation/new`, `/prescriptions/new` and
 * `/documents/upload`. Three answered 404. The fourth was worse: it landed on
 * the consultation route, which read "new" as an encounter id, failed to load
 * it, and told the doctor "The record exists — we simply could not reach it
 * just now. Do not start a new consultation for this patient." That is a
 * confident, specific, and completely false statement, and it was the first
 * thing a doctor would hit when trying to start a consultation.
 *
 * They now point at the screens that DO the work: appointments has "Book an
 * appointment", the live queue has "Start consultation", and a prescription is
 * written from inside a consultation — which is also the only place it can
 * legitimately begin, since a prescription belongs to an encounter.
 */
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
    /**
     * `/documents/upload` was one of the four dead placeholders above. It is a
     * real route as of Module D / Phase D1, and the quick action points at the
     * screen that DOES the work rather than at the list beside it — filing a
     * report is the action; reading the list is not.
     */
    href: "/documents/upload",
    label: "Upload Document",
    description: "File a lab or imaging report",
    icon: <Upload className="size-[18px]" />,
    accent: "info",
  },
];

