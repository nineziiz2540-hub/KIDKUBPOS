-- Follow-up to 20261022120000_shift_management.
--
-- shift_open compares the morning count with the float of the *latest* closed shift. shift_close
-- stamped closed_at with now(), the transaction start, so two closes in one transaction tied and
-- shift_open could pick the older shift (found by the DB test). closed_at now uses
-- clock_timestamp(), and shift_open breaks any remaining tie by opened_at.

create or replace function public.shift_open(
  p_tenant_id uuid, p_actor_id uuid, p_counts numeric[], p_note text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n integer := coalesce(array_length(p_counts, 1), 0);
  v_prev public.shifts%rowtype;
  v_expected numeric;
  v_final numeric;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v_n < 1 or v_n > 2 or exists (
    select 1 from unnest(p_counts) as c(v)
    where c.v is null or c.v < 0 or c.v > 1000000 or c.v <> round(c.v, 2)
  ) then
    raise exception 'invalid_counts';
  end if;
  perform public.shift_assert_actor(p_tenant_id, p_actor_id);
  if exists (select 1 from public.shifts where tenant_id = p_tenant_id and status = 'open') then
    raise exception 'shift_already_open';
  end if;

  select * into v_prev
  from public.shifts
  where tenant_id = p_tenant_id and status = 'closed'
  order by closed_at desc nulls last, opened_at desc
  limit 1;
  v_expected := case when found then v_prev.float_left else null end;
  v_final := p_counts[v_n];

  if v_expected is null then
    if v_n = 2 then
      raise exception 'invalid_counts';  -- nothing to compare with, so nothing to recount
    end if;
  elsif v_n = 1 and p_counts[1] <> v_expected then
    raise exception 'recount_required';
  elsif v_n = 2 and p_counts[1] = v_expected then
    raise exception 'invalid_counts';    -- the first count matched; there was no recount
  end if;

  begin
    insert into public.shifts
      (tenant_id, opened_by, opening_cash, opening_expected, opening_difference, opening_note,
       previous_shift_id)
    values
      (p_tenant_id, p_actor_id, v_final, v_expected,
       case when v_expected is null then null else v_final - v_expected end,
       v_note,
       case when v_expected is null then null else v_prev.id end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'shift_already_open';
  end;

  insert into public.shift_cash_counts (tenant_id, shift_id, stage, attempt, amount, expected, created_by)
  select p_tenant_id, v_id, 'opening', i, p_counts[i], v_expected, p_actor_id
  from generate_series(1, v_n) as i;

  return v_id;
end;
$$;

create or replace function public.shift_close(
  p_tenant_id uuid, p_shift_id uuid, p_actor_id uuid, p_float_left numeric, p_note text
)
returns table (counted numeric, expected numeric, variance numeric, float_left numeric, deposit numeric)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_status text;
  v_last public.shift_cash_counts%rowtype;
  v_attempts integer;
  v_totals record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.shift_assert_actor(p_tenant_id, p_actor_id);
  select s.status into v_status
  from public.shifts s
  where s.id = p_shift_id and s.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'shift_not_found';
  end if;
  if v_status <> 'open' then
    raise exception 'shift_closed';
  end if;

  select * into v_last
  from public.shift_cash_counts c
  where c.shift_id = p_shift_id and c.stage = 'closing'
  order by c.attempt desc
  limit 1;
  if not found then
    raise exception 'count_required';
  end if;
  select count(*) into v_attempts
  from public.shift_cash_counts c
  where c.shift_id = p_shift_id and c.stage = 'closing';

  select * into v_totals from public.shift_totals(p_tenant_id, p_shift_id);
  if v_totals.expected_cash <> v_last.expected then
    raise exception 'expected_changed';
  end if;
  if v_last.amount <> v_last.expected and v_attempts < 2 then
    raise exception 'recount_required';
  end if;
  if p_float_left is null or p_float_left < 0 or p_float_left > v_last.amount
     or p_float_left <> round(p_float_left, 2) then
    raise exception 'invalid_float';
  end if;

  update public.shifts
  set status = 'closed',
      closed_by = p_actor_id,
      closed_at = clock_timestamp(),
      closing_cash_counted = v_last.amount,
      expected_cash = v_totals.expected_cash,
      variance = v_last.amount - v_totals.expected_cash,
      float_left = p_float_left,
      deposit_amount = v_last.amount - p_float_left,
      closing_note = v_note,
      closing_cash_sales = v_totals.cash_sales,
      closing_cash_refunds = v_totals.cash_refunds,
      closing_transfer_sales = v_totals.transfer_sales,
      closing_order_count = v_totals.order_count,
      closing_cash_in = v_totals.cash_in,
      closing_cash_out = v_totals.cash_out
  where id = p_shift_id;

  return query select
    v_last.amount, v_totals.expected_cash, v_last.amount - v_totals.expected_cash,
    p_float_left, v_last.amount - p_float_left;
end;
$$;

-- create or replace keeps the existing grants; restated so this file stands on its own.
revoke execute on function public.shift_open(uuid, uuid, numeric[], text) from public, anon, authenticated;
revoke execute on function public.shift_close(uuid, uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.shift_open(uuid, uuid, numeric[], text) to service_role;
grant execute on function public.shift_close(uuid, uuid, uuid, numeric, text) to service_role;
