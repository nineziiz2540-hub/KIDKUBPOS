-- Shift management round B, migration A (additive): blind cash counts with one recount, cash
-- in/out of the drawer, the overnight float and bank deposit, and close-time total snapshots.
--
-- Every write goes through service-role-only functions called by the shift server actions. Each
-- one locks the shift row (FOR UPDATE), so counts, movements and closing are serialised.
-- Safe for the deployed code: it never reads or writes the new objects, and the one-open-shift
-- index only rejects the second shift of a race the old code could already lose.
-- Migration B (20261022130000_shift_lockdown) removes Data-API writes to shifts and guards
-- orders; it is applied only after the new code is deployed.

-- ── Setting ─────────────────────────────────────────────────────────────────
alter table public.tenants
  add column cash_float_default numeric(10,2) not null default 1000
    check (cash_float_default between 0 and 100000);

comment on column public.tenants.cash_float_default is
  'Cash left in the drawer overnight as change for the next day; pre-fills the closing step.';

-- ── Shift columns (all nullable: old rows and old-code shifts have none) ─────
alter table public.shifts
  add column opening_expected numeric(10,2),
  add column opening_difference numeric(10,2),
  add column opening_note text,
  add column previous_shift_id uuid references public.shifts (id),
  add column closing_note text,
  add column float_left numeric(10,2),
  add column deposit_amount numeric(10,2),
  add column closing_cash_sales numeric(10,2),
  add column closing_cash_refunds numeric(10,2),
  add column closing_transfer_sales numeric(10,2),
  add column closing_order_count integer,
  add column closing_cash_in numeric(10,2),
  add column closing_cash_out numeric(10,2);

comment on column public.shifts.opening_expected is
  'The previous shift''s float_left the morning count was compared with; null = nothing to compare.';
comment on column public.shifts.float_left is
  'Cash left in the drawer at closing (overnight float). Null for shifts closed by the old code.';

alter table public.shifts
  add constraint shifts_status_check check (status in ('open', 'closed')),
  add constraint shifts_float_check check (
    float_left is null
    or (closing_cash_counted is not null and float_left >= 0 and float_left <= closing_cash_counted)
  ),
  add constraint shifts_deposit_check check (
    deposit_amount is null
    or (float_left is not null and deposit_amount = closing_cash_counted - float_left)
  ),
  add constraint shifts_notes_check check (
    (opening_note is null or char_length(opening_note) <= 200)
    and (closing_note is null or char_length(closing_note) <= 200)
  );

-- Two "open shift" taps at once (two iPads, a double tap) could both pass the app's "is a shift
-- open?" check; getActiveShift's maybeSingle() then sees two rows and every later sale silently
-- gets no shift. One open shift per tenant, enforced here.
create unique index shifts_one_open_per_tenant on public.shifts (tenant_id) where status = 'open';

-- shift_totals sums a shift's orders; neither column had an index.
create index orders_shift_id_idx on public.orders (shift_id) where shift_id is not null;
create index orders_refund_shift_id_idx on public.orders (refund_shift_id) where refund_shift_id is not null;

-- ── Append-only tables ──────────────────────────────────────────────────────
create table public.shift_cash_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  shift_id uuid not null references public.shifts (id) on delete restrict,
  stage text not null check (stage in ('opening', 'closing')),
  attempt integer not null check (attempt > 0),
  amount numeric(10,2) not null check (amount between 0 and 1000000),
  -- What the count was compared with; null at opening when there was nothing to compare.
  expected numeric(10,2),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default clock_timestamp(),
  unique (shift_id, stage, attempt)
);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  shift_id uuid not null references public.shifts (id) on delete restrict,
  direction text not null check (direction in ('in', 'out')),
  reason text not null check (reason in
    ('personal_topup', 'purchase', 'personal_return', 'correction', 'other_in', 'other_out')),
  amount numeric(10,2) not null check (amount > 0 and amount <= 100000),
  note text check (note is null or char_length(note) <= 200),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default clock_timestamp(),
  constraint cash_movements_reason_direction_check check (
    reason = 'correction'
    or (direction = 'in' and reason in ('personal_topup', 'other_in'))
    or (direction = 'out' and reason in ('purchase', 'personal_return', 'other_out'))
  ),
  constraint cash_movements_note_required_check check (
    reason not in ('correction', 'other_in', 'other_out') or coalesce(btrim(note), '') <> ''
  )
);

create index shift_cash_counts_shift_idx on public.shift_cash_counts (shift_id, stage, attempt);
create index cash_movements_shift_idx on public.cash_movements (shift_id, created_at);

alter table public.shift_cash_counts enable row level security;
alter table public.cash_movements enable row level security;

create policy shift_cash_counts_select on public.shift_cash_counts
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());
create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

revoke all on public.shift_cash_counts from anon;
revoke all on public.cash_movements from anon;
revoke insert, update, delete, truncate on public.shift_cash_counts from authenticated;
revoke insert, update, delete, truncate on public.cash_movements from authenticated;

-- Append-only for every caller, the service role included: a mistaken movement is fixed by a
-- 'correction' movement the other way, never by editing. Deliberate data purges (QA clean-up,
-- the go-live test-data wipe) set kidkub.allow_purge = 'on' for their transaction.
create or replace function public.prevent_append_only_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('kidkub.allow_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'append_only';
end;
$$;

create trigger shift_cash_counts_append_only
before update or delete on public.shift_cash_counts
for each row execute function public.prevent_append_only_change();
create trigger cash_movements_append_only
before update or delete on public.cash_movements
for each row execute function public.prevent_append_only_change();

revoke execute on function public.prevent_append_only_change() from public, anon, authenticated;

-- ── Service-only functions ──────────────────────────────────────────────────

-- The actor must be an active member of the tenant (deactivated staff keep no rights).
create or replace function public.shift_assert_actor(p_tenant_id uuid, p_actor_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and tenant_id = p_tenant_id and deactivated_at is null
  ) then
    raise exception 'forbidden';
  end if;
end;
$$;

-- What the drawer should hold. The cash of an order refunded later still counts as a sale of its
-- own shift; the refund is subtracted from the shift it happened in (refund_shift_id), which may
-- be a different one (same reasoning as the old getShiftSummary).
create or replace function public.shift_totals(p_tenant_id uuid, p_shift_id uuid)
returns table (
  opening_cash numeric, cash_sales numeric, cash_refunds numeric, transfer_sales numeric,
  order_count integer, cash_in numeric, cash_out numeric, expected_cash numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_opening numeric;
begin
  select s.opening_cash into v_opening
  from public.shifts s
  where s.id = p_shift_id and s.tenant_id = p_tenant_id;
  if not found then
    raise exception 'shift_not_found';
  end if;

  return query
  with sales as (
    select
      coalesce(sum(o.total) filter (where o.payment_method = 'cash'), 0) as cash_sales,
      coalesce(sum(o.total) filter (where o.payment_method = 'transfer'), 0) as transfer_sales,
      count(*)::integer as order_count
    from public.orders o
    where o.tenant_id = p_tenant_id and o.shift_id = p_shift_id
      and o.status in ('completed', 'refunded')
  ), refunds as (
    select coalesce(sum(o.total), 0) as cash_refunds
    from public.orders o
    where o.tenant_id = p_tenant_id and o.refund_shift_id = p_shift_id
      and o.status = 'refunded' and o.refund_method = 'cash'
  ), moves as (
    select
      coalesce(sum(m.amount) filter (where m.direction = 'in'), 0) as cash_in,
      coalesce(sum(m.amount) filter (where m.direction = 'out'), 0) as cash_out
    from public.cash_movements m
    where m.tenant_id = p_tenant_id and m.shift_id = p_shift_id
  )
  select
    v_opening, sales.cash_sales, refunds.cash_refunds, sales.transfer_sales, sales.order_count,
    moves.cash_in, moves.cash_out,
    v_opening + sales.cash_sales - refunds.cash_refunds + moves.cash_in - moves.cash_out
  from sales, refunds, moves;
end;
$$;

-- Open a shift from the morning count(s). p_counts is [count] or [first count, recount]. The
-- count is compared with the float the latest closed shift left in the drawer; a shift closed by
-- the old code has none, so there is nothing to compare with.
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
  order by closed_at desc nulls last
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

-- Record one closing count and say what it was compared with. Written before the result is shown,
-- so the first number someone typed can never be replaced.
create or replace function public.shift_record_closing_count(
  p_tenant_id uuid, p_shift_id uuid, p_actor_id uuid, p_amount numeric
)
returns table (attempt integer, expected numeric)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_status text;
  v_expected numeric;
  v_attempt integer;
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
  if p_amount is null or p_amount < 0 or p_amount > 1000000 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_amount';
  end if;

  select t.expected_cash into v_expected from public.shift_totals(p_tenant_id, p_shift_id) t;
  select coalesce(max(c.attempt), 0) + 1 into v_attempt
  from public.shift_cash_counts c
  where c.shift_id = p_shift_id and c.stage = 'closing';

  insert into public.shift_cash_counts (tenant_id, shift_id, stage, attempt, amount, expected, created_by)
  values (p_tenant_id, p_shift_id, 'closing', v_attempt, p_amount, v_expected, p_actor_id);

  return query select v_attempt, v_expected;
end;
$$;

-- Close the shift with its latest closing count. Refused unless that count was compared with the
-- expected cash as it is now (nothing changed the drawer since) and either matched or is at least
-- the second count — the one-recount rule, enforced here rather than by the screen.
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
      closed_at = now(),
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

-- Record cash put into or taken out of the drawer for anything other than a sale or a refund.
-- No PIN (the user's decision: emergencies like milk or ice running out must be quick); the
-- person who opened the shift is accountable, and every movement keeps who and when.
create or replace function public.shift_add_cash_movement(
  p_tenant_id uuid, p_shift_id uuid, p_actor_id uuid,
  p_direction text, p_reason text, p_amount numeric, p_note text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
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
  if p_direction is null or p_reason is null
     or not (
       p_reason = 'correction' and p_direction in ('in', 'out')
       or p_direction = 'in' and p_reason in ('personal_topup', 'other_in')
       or p_direction = 'out' and p_reason in ('purchase', 'personal_return', 'other_out')
     ) then
    raise exception 'invalid_reason';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_amount';
  end if;
  if p_reason in ('correction', 'other_in', 'other_out') and v_note is null then
    raise exception 'note_required';
  end if;

  insert into public.cash_movements (tenant_id, shift_id, direction, reason, amount, note, created_by)
  values (p_tenant_id, p_shift_id, p_direction, p_reason, p_amount, v_note, p_actor_id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.shift_assert_actor(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.shift_totals(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.shift_open(uuid, uuid, numeric[], text) from public, anon, authenticated;
revoke execute on function public.shift_record_closing_count(uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function public.shift_close(uuid, uuid, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.shift_add_cash_movement(uuid, uuid, uuid, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.shift_assert_actor(uuid, uuid) to service_role;
grant execute on function public.shift_totals(uuid, uuid) to service_role;
grant execute on function public.shift_open(uuid, uuid, numeric[], text) to service_role;
grant execute on function public.shift_record_closing_count(uuid, uuid, uuid, numeric) to service_role;
grant execute on function public.shift_close(uuid, uuid, uuid, numeric, text) to service_role;
grant execute on function public.shift_add_cash_movement(uuid, uuid, uuid, text, text, numeric, text) to service_role;
