import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  addStaffAction,
  replaceStaffLocationsAction,
  replaceStaffPermissionsAction,
  setStaffStatusAction,
} from "@/features/staff/actions";
import {
  ROLE_CEILING,
  type StaffPermission,
  type StaffRole,
  type StaffStatus,
} from "@/features/staff/permissions";

export const metadata: Metadata = { title: "Team · Settings" };

type GrantRow = {
  id: string;
  staff_user_id: string;
  role: StaffRole;
  status: StaffStatus;
  starts_at: string;
  ends_at: string | null;
};

type LocationRow = { id: string; name: string };

const STATUS_LABEL: Record<StaffStatus, string> = {
  ACTIVE: "Active",
  TEMPORARILY_DISABLED: "Temporarily disabled",
  REMOVED: "Removed",
};

const PERMISSION_LABEL: Record<StaffPermission, string> = {
  "appointments.view": "View appointments",
  "appointments.manage": "Manage appointments",
  "patient.lookup": "Patient lookup",
  "arrival.manage": "Manage arrivals",
  "queue.manage": "Manage queue",
  "chamber.view": "View chamber",
  "intake.write": "Write structured intake/vitals",
  "document.attach": "Attach patient documents",
  "investigation.prepare": "Prepare investigation proposals",
};

export default async function TeamSettingsPage() {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data: doctor } = await supabase
    .from("doctor_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!doctor?.id) throw new Error("TEAM_DOCTOR_ONLY");
  const doctorId = doctor.id as string;

  const [{ data: chamberRows }, { data: grantRows }, { data: invitationRows }] = await Promise.all([
    supabase
      .from("doctor_chambers")
      .select("practice_location_id, practice_locations(name)")
      .eq("doctor_profile_id", doctorId)
      .order("position"),
    supabase
      .from("doctor_staff_grants")
      .select("id, staff_user_id, role, status, starts_at, ends_at")
      .eq("doctor_profile_id", doctorId)
      .order("created_at", { ascending: false }),
    supabase
      .from("doctor_staff_invitations")
      .select("id, email, role, created_at, expires_at")
      .eq("doctor_profile_id", doctorId)
      .is("linked_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const grants = (grantRows ?? []) as GrantRow[];
  const staffIds = grants.map((grant) => grant.staff_user_id);
  const grantIds = grants.map((grant) => grant.id);

  const [{ data: profiles }, { data: assignedLocations }, { data: assignedPermissions }] = await Promise.all([
    staffIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", staffIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    grantIds.length
      ? supabase
          .from("doctor_staff_locations")
          .select("grant_id, practice_location_id")
          .in("grant_id", grantIds)
      : Promise.resolve({ data: [] as { grant_id: string; practice_location_id: string }[] }),
    grantIds.length
      ? supabase
          .from("doctor_staff_permissions")
          .select("grant_id, permission")
          .in("grant_id", grantIds)
      : Promise.resolve({ data: [] as { grant_id: string; permission: StaffPermission }[] }),
  ]);

  const locations: LocationRow[] = (chamberRows ?? []).flatMap((row) => {
    const rel = row.practice_locations as unknown;
    const item = Array.isArray(rel) ? rel[0] : rel;
    const name = (item as { name?: string } | null)?.name;
    return name ? [{ id: row.practice_location_id as string, name }] : [];
  });

  const names = new Map((profiles ?? []).map((profile) => [profile.id as string, profile.full_name as string]));
  const locationMap = new Map(locations.map((location) => [location.id, location.name]));

  return (
    <div className="space-y-5 sm:space-y-6">
      <Link href="/settings" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to settings
      </Link>

      <PageHeader
        eyebrow="Settings · Team"
        title="Your team"
        subtitle="Every staff member uses their own account. Access is limited to you, the chambers you assign, and the permissions you explicitly grant."
      />

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Add staff" icon={<UserPlus className="size-4" />} />
        <form action={addStaffAction} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-ink">
            Staff email
            <input
              required
              type="email"
              name="email"
              autoComplete="email"
              className="min-h-11 rounded-xl border border-hairline bg-white px-3 text-sm"
              placeholder="staff@example.com"
            />
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-ink">
            Role
            <select name="role" defaultValue="RECEPTIONIST" className="min-h-11 rounded-xl border border-hairline bg-white px-3 text-sm">
              <option value="RECEPTIONIST">Receptionist</option>
              <option value="ASSISTANT">Assistant</option>
            </select>
          </label>

          <fieldset className="space-y-2 lg:col-span-2">
            <legend className="text-sm font-semibold text-ink">Assigned chambers</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {locations.map((location) => (
                <label key={location.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-hairline px-3 text-sm">
                  <input type="checkbox" name="locations" value={location.id} />
                  {location.name}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2 lg:col-span-2">
            <legend className="text-sm font-semibold text-ink">Permissions</legend>
            <p className="text-xs text-ink-muted">The server rejects anything above the selected role ceiling. Prescription preparation/finalization is not available to staff.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(PERMISSION_LABEL).map(([permission, label]) => (
                <label key={permission} className="flex min-h-11 items-center gap-2 rounded-xl border border-hairline px-3 text-sm">
                  <input type="checkbox" name="permissions" value={permission} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="lg:col-span-2">
            <button type="submit" className="min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white">
              Send invite / link account
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Staff access" count={grants.length} icon={<Users className="size-4" />} />
        {grants.length === 0 ? (
          <p className="p-5 text-sm text-ink-muted">No Doctor-scoped staff relationships yet.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {grants.map((grant) => {
              const rolePermissions = ROLE_CEILING[grant.role];
              const selectedLocations = new Set(
                (assignedLocations ?? [])
                  .filter((row) => row.grant_id === grant.id)
                  .map((row) => row.practice_location_id as string),
              );
              const selectedPermissions = new Set(
                (assignedPermissions ?? [])
                  .filter((row) => row.grant_id === grant.id)
                  .map((row) => row.permission as StaffPermission),
              );

              return (
                <article key={grant.id} className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-ink">{names.get(grant.staff_user_id) ?? "Staff member"}</h2>
                      <p className="text-xs text-ink-muted">
                        {grant.role === "RECEPTIONIST" ? "Receptionist" : "Assistant"} · {STATUS_LABEL[grant.status]}
                      </p>
                    </div>
                    <form action={setStaffStatusAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="grantId" value={grant.id} />
                      {grant.status !== "ACTIVE" ? (
                        <button name="status" value="ACTIVE" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Reactivate</button>
                      ) : (
                        <button name="status" value="TEMPORARILY_DISABLED" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Temporarily disable</button>
                      )}
                      {grant.status !== "REMOVED" ? (
                        <button name="status" value="REMOVED" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Remove access</button>
                      ) : null}
                    </form>
                  </div>

                  {grant.status !== "REMOVED" ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <form action={replaceStaffLocationsAction} className="space-y-2 rounded-2xl border border-hairline p-3">
                        <input type="hidden" name="grantId" value={grant.id} />
                        <p className="text-sm font-semibold text-ink">Assigned chambers</p>
                        {locations.map((location) => (
                          <label key={location.id} className="flex min-h-11 items-center gap-2 text-sm">
                            <input type="checkbox" name="locations" value={location.id} defaultChecked={selectedLocations.has(location.id)} />
                            {locationMap.get(location.id)}
                          </label>
                        ))}
                        <button type="submit" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Save chambers</button>
                      </form>

                      <form action={replaceStaffPermissionsAction} className="space-y-2 rounded-2xl border border-hairline p-3">
                        <input type="hidden" name="grantId" value={grant.id} />
                        <input type="hidden" name="role" value={grant.role} />
                        <p className="text-sm font-semibold text-ink">Explicit permissions</p>
                        {rolePermissions.map((permission) => (
                          <label key={permission} className="flex min-h-11 items-center gap-2 text-sm">
                            <input type="checkbox" name="permissions" value={permission} defaultChecked={selectedPermissions.has(permission)} />
                            {PERMISSION_LABEL[permission]}
                          </label>
                        ))}
                        <button type="submit" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Save permissions</button>
                      </form>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>

      {(invitationRows ?? []).length ? (
        <SectionCard className="overflow-hidden">
          <SectionHeader title="Pending invitations" icon={<ShieldCheck className="size-4" />} />
          <ul className="divide-y divide-hairline">
            {(invitationRows ?? []).map((invite) => (
              <li key={invite.id} className="px-4 py-3 text-sm sm:px-5">
                <span className="font-medium text-ink">{invite.email}</span>
                <span className="text-ink-muted"> · {invite.role}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <p className="text-xs text-ink-muted">
        Team access is Doctor-specific. Staff cannot gain prescribing, prescription finalization/signing, diagnosis finalization, ownership transfer, or security-role escalation from this page.
      </p>
    </div>
  );
}
