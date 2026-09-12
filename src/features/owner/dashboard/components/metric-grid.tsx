import * as React from "react";
import {
  Activity,
  CalendarCheck,
  CircleDollarSign,
  Clock,
  EyeOff,
  Gauge,
  KeyRound,
  LogOut,
  MailPlus,
  ShieldCheck,
  Timer,
  TrendingUp,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrbAccent } from "@/components/common/icon-orb";
import { MetricTile } from "./metric-tile";
import type { MetricSpec } from "../catalog";
import type { MeasurementMap } from "../measurement";

/**
 * Icons are chosen here, not in the catalog, so the catalog stays pure data
 * that a privacy test can read without rendering JSX.
 */
const ICON = "size-5";
const ICONS: Record<string, React.ReactNode> = {
  activeDoctors: <Activity className={ICON} />,
  sessions: <Timer className={ICON} />,
  engagedMinutes: <Clock className={ICON} />,
  invited: <MailPlus className={ICON} />,
  enrolled: <UserCheck className={ICON} />,
  completed: <CalendarCheck className={ICON} />,
  withdrawn: <UserMinus className={ICON} />,
  consented: <ShieldCheck className={ICON} />,
  activeDays: <CalendarCheck className={ICON} />,
  featureTouches: <TrendingUp className={ICON} />,
  dau: <Users className={ICON} />,
  timeSaved: <Timer className={ICON} />,
  totalCost: <CircleDollarSign className={ICON} />,
  mfaEnrolment: <ShieldCheck className={ICON} />,
  failedOwnerAuth: <KeyRound className={ICON} />,
  consentWithdrawals: <LogOut className={ICON} />,
  suppressedBuckets: <EyeOff className={ICON} />,
  providerHealth: <Gauge className={ICON} />,
};

const ACCENTS: OrbAccent[] = ["brand", "violet", "success", "info"];

/**
 * A responsive grid of tiles.
 *
 * `columns` picks the desktop density. Below 480px every grid is a single
 * column — a 360px phone cannot hold two tiles whose values are sentences.
 */
export function MetricGrid({
  specs,
  measurements,
  columns = 3,
  label,
}: {
  specs: readonly MetricSpec[];
  measurements: MeasurementMap;
  columns?: 3 | 6;
  label: string;
}) {
  return (
    <ul
      aria-label={label}
      data-mobile-metric-grid
      className={cn(
        "grid w-full min-w-0 grid-cols-1 gap-3 [&>*]:min-w-0 min-[480px]:grid-cols-2 sm:gap-4",
        columns === 6 ? "lg:grid-cols-3 xl:grid-cols-6" : "lg:grid-cols-3",
      )}
    >
      {specs.map((spec, i) => (
        <li key={spec.key} className="min-w-0">
          <MetricTile
            spec={spec}
            /**
             * A key the source never mentioned is never a zero. Which absence
             * it is depends on why: a metric with a named lane still owed has
             * no source at all yet (`Not measured`); anything else had a source
             * that did not answer (`Unavailable`).
             */
            measurement={
              measurements[spec.key] ??
              (spec.awaiting ? { state: "not-measured", lane: spec.awaiting.lane } : { state: "unavailable" })
            }
            icon={ICONS[spec.key] ?? <Clock className={ICON} />}
            accent={ACCENTS[i % ACCENTS.length]}
          />
        </li>
      ))}
    </ul>
  );
}
