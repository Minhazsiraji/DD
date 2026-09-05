-- Doctor's Diary Database V2, P1 grants. Revoke first, then enumerate.

-- P1 creates this sequence after the frozen P0 global sequence revoke, so
-- close PostgreSQL's default PUBLIC sequence authority explicitly.
revoke all on sequence public.credential_review_events_seq_seq
from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;

revoke all on function public.p1_jsonb_object_key_count(jsonb) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.has_platform_staff_role(uuid, platform_staff_role) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.prevent_append_only_p1_change() from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.enforce_platform_staff_role_separation() from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.grant_platform_staff_role(uuid, platform_staff_role) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.revoke_platform_staff_role(uuid) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.refresh_student_capability_trigger() from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.refresh_student_profile_capability_trigger() from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.submit_credential(uuid,text,text) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.respond_to_credential(uuid,text,text) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.decide_credential(uuid,credential_status,text,credential_verification_method) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.submit_student_enrollment(uuid,text,text,date,date) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.decide_enrollment(uuid,credential_status,text,credential_verification_method) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.validate_system_health_detail() from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.require_platform_analyst() from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.owner_metrics_overview(date,date) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.owner_metrics_timeseries(text,date,date) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.owner_metrics_new_doctors(date,date) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.owner_system_health(timestamptz) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;
revoke all on function public.owner_system_health_history(text,date,date) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;

-- Existing P0 projection function remains trigger-only after its P1 replacement.
revoke execute on function public.refresh_profile_capabilities(uuid) from public,anon,authenticated,service_role,dd_owner_analytics,dd_metrics_reader,dd_metrics_rollup,dd_public_ingress;

grant select on public.platform_staff, public.platform_staff_roles,
  public.medical_institutions, public.medical_student_profiles, public.student_enrollments
to authenticated;

grant execute on function public.has_platform_staff_role(uuid, platform_staff_role) to authenticated;
grant execute on function public.grant_platform_staff_role(uuid, platform_staff_role),
  public.revoke_platform_staff_role(uuid),
  public.submit_credential(uuid,text,text),
  public.respond_to_credential(uuid,text,text),
  public.decide_credential(uuid,credential_status,text,credential_verification_method),
  public.submit_student_enrollment(uuid,text,text,date,date),
  public.decide_enrollment(uuid,credential_status,text,credential_verification_method)
to authenticated;

grant execute on function public.current_profile_id(),
  public.has_platform_staff_role(uuid, platform_staff_role),
  public.emit_audit_event(text,text,uuid,uuid),
  public.require_platform_analyst()
to dd_metrics_reader;
grant select on public.metric_definitions, public.health_signal_registry,
  public.health_signal_registry_keys, public.system_health_signals
to dd_metrics_reader;

grant select on public.health_signal_registry, public.health_signal_registry_keys,
  public.system_health_signals
to dd_metrics_rollup;
grant insert on public.system_health_signals to dd_metrics_rollup;

grant execute on function public.owner_metrics_overview(date,date),
  public.owner_metrics_timeseries(text,date,date),
  public.owner_metrics_new_doctors(date,date),
  public.owner_system_health(timestamptz),
  public.owner_system_health_history(text,date,date)
to authenticated, dd_owner_analytics;

-- P1 functions are never service-role shortcuts.
revoke execute on function public.has_platform_staff_role(uuid, platform_staff_role) from service_role;
revoke execute on function public.grant_platform_staff_role(uuid, platform_staff_role) from service_role;
revoke execute on function public.revoke_platform_staff_role(uuid) from service_role;
revoke execute on function public.submit_credential(uuid,text,text) from service_role;
revoke execute on function public.respond_to_credential(uuid,text,text) from service_role;
revoke execute on function public.decide_credential(uuid,credential_status,text,credential_verification_method) from service_role;
revoke execute on function public.submit_student_enrollment(uuid,text,text,date,date) from service_role;
revoke execute on function public.decide_enrollment(uuid,credential_status,text,credential_verification_method) from service_role;
revoke execute on function public.refresh_student_capability_trigger() from service_role;
revoke execute on function public.refresh_student_profile_capability_trigger() from service_role;
revoke execute on function public.require_platform_analyst() from service_role;
revoke execute on function public.owner_metrics_overview(date,date) from service_role;
revoke execute on function public.owner_metrics_timeseries(text,date,date) from service_role;
revoke execute on function public.owner_metrics_new_doctors(date,date) from service_role;
revoke execute on function public.owner_system_health(timestamptz) from service_role;
revoke execute on function public.owner_system_health_history(text,date,date) from service_role;

-- Transfer SECURITY DEFINER analytics ownership only after all grants/revokes
-- are finalized. PostgreSQL 17 requires the deployment role to be able to SET
-- the target owner and the target owner to have CREATE on the containing
-- schema. Both privileges are temporary and restored to false immediately.
grant dd_metrics_reader to current_user with inherit false, set true;
grant create on schema public to dd_metrics_reader;
alter function public.owner_metrics_overview(date,date) owner to dd_metrics_reader;
alter function public.owner_metrics_timeseries(text,date,date) owner to dd_metrics_reader;
alter function public.owner_metrics_new_doctors(date,date) owner to dd_metrics_reader;
alter function public.owner_system_health(timestamptz) owner to dd_metrics_reader;
alter function public.owner_system_health_history(text,date,date) owner to dd_metrics_reader;
revoke create on schema public from dd_metrics_reader;
grant dd_metrics_reader to current_user with inherit false, set false;
