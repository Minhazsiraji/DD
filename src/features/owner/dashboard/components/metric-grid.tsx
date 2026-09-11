import * as React from "react";
import {
  Activity,
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Clock,
  Gauge,
  KeyRound,
  Mic,
  Pill,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrbAccent } from "@/components/common/icon-orb";
import { MetricTile } from "./metric-tile";
import type { MetricSpec } from "../catalog";
import type { MeasurementMap } from "../sources";

/**
 * Icons are chosen here, not in the catalog, so the catalog stays pure data
 * that a privacy test can read without rendering JSX.
 */
const ICON = "size-5";
const ICONS: Record<string, React.ReactNode> = {
  totalDoctors: <Users className={ICON} />,
  doctorsRegistered: <Users className={ICON} />,
  activeToday: <Activity className={ICON} />,
  active7d: <Activity className={ICON} />,
  active30d: <Activity className={ICON} />,
  newDoctors: <UserPlus className={ICON} />,
  doctorsVerified: <BadgeCheck className={ICON} />,
  consultationsCompleted: <Stethoscope className={ICON} />,
  firstConsultation: <Stethoscope className={ICON} />,
  consultationsAbandoned: <Stethoscope className={ICON} />,
  prescriptionsFinalized: <Pill className={ICON} />,
  prescriptionsCorrected: <Pill className={ICON} />,
  appointmentsNoShow: <CalendarDays className={ICON} />,
  bookingEnabled: <CalendarDays className={ICON} />,
  aiRequests: <Sparkles className={ICON} />,
  aiAdoption: <Sparkles className={ICON} />,
  inputTokens: <Sparkles className={ICON} />,
  outputTokens: <Sparkles className={ICON} />,
  acceptanceRate: <TrendingUp className={ICON} />,
  voiceMinutes: <Mic className={ICON} />,
  aiSpend: <Wallet className={ICON} />,
  aiSpendUsd: <Wallet className={ICON} />,
  voiceSpendUsd: <Wallet className={ICON} />,
  fixedCostUsd: <CircleDollarSign className={ICON} />,
  totalOperatingUsd: <CircleDollarSign className={ICON} />,
  totalOperatingBdt: <CircleDollarSign className={ICON} />,
  costPerActiveUsd: <CircleDollarSign className={ICON} />,
  providerErrorRate: <Gauge className={ICON} />,
  providerFailures: <Gauge className={ICON} />,
  providerRetries: <Gauge className={ICON} />,
  systemHealth: <Gauge className={ICON} />,
  mfaEnrolled: <ShieldCheck className={ICON} />,
  authFailures: <KeyRound className={ICON} />,
  privilegedGrants: <ShieldCheck className={ICON} />,
  selfGrantedRoles: <ShieldCheck className={ICON} />,
  publicProfiles: <Users className={ICON} />,
};

const ACCENTS: OrbAccent[] = ["brand", "violet", "success", "info"];

/**
 * A responsive grid of tiles.
 *
 * `columns` picks the desktop density: the Overview's ten cards sit five across
 * at `xl` (two rows), the six-metric sections three across. Below 480px every
 * grid is a single column — a 360px phone cannot hold two tiles whose labels
 * are sentences.
 */
export function MetricGrid({
  specs,
  measurements,
  columns = 3,
  label,
}: {
  specs: readonly MetricSpec[];
  measurements: MeasurementMap;
  columns?: 3 | 5;
  label: string;
}) {
  return (
    <ul
      aria-label={label}
      data-mobile-metric-grid
      className={cn(
        "grid w-full min-w-0 grid-cols-1 gap-3 [&>*]:min-w-0 min-[480px]:grid-cols-2 sm:gap-4",
        columns === 5 ? "lg:grid-cols-3 xl:grid-cols-5" : "lg:grid-cols-3",
      )}
    >
      {specs.map((spec, i) => (
        <li key={spec.key} className="min-w-0">
          <MetricTile
            spec={spec}
            measurement={measurements[spec.key] ?? { state: "unavailable" }}
            icon={ICONS[spec.key] ?? <Clock className={ICON} />}
            accent={ACCENTS[i % ACCENTS.length]}
          />
        </li>
      ))}
    </ul>
  );
}
