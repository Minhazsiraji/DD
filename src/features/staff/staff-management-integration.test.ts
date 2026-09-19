import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const settings = () => read("src/app/(app)/settings/page.tsx");
const team = () => read("src/app/(app)/settings/team/page.tsx");
const appointments = () => read("src/features/appointments/actions.ts");
const queueActions = () => read("src/features/queue/actions.ts");
const queueQueries = () => read("src/features/queue/queries.ts");
const service = () => read("src/features/staff/service.ts");
const migration = () => read("supabase/migrations/0053_staff_management_v1.sql");

describe("Staff Management source integration", () => {
  it("wires Settings to the Doctor-only Team surface", () => {
    expect(settings()).toContain('href="/settings/team"');
    expect(settings()).toContain("Staff access, chambers &amp; permissions");
    expect(team()).toContain('if (!doctor?.id) throw new Error("TEAM_DOCTOR_ONLY")');
  });

  it("routes managed appointment create/status/reschedule only through staff RPCs", () => {
    const source = appointments();
    expect(source).toContain('supabase.rpc("managed_staff_entry_at"');
    expect(source).toContain('supabase.rpc("staff_create_appointment"');
    expect(source).toContain('supabase.rpc("staff_set_appointment_status"');
    expect(source).toContain('supabase.rpc("staff_reschedule_appointment"');
    expect(source).toContain('if (managed) {');
  });

  it("keeps legacy appointment RPCs on the unadopted branch", () => {
    const source = appointments();
    expect(source).toContain(': await supabase.rpc("create_appointment"');
    expect(source).toContain(': await supabase.rpc("reschedule_appointment"');
    expect(source).toContain('} else if (v.toStatus === "CANCELLED"');
  });

  it("routes every managed queue mutation through Doctor-scoped staff RPCs", () => {
    const source = queueActions();
    for (const fn of [
      "staff_call_patient",
      "staff_skip_patient",
      "staff_set_queue_priority",
      "staff_clear_queue_priority",
    ]) expect(source).toContain(`supabase.rpc("${fn}"`);
  });

  it("uses managed queue read path and preserves stale location fail-closed", () => {
    expect(queueQueries()).toContain('supabase.rpc("staff_get_queue"');
    expect(queueQueries()).toContain('supabase.rpc("managed_staff_entry_at"');
    expect(queueActions()).toContain('ctx.locationId !== expectedLocationId');
    expect(queueActions()).toContain('location-context-changed');
  });

  it("fails closed when managed context detection fails", () => {
    expect(appointments()).toContain('throw new Error("STAFF_CONTEXT_CHECK_FAILED")');
    expect(queueActions()).toContain('throw new Error("STAFF_CONTEXT_CHECK_FAILED")');
    expect(queueQueries()).toContain('managed-staff-context-check-failed');
  });

  it("keeps privileged Auth operations server-only and never handles a staff password", () => {
    const source = service();
    expect(source).toContain('import "server-only"');
    expect(source).toContain("serviceRoleKey()");
    expect(source).toContain("inviteUserByEmail");
    expect(source).not.toMatch(/password/i);
    expect(source).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE");
  });

  it("does not offer direct reactivation of a removed relationship", () => {
    const source = team();
    expect(source).toContain('grant.status === "TEMPORARILY_DISABLED"');
    expect(source).toContain('grant.status === "ACTIVE"');
    expect(source).toContain('grant.status !== "REMOVED"');
    expect(source).not.toContain('grant.status !== "ACTIVE" ?');
  });
});

describe("0053 Staff Management security contract", () => {
  it("suspends adopted legacy receptionist authority but leaves unadopted rows alone", () => {
    const sql = migration();
    expect(sql).toContain("m.role::text = 'RECEPTIONIST'");
    expect(sql).toContain("set status = 'SUSPENDED'");
    expect(sql).toContain("Explicit adoption removes the legacy location-wide receptionist authority");
  });

  it("requires managed entry, Doctor, location, role ceiling and explicit permission", () => {
    const sql = migration();
    expect(sql).toContain("public.managed_staff_entry_at(target_location_id)");
    expect(sql).toContain("g.doctor_profile_id = target_doctor_id");
    expect(sql).toContain("l.practice_location_id = target_location_id");
    expect(sql).toContain("p.permission = target_permission");
    expect(sql).toContain("public.staff_role_allows_permission(g.role, target_permission)");
  });

  it("keeps managed Receptionist operational paths Doctor-scoped", () => {
    const sql = migration();
    for (const fn of [
      "staff_create_appointment",
      "staff_set_appointment_status",
      "staff_reschedule_appointment",
      "staff_set_queue_priority",
      "staff_call_patient",
      "staff_skip_patient",
      "staff_clear_queue_priority",
      "staff_get_queue",
    ]) expect(sql).toContain(`function public.${fn}`);
    expect(sql).toContain("public.has_doctor_staff_permission(a.owner_doctor_id,a.practice_location_id,'queue.manage')");
  });

  it("keeps Assistant clinical support bounded and prescriptions absent", () => {
    const sql = migration();
    expect(sql).toContain("staff_write_intake_vitals");
    expect(sql).toContain("staff_attach_document_record");
    expect(sql).toContain("staff_prepare_investigation");
    expect(sql).not.toMatch(/create or replace function public\.staff_.*prescription/i);
    expect(sql).not.toMatch(/create or replace function public\.staff_.*diagnos/i);
    expect(sql).not.toContain("draft.prepare");
  });

  it("removal is logical and cannot be toggled back to active", () => {
    const sql = migration();
    expect(sql).toContain("REMOVED_STAFF_REQUIRES_NEW_ADOPTION");
    expect(sql).toContain("removed_at = case when target_status = 'REMOVED' then now() else removed_at end");
  });

  it("makes service-role linking non-public and all Staff definers pin a safe search_path", () => {
    const sql = migration();
    expect(sql).toContain("revoke all on function public.service_link_doctor_staff_invitation(uuid, uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.service_link_doctor_staff_invitation(uuid, uuid) to service_role");
    const definerCount = (sql.match(/^security definer$/gim) ?? []).length;
    const safePathCount = (sql.match(/^set search_path\s*=\s*public,\s*pg_temp$/gim) ?? []).length;
    expect(definerCount).toBeGreaterThan(0);
    expect(safePathCount).toBeGreaterThanOrEqual(definerCount);
  });

  it("keeps internal queue helper unexposed", () => {
    const sql = migration();
    expect(sql).toContain("revoke all on function public.staff_queue_entry_for(uuid,uuid) from public,anon,authenticated");
    expect(sql).not.toContain("grant execute on function public.staff_queue_entry_for");
  });

  it("records delegated audit with actual auth.uid and separate Doctor context", () => {
    const sql = migration();
    expect(sql).toContain("actor_id,action,resource_type,resource_id,meta");
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("'doctor_profile_id'");
    expect(sql).toContain("audit_events_select_doctor_team");
  });
});
