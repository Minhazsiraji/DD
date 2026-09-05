-- Doctor's Diary Database V2, P1 RLS.
-- New P1 relations are FORCE-RLS; staff/student identities never widen clinical ownership.

alter table public.platform_staff enable row level security;
alter table public.platform_staff force row level security;
alter table public.platform_staff_roles enable row level security;
alter table public.platform_staff_roles force row level security;
alter table public.credential_review_events enable row level security;
alter table public.credential_review_events force row level security;
alter table public.medical_institutions enable row level security;
alter table public.medical_institutions force row level security;
alter table public.medical_student_profiles enable row level security;
alter table public.medical_student_profiles force row level security;
alter table public.student_enrollments enable row level security;
alter table public.student_enrollments force row level security;
alter table public.health_signal_registry enable row level security;
alter table public.health_signal_registry force row level security;
alter table public.health_signal_registry_keys enable row level security;
alter table public.health_signal_registry_keys force row level security;
alter table public.system_health_signals enable row level security;
alter table public.system_health_signals force row level security;

create policy platform_staff_self_read on public.platform_staff
for select to authenticated using (profile_id=public.current_profile_id());

create policy platform_staff_roles_self_read on public.platform_staff_roles
for select to authenticated using (profile_id=public.current_profile_id() and revoked_at is null);

create policy medical_institutions_authenticated_read on public.medical_institutions
for select to authenticated using (is_active);

create policy medical_student_profiles_self_read on public.medical_student_profiles
for select to authenticated using (profile_id=public.current_profile_id());

create policy student_enrollments_self_read on public.student_enrollments
for select to authenticated using (
  exists(select 1 from public.medical_student_profiles msp
         where msp.id=student_enrollments.medical_student_profile_id
           and msp.profile_id=public.current_profile_id())
);
create policy health_signal_registry_reader_read on public.health_signal_registry
for select to dd_metrics_reader using (true);
create policy health_signal_registry_rollup_read on public.health_signal_registry
for select to dd_metrics_rollup using (true);

create policy health_signal_registry_keys_reader_read on public.health_signal_registry_keys
for select to dd_metrics_reader using (true);
create policy health_signal_registry_keys_rollup_read on public.health_signal_registry_keys
for select to dd_metrics_rollup using (true);

create policy system_health_signals_reader_read on public.system_health_signals
for select to dd_metrics_reader using (true);
create policy system_health_signals_rollup_insert on public.system_health_signals
for insert to dd_metrics_rollup with check (true);
create policy system_health_signals_rollup_read on public.system_health_signals
for select to dd_metrics_rollup using (true);

-- No direct table writes are restored below this line. Identity mutations remain RPC-only.
revoke all on public.platform_staff, public.platform_staff_roles, public.credential_review_events,
  public.medical_institutions, public.medical_student_profiles, public.student_enrollments,
  public.health_signal_registry, public.health_signal_registry_keys, public.system_health_signals
from public, anon, authenticated, service_role, dd_owner_analytics, dd_metrics_reader, dd_metrics_rollup, dd_public_ingress;

create policy metric_definitions_reader_read_p1 on public.metric_definitions
for select to dd_metrics_reader using (true);
