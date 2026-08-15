import type { Metadata } from "next";
import Link from "next/link";
import { Users, CalendarDays, ListChecks, CalendarClock, UserPlus, Search } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { GlassCard } from "@/components/glass/glass-card";
import { RecentPatients } from "@/features/dashboard/components/recent-patients";
import { formatDate } from "@/lib/format";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRecentPatients, clinicToday } from "@/features/patients/queries";

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

  const [{ data: profile }, { count }, recent] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
    supabase.from("patients").select("id", { count: "exact", head: true }).is("deleted_at", null),
    getRecentPatients(6),
  ]);

  const doctorName = profile?.full_name ?? ctx.user.email?.split("@")[0] ?? "Doctor";
  const patientCount = count ?? 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow={greeting()}
        title={doctorName}
        subtitle={`${ctx.locationName} · ${formatDate(clinicToday())}`}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Patients"
          value={patientCount}
          icon={<Users className="size-5" />}
          accent="brand"
          hint="In your repository"
          href="/patients"
        />
        <NotBuiltStat
          label="Appointments"
          icon={<CalendarDays className="size-5" />}
          phase="Phase 4"
        />
        <NotBuiltStat
          label="Live queue"
          icon={<ListChecks className="size-5" />}
          phase="Phase 5"
        />
        <NotBuiltStat
          label="Follow-ups"
          icon={<CalendarClock className="size-5" />}
          phase="Phase 10"
        />
      </div>

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-3">
        <div className="space-y-4 sm:space-y-5 xl:col-span-2">
          {recent.length > 0 ? (
            <RecentPatients
              patients={recent.map((p) => ({
                id: p.id,
                patientNumber: p.patientNumber,
                fullName: p.fullName,
                ageYears: p.ageYears ?? 0,
                sex: p.sex.toLowerCase() as "male" | "female" | "other",
                seenOn: p.createdAt.slice(0, 10),
                reason: "Registered",
                locationName: p.lastSeenLocation ?? ctx.locationName,
              }))}
            />
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
            <div className="space-y-2 p-4 sm:p-5">
              <Link
                href="/patients/new"
                className="flex min-h-11 items-center gap-2.5 rounded-xl border border-hairline px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
              >
                <UserPlus className="size-4 text-brand" aria-hidden="true" />
                Register a patient
              </Link>
              <Link
                href="/patients"
                className="flex min-h-11 items-center gap-2.5 rounded-xl border border-hairline px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
              >
                <Search className="size-4 text-brand" aria-hidden="true" />
                Find a patient
              </Link>
            </div>
          </SectionCard>

          <GlassCard className="p-4">
            <p className="text-[13px] font-semibold text-ink">What&apos;s live so far</p>
            <p className="mt-1 text-[13px] leading-snug text-ink-secondary">
              Sign-in, security, your practice locations and the patient
              repository. Appointments, the queue, consultations and
              prescriptions are still being built — nothing on this page is
              simulated.
            </p>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

/**
 * A tile for a module that does not exist yet. Shows an em dash rather than a
 * plausible-looking zero or an invented count.
 */
function NotBuiltStat({
  label,
  icon,
  phase,
}: {
  label: string;
  icon: React.ReactNode;
  phase: string;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted"
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-[28px] leading-none font-bold text-ink-muted sm:text-[32px]">
          —
        </span>
      </div>
      <div className="mt-4">
        <p className="text-sm font-semibold text-ink-secondary">{label}</p>
        <p className="mt-0.5 text-xs text-ink-muted">Arrives in {phase}</p>
      </div>
    </GlassCard>
  );
}
