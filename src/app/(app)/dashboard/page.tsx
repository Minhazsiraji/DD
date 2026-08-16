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

/** Server-side: computing this in a Client Component causes a hydration mismatch. */
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
 * Everything on this page is REAL.
 *
 * It previously mixed real recent patients with fictional appointments, a
 * fictional queue and a fictional patient with a penicillin allergy. On a
 * pilot doctor's screen that is not a placeholder — it is false clinical
 * information they could act on. Modules that do not exist show an honest
 * empty state instead of invented numbers.
 */
export default async function DashboardPage() {
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const sessionDate = todayInDhaka();

  const myDoctorId = await getCurrentDoctorId();

  /**
   * Every repository read is scoped to this doctor IN THE DATABASE.
   *
   * RLS legitimately shows a doctor their colleagues' patients at a shared
   * location — that is how reception works — so "in your repository" has to be
   * asked for explicitly. Reception passes no doctor id and keeps the
   * location-wide view they need.
   */
  const [{ data: profile }, patients, recent, today, queue] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
    getPatientCount(myDoctorId),
    getRecentPatients(6, myDoctorId),
    getDayCounts(sessionDate, myDoctorId),
    getQueue(ctx.locationId, sessionDate),
  ]);

  const doctorName = profile?.full_name ?? ctx.user.email?.split("@")[0] ?? "Doctor";

  /**
   * Filter to this doctor, then take the head of each group.
   *
   * `get_queue()` has already applied priority and token order, and `groupQueue`
   * is a filter — no sorting happens here. Deriving the order again would give
   * the dashboard and the queue screen two answers to "who is next".
   */
  const mine = queue.ok
    ? queue.rows.filter((r) => !myDoctorId || r.ownerDoctorId === myDoctorId)
    : [];
  const groups = groupQueue(mine);
  const current = groups.withDoctor[0] ?? null;
  const next = groups.waiting[0] ?? null;

  /**
   * Belt and braces only — the query above already scoped this.
   *
   * Kept because a wrong row here reads as "your patient" and would be acted
   * on, but it must never be the primary control: filtering after LIMIT is what
   * let six newer colleague records hide a doctor's own list.
   */
  const myRecent = recent.ok
    ? myDoctorId
      ? recent.patients.filter((p) => p.ownerDoctorId === myDoctorId)
      : recent.patients
    : [];

  return (
    <div className="space-y-4 sm:space-y-5">
      {/*
        Compact by design. This is the screen a doctor opens dozens of times a
        day; a full-height greeting pushes the actual work below the fold.
      */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold text-ink sm:text-xl">
          <span className="font-normal text-ink-secondary">{greeting()}, </span>
          {doctorName}
        </h1>
        <p className="text-[13px] text-ink-secondary">
          {ctx.locationName} · {formatDate(clinicToday())}
        </p>
      </header>

      {/*
        [&>*]:min-w-0 — grid items default to min-width:auto, so a tile whose
        content cannot shrink pushes the track wider than the column and the
        whole page scrolls sideways on a phone.
      */}
      <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0 sm:gap-4 lg:grid-cols-4">
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
            hint={
              today.counts.cancelled > 0
                ? `${today.counts.cancelled} cancelled`
                : "Consultations finished"
            }
            href="/appointments"
          />
        ) : (
          <UnavailableStat label="Seen today" icon={<CircleCheck className="size-5" />} />
        )}
        {/*
          An outage is never rendered as zero. "You have no appointments" is a
          statement a doctor acts on; "we could not load them" is not the same
          sentence and must not look like it.
        */}
        {today.ok ? (
          <StatCard
            label="Appointments"
            value={today.counts.total}
            icon={<CalendarDays className="size-5" />}
            accent="brand"
            hint={
              today.counts.completed > 0
                ? `${today.counts.completed} seen so far`
                : "Booked here today"
            }
            href="/appointments"
          />
        ) : (
          <UnavailableStat
            label="Appointments"
            icon={<CalendarDays className="size-5" />}
          />
        )}

        {/*
          Not the Stage 5 live queue — just how many have checked in and are
          sitting outside right now. Labelled as such so it does not read as a
          feature that exists yet.
        */}
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
          <UnavailableStat
            label="Waiting now"
            icon={<ListChecks className="size-5" />}
          />
        )}
      </div>

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-3">
        <div className="space-y-4 sm:space-y-5 xl:col-span-2">
          <WorkNow
            current={current}
            next={next}
            failed={!queue.ok}
            waitingCount={groups.waiting.length}
            locationName={ctx.locationName}
          />

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
            /*
              A failed read is not an empty repository. Offering "register your
              first patient" here would invite a duplicate of someone the doctor
              already has.
            */
            <SectionCard className="overflow-hidden">
              <SectionHeader title="Recent patients" icon={<Users className="size-4" />} />
              <div className="p-4 sm:p-5">
                <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] font-medium text-ink">
                  <TriangleAlert className="mt-px size-4 shrink-0 text-[#8a3f07]" aria-hidden="true" />
                  Your patient list could not be loaded. This is not an empty
                  repository — reload before registering anyone new.
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
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring"
                  >
                    <UserPlus className="size-4" aria-hidden="true" />
                    Register a patient
                  </Link>
                }
              />
            </SectionCard>
          )}
        </div>

        <div className="space-y-4 sm:space-y-5">
          <SectionCard className="overflow-hidden">
            <SectionHeader title="Quick actions" icon={<Search className="size-4" />} />
            {/*
              Every destination here exists and works. A shortcut to a screen
              that is not built is worse than no shortcut — it teaches the
              doctor that buttons on this page cannot be trusted.
            */}
            <div className="space-y-2 p-4 sm:p-5">
              <QuickAction
                href="/queue"
                icon={<ListChecks className="size-4 text-brand" aria-hidden="true" />}
                label="Live queue"
              />
              <QuickAction
                href="/appointments"
                icon={<CalendarDays className="size-4 text-brand" aria-hidden="true" />}
                label="Book or add a walk-in"
              />
              <QuickAction
                href="/patients/new"
                icon={<UserPlus className="size-4 text-brand" aria-hidden="true" />}
                label="Register a patient"
              />
              <QuickAction
                href="/patients"
                icon={<Search className="size-4 text-brand" aria-hidden="true" />}
                label="Find a patient"
              />
            </div>
          </SectionCard>
        </div>
      </div>
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
      className="flex min-h-11 items-center gap-2.5 rounded-xl border border-hairline px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
    >
      {icon}
      {label}
    </Link>
  );
}

/**
 * A count we could not load.
 *
 * Deliberately NOT a zero and deliberately not blank: both read as "nothing
 * booked", which is the one meaning this state must never carry.
 */
function UnavailableStat({
  label,
  icon,
}: {
  label: string;
  icon: React.ReactNode;
}) {
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
        <p className="mt-0.5 text-xs font-medium text-[#8a3f07]">
          Temporarily unavailable
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          This is not an empty schedule — reload before relying on it.
        </p>
      </div>
    </GlassCard>
  );
}
