-- Doctor-owned patient/practice revenue ledger. Never SaaS subscription billing.
alter table public.practice_payments enable row level security;
alter table public.practice_payments force row level security;
revoke all on public.practice_payments from anon;
grant select, insert, update, delete on public.practice_payments to authenticated;

create or replace function public.doctor_may_record_payment_at(target_location uuid)
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
revoke all on function public.doctor_may_record_payment_at(uuid) from public, anon;
grant execute on function public.doctor_may_record_payment_at(uuid) to authenticated;

drop policy if exists practice_payments_select on public.practice_payments;
create policy practice_payments_select on public.practice_payments for select to authenticated
using (owner_doctor_id = public.current_doctor_id() and public.doctor_may_record_payment_at(practice_location_id));
drop policy if exists practice_payments_insert on public.practice_payments;
create policy practice_payments_insert on public.practice_payments for insert to authenticated
with check (owner_doctor_id = public.current_doctor_id() and public.doctor_may_record_payment_at(practice_location_id));
drop policy if exists practice_payments_update on public.practice_payments;
create policy practice_payments_update on public.practice_payments for update to authenticated
using (owner_doctor_id = public.current_doctor_id() and public.doctor_may_record_payment_at(practice_location_id))
with check (owner_doctor_id = public.current_doctor_id() and public.doctor_may_record_payment_at(practice_location_id));
drop policy if exists practice_payments_delete on public.practice_payments;
create policy practice_payments_delete on public.practice_payments for delete to authenticated
using (owner_doctor_id = public.current_doctor_id() and public.doctor_may_record_payment_at(practice_location_id));
