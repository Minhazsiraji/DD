import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import {
  Users,
  CalendarDays,
  ListChecks,
  UserPlus,
  Search,
  TriangleAlert,
  CircleCheck,
  Activity,
} from "lucide-react";
import { StatCard } from "@/components/common/stat-card";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { GlassCard } from "@/components/glass/glass-card";
import { RecentPatients } from "@/features/dashboard/components/recent-patients";
import { D1PilotActivity } from "@/features/dashboard/components/d1-pilot-activity";
import { getD1DashboardPilotData, type D1DashboardPilotOutcome } from "@/features/dashboard/d1-queries";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logPreviewElapsed, startPreviewTimer, timedPreviewStage } from "@/lib/preview-timing";
import {
  getDashboardRecentPatients,
  getPatientCount,
  clinicToday,
} from "@/features/patients/queries";
import { getDashboardDayCounts } from "@/features/appointments/queries";
import { todayInDhaka } from "@/features/appointments/schema";
import { getQueue } from "@/features/queue/queries";
import { groupQueue } from "@/features/queue/schema";
import { WorkNow } from "@/features/dashboard/components/work-now";
import {
  getM1DoctorAuthority,
  getM1FinderScope,
  getM1LocationContext,
  localDateInTimeZone,
} from "@/features/patients/m1-context";

export const metadata: Metadata = { title: "Dashboard" };

type LocationContext = Awaited<ReturnType<typeof getM1LocationContext>>;
type PatientCount = Awaited<ReturnType<typeof getPatientCount>>;
type DayCounts = Awaited<ReturnType<typeof getDashboardDayCounts>>;
type RecentOutcome = Awaited<ReturnType<typeof getDashboardRecentPatients>>;
type QueueOutcome = Awaited<ReturnType<typeof getQueue>>;
type DoctorAuthority = Awaited<ReturnType<typeof getM1DoctorAuthority>>;

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Dhaka",
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Dashboard data starts together, but sections stream independently. A slow
 * queue must not hold Recent Patients, stats, or static Quick Actions hostage.
 */
export default async function DashboardPage() {
  const dashboardStarted = startPreviewTimer();
  const supabasePromise = createSupabaseServerClient();
  const locationPromise = timedPreviewStage(
    "m1-dashboard-timing",
    "location_session_context",
    getM1LocationContext(),
  );
  const scopePromise = timedPreviewStage(
    "m1-dashboard-timing",
    "doctor_scope",
    getM1FinderScope(),
  );
  const authorityPromise = timedPreviewStage(
    "m1-dashboard-timing",
    "doctor_authority",
    getM1DoctorAuthority(),
  );

  const basePromise = Promise.all([locationPromise, scopePromise]).then(([ctx, scope]) => ({
    ctx,
    doctorId: scope.doctorId,
    sessionDate: ctx.timeZone ? localDateInTimeZone(ctx.timeZone) : todayInDhaka(),
  }));

  const doctorNamePromise = Promise.all([locationPromise, supabasePromise]).then(
    async ([ctx, supabase]) => {
      const { data: profile } = await timedPreviewStage(
        "m1-dashboard-timing",
        "profile",
        supabase.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
      );
      return profile?.full_name ?? ctx.user.email?.split("@")[0] ?? "Doctor";
    },
  );

  const statsPromise = basePromise.then(async ({ ctx, doctorId, sessionDate }) => {
    const [patients, today] = await Promise.all([
      timedPreviewStage("m1-dashboard-timing", "patient_count", getPatientCount(doctorId)),
      timedPreviewStage(
        "m1-dashboard-timing",
        "day_counts",
        getDashboardDayCounts(sessionDate, ctx.locationId, doctorId),
      ),
    ]);
    return { patients, today };
  });

  const recentPromise = basePromise.then(async ({ ctx, doctorId }) => {
    const recent = await timedPreviewStage(
      "m1-dashboard-timing",
      "recent_patients",
      getDashboardRecentPatients(6, doctorId),
    );
    return { recent, doctorId, locationName: ctx.locationName };
  });

  const workNowPromise = basePromise.then(async ({ ctx, doctorId, sessionDate }) => {
    const queue = await timedPreviewStage(
      "m1-dashboard-timing",
      "queue_work_now",
      getQueue(ctx.locationId, sessionDate),
    );
    return { queue, doctorId, locationName: ctx.locationName };
  });

  const pilotPromise: Promise<D1DashboardPilotOutcome> = basePromise.then(async ({ ctx, doctorId }) => {
    if (!doctorId) return { ok: false, reason: "unavailable" };
    return timedPreviewStage(
      "m1-dashboard-timing",
      "d1_pilot_activity",
      getD1DashboardPilotData(ctx.locationId, doctorId, 6),
    );
  });

  void Promise.all([
    doctorNamePromise,
    statsPromise,
    recentPromise,
    workNowPromise,
    pilotPromise,
    authorityPromise,
  ])
    .catch(() => undefined)
    .finally(() =>
      logPreviewElapsed("m1-dashboard-timing", "total_dashboard_server", dashboardStarted),
    );

  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-5">
      <Suspense fallback={<DashboardHeaderFallback />}>
        <DashboardHeader ctxPromise={locationPromise} doctorNamePromise={doctorNamePromise} />
      </Suspense>

      <Suspense fallback={<DashboardStatsFallback />}>
        <DashboardStats statsPromise={statsPromise} />
      </Suspense>

      <div className="grid w-full min-w-0 gap-4 sm:gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-5 xl:col-span-2">
          <Suspense fallback={<SectionLoading title="Work now" icon={<ListChecks className="size-4" />} />}>
            <DashboardWorkNow workNowPromise={workNowPromise} authorityPromise={authorityPromise} />
          </Suspense>

          <Suspense fallback={<SectionLoading title="Recent work" icon={<Activity className="size-4" />} />}>
            <DashboardPilotActivity pilotPromise={pilotPromise} />
          </Suspense>

          <Suspense fallback={<SectionLoading title="Recent patients" icon={<Users className="size-4" />} />}>
            <DashboardRecentPatients recentPromise={recentPromise} />
          </Suspense>
        </div>

        <QuickActions />
      </div>
    </div>
  );
}

async function DashboardHeader({
  ctxPromise,
  doctorNamePromise,
}: {
  ctxPromise: Promise<LocationContext>;
  doctorNamePromise: Promise<string>;
}) {
  const [ctx, doctorName] = await Promise.all([ctxPromise, doctorNamePromise]);
  return (
    <header className="flex w-full min-w-0 flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3">
      <h1 className="min-w-0 text-lg font-semibold text-ink sm:text-xl">
        <span className="font-normal text-ink-secondary">{greeting()}, </span>
        {doctorName}
      </h1>
      <p className="max-w-full break-words text-[13px] text-ink-secondary">
        {ctx.locationName} · {formatDate(clinicToday())}
      </p>
    </header>
  );
}

async function DashboardStats({
  statsPromise,
}: {
  statsPromise: Promise<{ patients: PatientCount; today: DayCounts }>;
}) {
  const { patients, today } = await statsPromise;
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-3 [&>*]:min-w-0 min-[480px]:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      {patients.ok ? (
        <StatCard
          label="Patients"
          value={patients.count}
          icon={<Users className="size-5" />}
          accent="brand"
          hint="In your repository"
          href="/patients"
        />
      ) : (
        <UnavailableStat label="Patients" icon={<Users className="size-5" />} />
      )}
      {today.ok ? (
        <StatCard
          label="Seen today"
          value={today.counts.completed}
          icon={<CircleCheck className="size-5" />}
          accent="success"
          hint={today.counts.cancelled > 0 ? `${today.counts.cancelled} cancelled` : "Consultations finished"}
          href="/appointments"
        />
      ) : (
        <UnavailableStat label="Seen today" icon={<CircleCheck className="size-5" />} />
      )}
      {today.ok ? (
        <StatCard
          label="Appointments"
          value={today.counts.total}
          icon={<CalendarDays className="size-5" />}
          accent="brand"
          hint={
            today.counts.online > 0
              ? `${today.counts.online} online booking${today.counts.online === 1 ? "" : "s"}`
              : today.counts.completed > 0
                ? `${today.counts.completed} seen so far`
                : "Booked here today"
          }
          href="/appointments"
        />
      ) : (
        <UnavailableStat label="Appointments" icon={<CalendarDays className="size-5" />} />
      )}
      {today.ok ? (
        <StatCard
          label="Waiting now"
          value={today.counts.waiting}
          icon={<ListChecks className="size-5" />}
          accent={today.counts.waiting > 0 ? "warning" : "info"}
          hint={
            today.counts.inConsultation > 0
              ? `${today.counts.inConsultation} with the doctor`
              : "Checked in and waiting"
          }
          href="/appointments"
        />
      ) : (
        <UnavailableStat label="Waiting now" icon={<ListChecks className="size-5" />} />
      )}
    </div>
  );
}

async function DashboardWorkNow({
  workNowPromise,
  authorityPromise,
}: {
  workNowPromise: Promise<{ queue: QueueOutcome; doctorId: string | null; locationName: string }>;
  authorityPromise: Promise<DoctorAuthority>;
}) {
  const [{ queue, doctorId, locationName }, authority] = await Promise.all([
    workNowPromise,
    authorityPromise,
  ]);
  const mine = queue.ok
    ? queue.rows.filter((row) => !doctorId || row.ownerDoctorId === doctorId)
    : [];
  const groups = groupQueue(mine);
  return (
    <WorkNow
      current={groups.withDoctor[0] ?? null}
      next={groups.waiting[0] ?? null}
      failed={!queue.ok}
      waitingCount={groups.waiting.length}
      locationName={locationName}
      canClinical={authority.canClinical}
    />
  );
}

async function DashboardPilotActivity({
  pilotPromise,
}: {
  pilotPromise: Promise<D1DashboardPilotOutcome>;
}) {
  return <D1PilotActivity outcome={await pilotPromise} />;
}

async function DashboardRecentPatients({
  recentPromise,
}: {
  recentPromise: Promise<{ recent: RecentOutcome; doctorId: string | null; locationName: string }>;
}) {
  const { recent, doctorId, locationName } = await recentPromise;
  const patients = recent.ok
    ? doctorId
      ? recent.patients.filter((patient) => patient.ownerDoctorId === doctorId)
      : recent.patients
    : [];

  if (patients.length > 0) {
    return (
      <RecentPatients
        patients={patients.map((patient) => ({
          id: patient.id,
          patientNumber: patient.patientNumber,
          fullName: patient.fullName,
          ageYears: patient.ageYears,
          sex: patient.sex,
          seenOn: patient.createdAt.slice(0, 10),
          reason: "Registered",
          locationName: patient.lastSeenLocation ?? locationName,
        }))}
      />
    );
  }

  if (!recent.ok) {
    return (
      <SectionCard className="overflow-hidden">
        <SectionHeader title="Recent patients" icon={<Users className="size-4" />} />
        <div className="p-4 sm:p-5">
          <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] font-medium text-ink">
            <TriangleAlert className="mt-px size-4 shrink-0 text-[#8a3f07]" aria-hidden="true" />
            Your patient list could not be loaded. This is not an empty repository — reload before
            registering anyone new.
          </p>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader title="Recent patients" icon={<Users className="size-4" />} />
      <EmptyState
        icon={<UserPlus className="size-5" />}
        title="No patients yet"
        description="Register your first patient to get started. They belong to you alone — no other doctor can see them."
        action={
          <Link
            href="/patients/new"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring"
          >
            <UserPlus className="size-4" aria-hidden="true" />
            Register a patient
          </Link>
        }
      />
    </SectionCard>
  );
}

function QuickActions() {
  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <SectionCard className="overflow-hidden">
        <SectionHeader title="Quick actions" icon={<Search className="size-4" />} />
        <div className="space-y-2 p-4 sm:p-5">
          <QuickAction href="/queue" icon={<ListChecks className="size-4 text-brand" />} label="Live queue" />
          <QuickAction href="/appointments" icon={<CalendarDays className="size-4 text-brand" />} label="Book or add a walk-in" />
          <QuickAction href="/patients/new" icon={<UserPlus className="size-4 text-brand" />} label="Register a patient" />
          <QuickAction href="/patients" icon={<Search className="size-4 text-brand" />} label="Find a patient" />
        </div>
      </SectionCard>
    </div>
  );
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="dd-quick-row dd-quick-control flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold focus-visible:focus-ring"
    >
      {icon}
      {label}
    </Link>
  );
}

function DashboardHeaderFallback() {
  return (
    <div className="h-12 w-full animate-pulse rounded-xl bg-white/30" aria-label="Loading dashboard heading" />
  );
}

function DashboardStatsFallback() {
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4 lg:grid-cols-4" aria-label="Loading dashboard statistics">
      {Array.from({ length: 4 }, (_, index) => (
        <GlassCard key={index} className="h-[150px] animate-pulse p-5" />
      ))}
    </div>
  );
}

function SectionLoading({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader title={title} icon={icon} />
      <div className="p-4 sm:p-5">
        <div className="h-16 animate-pulse rounded-xl bg-white/30" aria-label={`Loading ${title}`} />
      </div>
    </SectionCard>
  );
}

function UnavailableStat({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning-soft text-[#8a3f07]"
          aria-hidden="true"
        >
          {icon}
        </span>
        <TriangleAlert className="size-6 text-[#8a3f07]" aria-hidden="true" />
      </div>
      <div className="mt-4">
        <p className="text-sm font-semibold text-ink-secondary">{label}</p>
        <p className="mt-0.5 text-xs font-medium text-[#8a3f07]">Temporarily unavailable</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          This is not an empty schedule — reload before relying on it.
        </p>
      </div>
    </GlassCard>
  );
}
