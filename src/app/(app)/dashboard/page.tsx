import type { Metadata } from "next";
import Link from "next/link";
import {
  Users,
  CalendarDays,
  ListChecks,
  UserPlus,
  Search,
  TriangleAlert,
  CircleCheck,
} from "lucide-react";
import { StatCard } from "@/components/common/stat-card";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { GlassCard } from "@/components/glass/glass-card";
import { RecentPatients } from "@/features/dashboard/components/recent-patients";
import { formatDate } from "@/lib/format";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getRecentPatients,
  getPatientCount,
  clinicToday,
  getCurrentDoctorId,
} from "@/features/patients/queries";
import { getDayCounts } from "@/features/appointments/queries";
import { todayInDhaka } from "@/features/appointments/schema";
import { getQueue } from "@/features/queue/queries";
import { groupQueue } from "@/features/queue/schema";
import { WorkNow } from "@/features/dashboard/components/work-now";

export const metadata: Metadata = { title: "Dashboard" };

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

export default async function DashboardPage() {
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const sessionDate = todayInDhaka();
  const myDoctorId = await getCurrentDoctorId();

  const [{ data: profile }, patients, recent, today, queue] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
    getPatientCount(myDoctorId),
    getRecentPatients(6, myDoctorId),
    getDayCounts(sessionDate, myDoctorId),
    getQueue(ctx.locationId, sessionDate),
  ]);

  const doctorName = profile?.full_name ?? ctx.user.email?.split("@")[0] ?? "Doctor";

  const mine = queue.ok
    ? queue.rows.filter((r) => !myDoctorId || r.ownerDoctorId === myDoctorId)
    : [];
  const groups = groupQueue(mine);
  const current = groups.withDoctor[0] ?? null;
  const next = groups.waiting[0] ?? null;

  const myRecent = recent.ok
    ? myDoctorId
      ? recent.patients.filter((p) => p.ownerDoctorId === myDoctorId)
      : recent.patients
    : [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-0.5">
        <h1 className="text-[17px] font-semibold text-ink sm:text-[19px]">
          <span className="font-normal text-ink-secondary">{greeting()}, </span>
          {doctorName}
        </h1>
        <p className="text-[11.5px] text-ink-secondary sm:text-[12.5px]">
          {ctx.locationName} · {formatDate(clinicToday())}
        </p>
      </header>

      {/* The operational question comes first: who is next / what should I do now? */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <WorkNow
          current={current}
          next={next}
          failed={!queue.ok}
          waitingCount={groups.waiting.length}
          locationName={ctx.locationName}
        />

        <SectionCard className="overflow-hidden">
          <SectionHeader title="Quick actions" icon={<Search className="size-4" />} />
          <div className="space-y-2 p-3.5 sm:p-4">
            <QuickAction href="/queue" icon={<ListChecks className="size-4 text-brand" aria-hidden="true" />} label="Live queue" />
            <QuickAction href="/appointments" icon={<CalendarDays className="size-4 text-brand" aria-hidden="true" />} label="Book or add a walk-in" />
            <QuickAction href="/patients/new" icon={<UserPlus className="size-4 text-brand" aria-hidden="true" />} label="Register a patient" />
            <QuickAction href="/patients" icon={<Search className="size-4 text-brand" aria-hidden="true" />} label="Find a patient" />
          </div>
        </SectionCard>
      </div>

      {/* Small operational summary, deliberately subordinate to Work now. */}
      <div className="grid grid-cols-2 gap-2.5 [&>*]:min-w-0 sm:gap-3 lg:grid-cols-4">
        {patients.ok ? (
          <StatCard label="Patients" value={patients.count} icon={<Users className="size-4" />} accent="brand" hint="In your repository" href="/patients" />
        ) : (
          <UnavailableStat label="Patients" icon={<Users className="size-4" />} />
        )}

        {today.ok ? (
          <StatCard
            label="Seen today"
            value={today.counts.completed}
            icon={<CircleCheck className="size-4" />}
            accent="success"
            hint={today.counts.cancelled > 0 ? `${today.counts.cancelled} cancelled` : "Consultations finished"}
            href="/appointments"
          />
        ) : (
          <UnavailableStat label="Seen today" icon={<CircleCheck className="size-4" />} />
        )}

        {today.ok ? (
          <StatCard
            label="Appointments"
            value={today.counts.total}
            icon={<CalendarDays className="size-4" />}
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
          <UnavailableStat label="Appointments" icon={<CalendarDays className="size-4" />} />
        )}

        {today.ok ? (
          <StatCard
            label="Waiting now"
            value={today.counts.waiting}
            icon={<ListChecks className="size-4" />}
            accent={today.counts.waiting > 0 ? "warning" : "info"}
            hint={today.counts.inConsultation > 0 ? `${today.counts.inConsultation} with the doctor` : "Checked in and waiting"}
            href="/appointments"
          />
        ) : (
          <UnavailableStat label="Waiting now" icon={<ListChecks className="size-4" />} />
        )}
      </div>

      {myRecent.length > 0 ? (
        <RecentPatients
          patients={myRecent.map((p) => ({
            id: p.id,
            patientNumber: p.patientNumber,
            fullName: p.fullName,
            ageYears: p.ageYears,
            sex: p.sex,
            seenOn: p.createdAt.slice(0, 10),
            reason: "Registered",
            locationName: p.lastSeenLocation ?? ctx.locationName,
          }))}
        />
      ) : !recent.ok ? (
        <SectionCard className="overflow-hidden">
          <SectionHeader title="Recent patients" icon={<Users className="size-4" />} />
          <div className="p-4">
            <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-[12.5px] font-medium text-ink">
              <TriangleAlert className="mt-px size-4 shrink-0 text-[#8a3f07]" aria-hidden="true" />
              Your patient list could not be loaded. This is not an empty repository — reload before registering anyone new.
            </p>
          </div>
        </SectionCard>
      ) : (
        <SectionCard className="overflow-hidden">
          <SectionHeader title="Recent patients" icon={<Users className="size-4" />} />
          <EmptyState
            icon={<UserPlus className="size-5" />}
            title="No patients yet"
            description="Register your first patient to get started. They belong to you alone — no other doctor can see them."
            action={
              <Link
                href="/patients/new"
                className="dd-primary inline-flex h-10 items-center gap-2 rounded-full px-4 text-[12.5px] font-semibold text-white focus-visible:focus-ring"
              >
                <UserPlus className="size-4" aria-hidden="true" />
                Register a patient
              </Link>
            }
          />
        </SectionCard>
      )}
    </div>
  );
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="dd-quick-row flex min-h-10 items-center gap-2.5 rounded-full px-3 text-[12.5px] font-semibold text-ink focus-visible:focus-ring"
    >
      {icon}
      {label}
    </Link>
  );
}

function UnavailableStat({
  label,
  icon,
}: {
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <GlassCard className="dd-dashboard-card p-3.5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-[#8a3f07]" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-ink-secondary">{label}</p>
          <p className="mt-1 text-[10.5px] font-medium text-[#8a3f07]">Temporarily unavailable</p>
        </div>
        <TriangleAlert className="size-4 shrink-0 text-[#8a3f07]" aria-hidden="true" />
      </div>
    </GlassCard>
  );
}
