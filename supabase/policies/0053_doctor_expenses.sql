-- V3 Doctor Expense Ledger: doctor-owned practice costs only.
alter table public.doctor_expenses enable row level security;
alter table public.doctor_expenses force row level security;

revoke all on public.doctor_expenses from anon;
grant select, insert, update, delete on public.doctor_expenses to authenticated;

create or replace function public.doctor_may_expense_at(target_location uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.practice_location_members m
    join public.doctor_profiles d on d.user_id = auth.uid()
    where m.practice_location_id = target_location
      and m.user_id = auth.uid() and m.role = 'DOCTOR'
      and m.status = 'ACTIVE' and d.id = public.current_doctor_id()
  );
$$;
revoke all on function public.doctor_may_expense_at(uuid) from public, anon;
grant execute on function public.doctor_may_expense_at(uuid) to authenticated;

drop policy if exists doctor_expenses_select on public.doctor_expenses;
create policy doctor_expenses_select on public.doctor_expenses for select to authenticated
using (owner_doctor_id = public.current_doctor_id() and public.doctor_may_expense_at(practice_location_id));

drop policy if exists doctor_expenses_insert on public.doctor_expenses;
create policy doctor_expenses_insert on public.doctor_expenses for insert to authenticated
with check (owner_doctor_id = public.current_doctor_id() and public.doctor_may_expense_at(practice_location_id));
drop policy if exists doctor_expenses_update on public.doctor_expenses;
create policy doctor_expenses_update on public.doctor_expenses for update to authenticated
using (owner_doctor_id = public.current_doctor_id() and public.doctor_may_expense_at(practice_location_id))
with check (owner_doctor_id = public.current_doctor_id() and public.doctor_may_expense_at(practice_location_id));

drop policy if exists doctor_expenses_delete on public.doctor_expenses;
create policy doctor_expenses_delete on public.doctor_expenses for delete to authenticated
using (owner_doctor_id = public.current_doctor_id() and public.doctor_may_expense_at(practice_location_id));

create or replace function public.doctor_expense_chambers()
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('locationId', pl.id, 'locationName', pl.name, 'timezone', pl.timezone) order by pl.name), '[]'::jsonb)
  from public.practice_location_members m
  join public.practice_locations pl on pl.id = m.practice_location_id
  where m.user_id = auth.uid() and m.role = 'DOCTOR' and m.status = 'ACTIVE' and pl.is_active = true;
$$;
revoke all on function public.doctor_expense_chambers() from public, anon;
grant execute on function public.doctor_expense_chambers() to authenticated;
