from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one match in {path}: {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

# Settings -> Team discoverability.
replace_once(
    "src/app/(app)/settings/page.tsx",
    '  Palette,\n} from "lucide-react";',
    '  Palette,\n  Users,\n} from "lucide-react";',
)
replace_once(
    "src/app/(app)/settings/page.tsx",
    '      <SectionCard className="overflow-hidden">\n        <SectionHeader title="Your profile" icon={<Stethoscope className="size-4" />} />',
    '''      <SectionCard className="overflow-hidden">
        <SectionHeader title="Team" icon={<Users className="size-4" />} />
        <div className="p-4 sm:p-5">
          <Link
            href="/settings/team"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            <Users className="size-4 text-brand" aria-hidden="true" />
            Staff access, chambers &amp; permissions
            <ChevronRight className="size-4 text-ink-muted" aria-hidden="true" />
          </Link>
          <p className="mt-2 text-xs text-ink-muted">
            Add receptionists or assistants using their own accounts and Doctor-scoped access.
          </p>
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Your profile" icon={<Stethoscope className="size-4" />} />''',
)

# Removed means removed: re-adoption is explicit, not a status toggle.
replace_once(
    "src/app/(app)/settings/team/page.tsx",
    '''                      {grant.status !== "ACTIVE" ? (
                        <button name="status" value="ACTIVE" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Reactivate</button>
                      ) : (
                        <button name="status" value="TEMPORARILY_DISABLED" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Temporarily disable</button>
                      )}''',
    '''                      {grant.status === "TEMPORARILY_DISABLED" ? (
                        <button name="status" value="ACTIVE" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Reactivate</button>
                      ) : grant.status === "ACTIVE" ? (
                        <button name="status" value="TEMPORARILY_DISABLED" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Temporarily disable</button>
                      ) : null}''',
)

# Narrow typing escape hatch for the server-only service-role RPC not yet present in generated types.
replace_once(
    "src/features/staff/service.ts",
    '''  const client = staffPrivilegedClient();
  const { data, error } = await client.rpc("service_link_doctor_staff_invitation", {
    target_invitation_id: input.invitationId,
    target_staff_user_id: input.staffUserId,
  });
  if (error || typeof data !== "string") throw new Error("STAFF_LINK_FAILED");
  return data;''',
    '''  const client = staffPrivilegedClient();
  const rpc = client.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  const { data, error } = await rpc("service_link_doctor_staff_invitation", {
    target_invitation_id: input.invitationId,
    target_staff_user_id: input.staffUserId,
  });
  if (error || typeof data !== "string") throw new Error("STAFF_LINK_FAILED");
  return data;''',
)

# Shared helper: a failed managed-entry check must fail closed, never fall into legacy RPCs.
managed_helper = '''\nasync function managedStaffAt(locationId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("managed_staff_entry_at", {
    target_location: locationId,
  });
  if (error) throw new Error("STAFF_CONTEXT_CHECK_FAILED");
  return data === true;
}\n'''
replace_once(
    "src/features/appointments/actions.ts",
    '''function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}
''',
    '''function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}
''' + managed_helper,
)
replace_once(
    "src/features/appointments/actions.ts",
    '''  const { data, error } = await supabase.rpc("create_appointment", {
    p_owner_doctor_id: v.ownerDoctorId,
    p_practice_location_id: ctx.locationId,
    p_patient_id: v.patientId,
    p_scheduled_for: instant,
    p_duration_minutes: v.durationMinutes,
    p_visit_type: v.visitType,
    p_reason: empty(formData.get("reason")),
  });''',
    '''  const managed = await managedStaffAt(ctx.locationId);
  const { data, error } = managed
    ? await supabase.rpc("staff_create_appointment", {
        target_doctor_id: v.ownerDoctorId,
        target_location_id: ctx.locationId,
        target_patient_id: v.patientId,
        target_scheduled_for: instant,
        target_duration_minutes: v.durationMinutes,
        target_visit_type: v.visitType,
        target_reason: empty(formData.get("reason")),
      })
    : await supabase.rpc("create_appointment", {
        p_owner_doctor_id: v.ownerDoctorId,
        p_practice_location_id: ctx.locationId,
        p_patient_id: v.patientId,
        p_scheduled_for: instant,
        p_duration_minutes: v.durationMinutes,
        p_visit_type: v.visitType,
        p_reason: empty(formData.get("reason")),
      });''',
)
replace_once(
    "src/features/appointments/actions.ts",
    '''  const note = empty(formData.get("note"));
  let mutationError: { code?: string; message: string } | null = null;

  if (v.toStatus === "CANCELLED" && v.reason) {''',
    '''  const note = empty(formData.get("note"));
  const managed = await managedStaffAt(ctx.locationId);
  let mutationError: { code?: string; message: string } | null = null;

  if (managed) {
    const managedResult = await supabase.rpc("staff_set_appointment_status", {
      target_appointment_id: v.appointmentId,
      target_status: v.toStatus,
      target_reason: v.reason ?? null,
      target_note: note,
    });
    mutationError = managedResult.error;
  } else if (v.toStatus === "CANCELLED" && v.reason) {''',
)
replace_once(
    "src/features/appointments/actions.ts",
    '''  const { data, error } = await supabase.rpc("reschedule_appointment", {
    p_appointment_id: v.appointmentId,
    p_scheduled_for: instant,
    p_duration_minutes: v.durationMinutes ?? null,
    p_note: empty(formData.get("note")),
  });''',
    '''  const managed = await managedStaffAt(ctx.locationId);
  const { data, error } = managed
    ? await supabase.rpc("staff_reschedule_appointment", {
        target_appointment_id: v.appointmentId,
        target_scheduled_for: instant,
        target_duration_minutes: v.durationMinutes ?? null,
        target_note: empty(formData.get("note")),
      })
    : await supabase.rpc("reschedule_appointment", {
        p_appointment_id: v.appointmentId,
        p_scheduled_for: instant,
        p_duration_minutes: v.durationMinutes ?? null,
        p_note: empty(formData.get("note")),
      });''',
)

replace_once(
    "src/features/queue/actions.ts",
    '''function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}
''',
    '''function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}
''' + managed_helper,
)
replace_once(
    "src/features/queue/actions.ts",
    '''  const { data, error } = await supabase.rpc("call_patient", {
    p_appointment_id: parsed.data.appointmentId,
    p_practice_location_id: ctx.locationId,
    p_note: empty(formData.get("note")),
  });''',
    '''  const managed = await managedStaffAt(ctx.locationId);
  const { data, error } = managed
    ? await supabase.rpc("staff_call_patient", {
        target_appointment_id: parsed.data.appointmentId,
        target_location_id: ctx.locationId,
        target_note: empty(formData.get("note")),
      })
    : await supabase.rpc("call_patient", {
        p_appointment_id: parsed.data.appointmentId,
        p_practice_location_id: ctx.locationId,
        p_note: empty(formData.get("note")),
      });''',
)
replace_once(
    "src/features/queue/actions.ts",
    '''  const { error } = await supabase.rpc("skip_patient", {
    p_appointment_id: parsed.data.appointmentId,
    p_practice_location_id: ctx.locationId,
    p_note: empty(formData.get("note")),
  });''',
    '''  const managed = await managedStaffAt(ctx.locationId);
  const { error } = managed
    ? await supabase.rpc("staff_skip_patient", {
        target_appointment_id: parsed.data.appointmentId,
        target_location_id: ctx.locationId,
        target_note: empty(formData.get("note")),
      })
    : await supabase.rpc("skip_patient", {
        p_appointment_id: parsed.data.appointmentId,
        p_practice_location_id: ctx.locationId,
        p_note: empty(formData.get("note")),
      });''',
)
replace_once(
    "src/features/queue/actions.ts",
    '''  const { error } = await supabase.rpc("set_queue_priority", {
    p_appointment_id: parsed.data.appointmentId,
    p_practice_location_id: ctx.locationId,
    p_reason: parsed.data.reason,
    p_note: empty(formData.get("note")),
  });''',
    '''  const managed = await managedStaffAt(ctx.locationId);
  const { error } = managed
    ? await supabase.rpc("staff_set_queue_priority", {
        target_appointment_id: parsed.data.appointmentId,
        target_location_id: ctx.locationId,
        target_reason: parsed.data.reason,
        target_note: empty(formData.get("note")),
      })
    : await supabase.rpc("set_queue_priority", {
        p_appointment_id: parsed.data.appointmentId,
        p_practice_location_id: ctx.locationId,
        p_reason: parsed.data.reason,
        p_note: empty(formData.get("note")),
      });''',
)
replace_once(
    "src/features/queue/actions.ts",
    '''  const { error } = await supabase.rpc("clear_queue_priority", {
    p_appointment_id: id,
    p_practice_location_id: ctx.locationId,
  });''',
    '''  const managed = await managedStaffAt(ctx.locationId);
  const { error } = managed
    ? await supabase.rpc("staff_clear_queue_priority", {
        target_appointment_id: id,
        target_location_id: ctx.locationId,
      })
    : await supabase.rpc("clear_queue_priority", {
        p_appointment_id: id,
        p_practice_location_id: ctx.locationId,
      });''',
)

replace_once(
    "src/features/queue/queries.ts",
    '''  const { data, error } = await timedPreviewStage(
    "m1-queue-timing",
    "get_queue_rpc",
    supabase.rpc("get_queue", {
      p_practice_location_id: practiceLocationId,
      p_session_date: sessionDate,
    }),
  );''',
    '''  const managedCheck = await supabase.rpc("managed_staff_entry_at", {
    target_location: practiceLocationId,
  });
  if (managedCheck.error) {
    return { ok: false, reason: "managed-staff-context-check-failed" };
  }
  const queueRpc = managedCheck.data === true
    ? supabase.rpc("staff_get_queue", {
        target_location_id: practiceLocationId,
        target_session_date: sessionDate,
      })
    : supabase.rpc("get_queue", {
        p_practice_location_id: practiceLocationId,
        p_session_date: sessionDate,
      });
  const { data, error } = await timedPreviewStage(
    "m1-queue-timing",
    "get_queue_rpc",
    queueRpc,
  );''',
)

migration = Path("supabase/migrations/0053_staff_management_v1.sql")
text = migration.read_text(encoding="utf-8")
marker = "\n-- New tables are Doctor-owned or actor-visible only.\n"
if text.count(marker) != 1:
    raise SystemExit("migration marker mismatch")
extra = r'''

create or replace function public.staff_reschedule_appointment(
  target_appointment_id uuid,
  target_scheduled_for timestamptz,
  target_duration_minutes integer default null,
  target_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.appointments%rowtype;
  v_new_id uuid;
  v_session_day date;
begin
  perform public.require_aal2();
  select * into v_old from public.appointments where id=target_appointment_id for update;
  if not found or not public.has_doctor_staff_permission(v_old.owner_doctor_id,v_old.practice_location_id,'appointments.manage') then
    raise exception 'STAFF_APPOINTMENT_RESCHEDULE_FORBIDDEN' using errcode='42501';
  end if;
  if v_old.status in ('COMPLETED','CANCELLED','NO_SHOW') then
    raise exception 'STAFF_APPOINTMENT_RESCHEDULE_INVALID' using errcode='22023';
  end if;
  if target_scheduled_for is null then raise exception 'STAFF_APPOINTMENT_TIME_REQUIRED' using errcode='22023'; end if;
  update public.appointments set status='CANCELLED',cancelled_at=now(),cancellation_reason='RESCHEDULED',
    cancellation_note=nullif(btrim(coalesce(target_note,'')),''),updated_at=now() where id=v_old.id;
  insert into public.appointment_events(appointment_id,practice_location_id,event_type,from_status,to_status,actor_id,note)
  values(v_old.id,v_old.practice_location_id,'RESCHEDULED',v_old.status,'CANCELLED',auth.uid(),nullif(btrim(coalesce(target_note,'')),''));
  v_session_day := public.session_date_for(v_old.practice_location_id,target_scheduled_for);
  insert into public.appointments(owner_doctor_id,practice_location_id,patient_id,scheduled_for,session_date,duration_minutes,visit_type,reason,rescheduled_from_id,created_by)
  values(v_old.owner_doctor_id,v_old.practice_location_id,v_old.patient_id,target_scheduled_for,v_session_day,
    coalesce(target_duration_minutes,v_old.duration_minutes),v_old.visit_type,v_old.reason,v_old.id,auth.uid()) returning id into v_new_id;
  insert into public.appointment_events(appointment_id,practice_location_id,event_type,to_status,actor_id)
  values(v_new_id,v_old.practice_location_id,'CREATED','SCHEDULED',auth.uid());
  insert into public.audit_events(practice_location_id,actor_id,action,resource_type,resource_id,meta)
  values(v_old.practice_location_id,auth.uid(),'STAFF_APPOINTMENT_RESCHEDULED','appointment',v_new_id,
    jsonb_build_object('doctor_profile_id',v_old.owner_doctor_id,'from_appointment_id',v_old.id));
  return v_new_id;
end;
$$;

create or replace function public.staff_queue_entry_for(target_appointment_id uuid,target_location_id uuid)
returns public.queue_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_appt public.appointments%rowtype; v_entry public.queue_entries%rowtype;
begin
  perform public.require_aal2();
  select * into v_appt from public.appointments where id=target_appointment_id;
  if not found or v_appt.practice_location_id<>target_location_id or v_appt.status<>'ARRIVED'
     or not public.has_doctor_staff_permission(v_appt.owner_doctor_id,target_location_id,'queue.manage') then
    raise exception 'STAFF_QUEUE_FORBIDDEN' using errcode='42501';
  end if;
  insert into public.queue_entries(appointment_id,practice_location_id,session_date)
  values(v_appt.id,v_appt.practice_location_id,v_appt.session_date)
  on conflict(appointment_id) do update set updated_at=public.queue_entries.updated_at
  returning * into v_entry;
  return v_entry;
end;
$$;

create or replace function public.staff_call_patient(target_appointment_id uuid,target_location_id uuid,target_note text default null)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry public.queue_entries%rowtype; v_was_skipped boolean; v_count integer; v_doc uuid;
begin
  v_entry := public.staff_queue_entry_for(target_appointment_id,target_location_id);
  select owner_doctor_id into v_doc from public.appointments where id=target_appointment_id;
  v_was_skipped := v_entry.skipped_at is not null;
  update public.queue_entries set called_at=now(),call_count=call_count+1,skipped_at=null,updated_at=now()
  where appointment_id=target_appointment_id returning call_count into v_count;
  insert into public.queue_events(appointment_id,practice_location_id,event_type,note,actor_id)
  values(target_appointment_id,target_location_id,(case when v_was_skipped then 'RECALLED' else 'CALLED' end)::public.queue_event_type,
    nullif(btrim(coalesce(target_note,'')),''),auth.uid());
  insert into public.audit_events(practice_location_id,actor_id,action,resource_type,resource_id,meta)
  values(target_location_id,auth.uid(),'STAFF_QUEUE_CALLED','appointment',target_appointment_id,jsonb_build_object('doctor_profile_id',v_doc));
  return v_count;
end;
$$;

create or replace function public.staff_skip_patient(target_appointment_id uuid,target_location_id uuid,target_note text default null)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry public.queue_entries%rowtype; v_count integer; v_doc uuid;
begin
  v_entry := public.staff_queue_entry_for(target_appointment_id,target_location_id);
  select owner_doctor_id into v_doc from public.appointments where id=target_appointment_id;
  if v_entry.skipped_at is not null then return v_entry.skip_count; end if;
  update public.queue_entries set skipped_at=now(),skip_count=skip_count+1,updated_at=now()
  where appointment_id=target_appointment_id returning skip_count into v_count;
  insert into public.queue_events(appointment_id,practice_location_id,event_type,note,actor_id)
  values(target_appointment_id,target_location_id,'SKIPPED',nullif(btrim(coalesce(target_note,'')),''),auth.uid());
  insert into public.audit_events(practice_location_id,actor_id,action,resource_type,resource_id,meta)
  values(target_location_id,auth.uid(),'STAFF_QUEUE_SKIPPED','appointment',target_appointment_id,jsonb_build_object('doctor_profile_id',v_doc));
  return v_count;
end;
$$;

create or replace function public.staff_clear_queue_priority(target_appointment_id uuid,target_location_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry public.queue_entries%rowtype; v_doc uuid;
begin
  v_entry := public.staff_queue_entry_for(target_appointment_id,target_location_id);
  select owner_doctor_id into v_doc from public.appointments where id=target_appointment_id;
  update public.queue_entries set priority=0,priority_reason=null,priority_note=null,priority_set_by=auth.uid(),updated_at=now()
  where appointment_id=target_appointment_id;
  insert into public.queue_events(appointment_id,practice_location_id,event_type,actor_id)
  values(target_appointment_id,target_location_id,'PRIORITY_CLEARED',auth.uid());
  insert into public.audit_events(practice_location_id,actor_id,action,resource_type,resource_id,meta)
  values(target_location_id,auth.uid(),'STAFF_QUEUE_PRIORITY_CLEARED','appointment',target_appointment_id,jsonb_build_object('doctor_profile_id',v_doc));
end;
$$;

create or replace function public.staff_get_queue(target_location_id uuid,target_session_date date)
returns table(
  appointment_id uuid, patient_id uuid, patient_name text, patient_number text,
  owner_doctor_id uuid, doctor_name text, token_number integer, status public.appointment_status,
  visit_type public.visit_type, scheduled_for timestamptz, arrived_at timestamptz,
  called_at timestamptz, call_count integer, skipped_at timestamptz, skip_count integer,
  priority integer, priority_reason public.priority_reason, priority_note text
)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  perform public.require_aal2();
  return query
  select a.id,p.id,p.full_name,p.patient_number,a.owner_doctor_id,pr.full_name,a.token_number,a.status,a.visit_type,
    a.scheduled_for,a.arrived_at,q.called_at,coalesce(q.call_count,0),q.skipped_at,coalesce(q.skip_count,0),
    coalesce(q.priority,0),q.priority_reason,q.priority_note
  from public.appointments a
  join public.patients p on p.id=a.patient_id
  join public.doctor_profiles d on d.id=a.owner_doctor_id
  join public.profiles pr on pr.id=d.user_id
  left join public.queue_entries q on q.appointment_id=a.id
  where a.practice_location_id=target_location_id and a.session_date=target_session_date
    and a.status in ('ARRIVED','IN_CONSULTATION')
    and public.has_doctor_staff_permission(a.owner_doctor_id,a.practice_location_id,'queue.manage')
  order by case when a.status='IN_CONSULTATION' then 0 else 1 end,
    case when q.skipped_at is not null then 1 else 0 end,coalesce(q.priority,0) desc,a.token_number asc nulls last;
end;
$$;

revoke all on function public.staff_reschedule_appointment(uuid,timestamptz,integer,text) from public;
revoke all on function public.staff_queue_entry_for(uuid,uuid) from public,anon,authenticated;
revoke all on function public.staff_call_patient(uuid,uuid,text) from public;
revoke all on function public.staff_skip_patient(uuid,uuid,text) from public;
revoke all on function public.staff_clear_queue_priority(uuid,uuid) from public;
revoke all on function public.staff_get_queue(uuid,date) from public;
grant execute on function public.staff_reschedule_appointment(uuid,timestamptz,integer,text) to authenticated;
grant execute on function public.staff_call_patient(uuid,uuid,text) to authenticated;
grant execute on function public.staff_skip_patient(uuid,uuid,text) to authenticated;
grant execute on function public.staff_clear_queue_priority(uuid,uuid) to authenticated;
grant execute on function public.staff_get_queue(uuid,date) to authenticated;
'''
migration.write_text(text.replace(marker, extra + marker, 1), encoding="utf-8")
print("staff finalization transforms applied")
