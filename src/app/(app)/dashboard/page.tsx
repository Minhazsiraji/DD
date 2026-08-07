import type { Metadata } from "next";
import { CalendarDays, Users, FileText, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { NowServing } from "@/features/dashboard/components/now-serving";
import { AttentionPanel } from "@/features/dashboard/components/attention-panel";
import { QueuePreview } from "@/features/dashboard/components/queue-preview";
import { ScheduleList } from "@/features/dashboard/components/schedule-list";
import { ReportsPanel } from "@/features/dashboard/components/reports-panel";
import { FollowUpsPanel } from "@/features/dashboard/components/followups-panel";
import { RecentPatients } from "@/features/dashboard/components/recent-patients";
import { formatDate } from "@/lib/format";
import { dashboardData } from "@/mocks/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const {
    doctor,
    locations,
    activeLocationId,
    todayISO,
    stats,
    currentToken,
    currentPatient,
    nextPatient,
    queue,
    schedule,
    reports,
    followUps,
    recentPatients,
    attention,
  } = dashboardData;

  const activeLocation = locations.find((l) => l.id === activeLocationId);

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Good evening"
        title={doctor.fullName}
        subtitle={`${activeLocation?.name ?? doctor.practiceName} · ${formatDate(todayISO)}`}
      />

      {/* ---- Summary tiles. Glass is appropriate: summary, not clinical data. ---- */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Appointments today"
          value={stats.appointmentsToday}
          icon={<CalendarDays className="size-5" />}
          accent="brand"
          href="/appointments"
        />
        <StatCard
          label="Patients waiting"
          value={stats.waiting}
          icon={<Users className="size-5" />}
          accent="violet"
          hint="In the chamber now"
          href="/queue"
        />
        <StatCard
          label="Reports"
          value={stats.reportsPending}
          icon={<FileText className="size-5" />}
          accent="warning"
          hint="2 abnormal"
          href="/reports"
        />
        <StatCard
          label="Follow-ups due"
          value={stats.followUpsDue}
          icon={<CalendarClock className="size-5" />}
          accent="danger"
          hint="2 overdue"
          href="/followups"
        />
      </div>

      {/* ---- The primary action zone. ---- */}
      <NowServing
        currentToken={currentToken}
        current={currentPatient}
        next={nextPatient}
      />

      {/* ---- Working columns. ---- */}
      <div className="grid gap-4 sm:gap-5 xl:grid-cols-3">
        <div className="space-y-4 sm:space-y-5 xl:col-span-2">
          <QueuePreview queue={queue} />
          <ScheduleList slots={schedule} />
          <RecentPatients patients={recentPatients} />
        </div>

        <div className="space-y-4 sm:space-y-5">
          <AttentionPanel items={attention} />
          <ReportsPanel reports={reports} />
          <FollowUpsPanel followUps={followUps} todayISO={todayISO} />
        </div>
      </div>

      <p className="pt-1 text-center text-xs text-ink-muted">
        Phase 1 · All data shown is fictional mock data. No database, no
        authentication, no live AI.
      </p>
    </div>
  );
}
