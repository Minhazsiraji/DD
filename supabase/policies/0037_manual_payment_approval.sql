-- Manual payment approval — closing the loop 0030 deliberately left open.
--
-- ORDERING — RUN `db:migrate` BEFORE `db:policies`. Nothing is created here.
-- `subscription_payments` and `doctor_subscriptions` are owned by migration
-- 0018_omniscient_post; this file only adds the decision path over them.
--
-- WHY THIS WAS MISSING ON PURPOSE. 0030 shipped a payment a doctor could
-- SUBMIT and nobody could confirm: no function anywhere set CONFIRMED or
-- ACTIVE, because letting a doctor confirm their own payment is not an
-- approval workflow, it is an honour system with extra steps. The missing
-- piece was an approver. Platform owner authority (0033) is that approver, and
-- this is the second thing it decides.
--
-- THE DOCTOR STILL CANNOT REACH CONFIRMED. Every function below is gated on
-- `is_platform_owner()`. The submit path in 0030 is untouched and still writes
-- PENDING only.
--
-- COMMERCIAL STATE IS NOT CLINICAL STATE. Confirming a payment moves a
-- subscription and writes an audit row. It does not read, write or delete a
-- patient, an encounter or a prescription — the same invariant 0030 established
-- for cancellation, now restated for activation. Money changing hands must
-- never touch the record of care.
--
-- MANUAL APPROVAL GOVERNS MANUAL PAYMENTS, AND ONLY THOSE.
--
-- `subscription_payments.method` allows MANUAL_BANK, SSLCOMMERZ, CARD and
-- OTHER. A human confirming a MANUAL_BANK transfer is doing the verification
-- themselves: they looked at a bank statement. A gateway payment is verified by
-- the provider, and its PENDING row means "the provider has not confirmed this
-- yet" — a human marking that CONFIRMED would be asserting something they have
-- not checked and cannot check, straight past the trust boundary the gateway
-- exists to be.
--
-- So both functions below are scoped to MANUAL_BANK. When a gateway is
-- integrated it brings its own confirmation path; it does not borrow this one.
--
-- OTHER IS NOT MANUAL. It is undefined, and an undefined method must not
-- inherit human approval by being lumped in with the one we understand. When
-- OTHER acquires a meaning, whoever gives it one can decide who may confirm it.

-- ---------------------------------------------------------------------------
-- Review queue
-- ---------------------------------------------------------------------------

/**
 * MANUAL payments awaiting a decision, with the minimum needed to decide.
 *
 * A reviewer matching a bank transfer to an account needs the amount, the
 * reference, when it was submitted and whose subscription it belongs to. They
 * do not need — and do not get — anything clinical.
 *
 * Gateway payments are absent by construction, not merely un-actionable. A
 * queue that listed them would invite someone to wonder why they cannot be
 * cleared, and the answer is that they are not this reviewer's to clear.
 */
create or replace function public.owner_pending_payments()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'NOT_PLATFORM_OWNER';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pay.id,
      'amount', pay.amount,
      'currency', pay.currency,
      'method', pay.method,
      'payerReference', pay.payer_reference,
      'note', pay.note,
      'submittedAt', pay.submitted_at,
      'subscriptionId', s.id,
      'subscriptionStatus', s.status,
      'planCode', p.code,
      'doctorName', prof.full_name,
      'currentPeriodEnd', s.current_period_end
    ) order by pay.submitted_at)
    from public.subscription_payments pay
    join public.doctor_subscriptions s on s.id = pay.subscription_id
    join public.subscription_plans p on p.id = s.plan_id
    join public.doctor_profiles d on d.id = s.doctor_profile_id
    join public.profiles prof on prof.id = d.user_id
    where pay.status = 'PENDING'
      and pay.method = 'MANUAL_BANK'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.owner_pending_payments() from public, anon;
grant execute on function public.owner_pending_payments() to authenticated;

-- ---------------------------------------------------------------------------
-- The decision
-- ---------------------------------------------------------------------------

/**
 * Confirm or reject a manual payment.
 *
 * IDEMPOTENT. Repeating the decision already recorded returns it unchanged and
 * writes no second audit row — a retried request, a double-clicked button and a
 * replayed action all land on the same payment.
 *
 * SETTLED DECISIONS ARE NOT REWRITTEN. Flipping a CONFIRMED payment to REJECTED
 * is refused. A refund or a reversal is a new fact about the world and belongs
 * in a new row, not on top of the old one.
 *
 * ACTIVATION PERIOD. Confirming activates the subscription and runs the period
 * for one month. If the subscription is ALREADY active the period extends from
 * its existing end rather than from today, so a doctor who pays early is not
 * charged for the gap. That is a product decision made here explicitly — it is
 * the single `case` below, and it is the thing to change if the commercial
 * model differs.
 *
 * The row lock is taken before the status is read, for the same reason as the
 * booking-settings audit: two concurrent confirmations must not both observe
 * PENDING and both activate.
 */
create or replace function public.owner_decide_subscription_payment(
  p_payment_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_status text;
  v_method text;
  v_target text;
  v_subscription uuid;
  v_amount numeric;
  v_sub_status text;
  v_period_end timestamptz;
  v_doctor uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'NOT_PLATFORM_OWNER';
  end if;
  if p_decision not in ('CONFIRM', 'REJECT') then
    raise exception 'INVALID_DECISION';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  select pay.status, pay.method, pay.subscription_id, pay.amount
    into v_status, v_method, v_subscription, v_amount
  from public.subscription_payments pay
  where pay.id = p_payment_id
  for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  /*
   * MANUAL ONLY, and checked here rather than left to the queue.
   *
   * Filtering `owner_pending_payments()` hides gateway rows from the screen,
   * but a payment id is a caller-supplied uuid and this function is granted to
   * every authenticated owner — an id obtained any other way would otherwise
   * reach CONFIRMED. The list is a convenience; this is the control.
   *
   * Read under the same lock as the status, so the check cannot be raced.
   */
  if v_method <> 'MANUAL_BANK' then
    raise exception 'PAYMENT_NOT_MANUAL';
  end if;

  v_target := case p_decision when 'CONFIRM' then 'CONFIRMED' else 'REJECTED' end;

  if v_status = v_target then
    return jsonb_build_object('id', p_payment_id, 'status', v_status, 'changed', false);
  end if;
  if v_status <> 'PENDING' then
    raise exception 'PAYMENT_ALREADY_DECIDED';
  end if;

  update public.subscription_payments
  set status = v_target,
      confirmed_at = case when v_target = 'CONFIRMED' then now() else null end,
      recorded_by = v_owner,
      note = coalesce(nullif(btrim(p_note), ''), note)
  where id = p_payment_id;

  if v_target = 'CONFIRMED' then
    select s.status, s.current_period_end, s.doctor_profile_id
      into v_sub_status, v_period_end, v_doctor
    from public.doctor_subscriptions s
    where s.id = v_subscription
    for update;

    /*
     * Extend from the existing end when the subscription is already running,
     * otherwise start the period now. Paying two days early should buy a month,
     * not a month minus two days.
     */
    update public.doctor_subscriptions
    set status = 'ACTIVE',
        current_period_start = case
          when v_sub_status = 'ACTIVE' and v_period_end > now() then current_period_start
          else now()
        end,
        current_period_end = case
          when v_sub_status = 'ACTIVE' and v_period_end > now() then v_period_end + interval '1 month'
          else now() + interval '1 month'
        end,
        grace_until = null,
        updated_at = now()
    where id = v_subscription;
  end if;

  /*
   * Same transaction as the decision. ADR 0007: `emitAudit` swallows failures
   * by design and is the wrong mechanism where the record must not be lost.
   * Confirming money is exactly such a path — if the audit cannot be written,
   * the payment is not confirmed.
   *
   * practice_location_id is null: a subscription decision is a platform event,
   * not something that happened at a place. That is the documented exception
   * for commercial tables, not an omission.
   */
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    null,
    v_owner,
    case when v_target = 'CONFIRMED' then 'SUBSCRIPTION_PAYMENT_CONFIRMED'
         else 'SUBSCRIPTION_PAYMENT_REJECTED' end,
    'subscription_payments',
    p_payment_id,
    jsonb_build_object(
      'subscriptionId', v_subscription,
      'amount', v_amount,
      'fromStatus', v_status,
      'toStatus', v_target,
      'method', v_method,
      'subscriptionWas', v_sub_status,
      'note', nullif(btrim(p_note), '')
    )
  );

  return jsonb_build_object('id', p_payment_id, 'status', v_target, 'changed', true);
end;
$$;

revoke all on function public.owner_decide_subscription_payment(uuid, text, text) from public, anon;
grant execute on function public.owner_decide_subscription_payment(uuid, text, text) to authenticated;

-- What this file does not do: it defines no second owner authority, gives the
-- doctor no path to CONFIRMED, reads no clinical table, models no refund, never
-- rewrites a settled decision, and gives a human no way to confirm a payment a
-- payment provider has not.
