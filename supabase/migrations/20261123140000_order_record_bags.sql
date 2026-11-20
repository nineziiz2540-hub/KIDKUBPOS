-- Round D2a, Task 3: order_record records bags as bill-level stock; order_void returns them;
-- a stock block that fails leaves the owner a "stock_skipped" flag (R28).
--
-- Both bodies are the live D1 bodies (20261118130000_order_record_stock.sql and
-- 20261118150000_order_void_stock.sql, md5(prosrc) a142ed14… / b6672b63… checked against the live
-- functions) plus only the changes below. Same signatures, so no overload; grants re-issued.
--
-- order_record, p_order gains two optional keys (the deployed D1 app sends neither: 0 bags, no
-- bill-level stock, so nothing it does changes):
--   "bags":  int 0..99, stored on orders.bags. Absent, or anything but a whole number 0..99, is 0:
--            a sale is never refused over its bag count.
--   "stock": [{ "material_id": uuid, "qty": number }], bill-level lines (decision D2-1, bags).
--            Checked exactly like the item lines and skipped silently when unusable (a malformed id,
--            a non-numeric, non-positive or out-of-range qty, a material of another shop or an
--            archived one). They join the items' lines with item = null, so the existing block:
--              * locks their materials with the items' ones, in ONE id-ordered set (v_locked);
--              * aggregates them to ONE row per (bill, material), which the bill-level partial unique
--                index inventory_transactions_one_per_bill_material_type requires;
--              * writes a 'sale' row (order_id set, order_item_id null) per tracked material and
--                moves its balance; untracked materials write no row;
--              * leaves every item's cost_total as it was (a bill-level line belongs to no item).
--            Only the created = true path reads them (a replay returns before).
--   R28: when the stock block fails, its exception handler (the savepoint) now also inserts one
--        stock_flags row: kind 'stock_skipped', the order, the Bangkok business date, the seller,
--        detail = SQLSTATE + the first 200 chars of SQLERRM. That insert sits in its own
--        begin … exception when others then null; end; so it can never raise. The warning stays.
--
-- order_void: after the items, the bill-level 'sale' rows of the order (order_item_id null) are put
-- back as 'void_restock' rows (order_item_id null) in every outcome (none / all / partial), from the
-- ledger and never from orders.bags (ruling R-D2a-5). Their materials are already in the id-ordered
-- lock, which reads every 'sale' row of the order. A second void raises not_completed before any
-- restock, and the bill-level partial unique index backs that up.

set local lock_timeout = '5s';

create or replace function public.order_record(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_client_ref uuid,
  p_order jsonb,
  p_items jsonb,
  p_held_bill_id uuid,
  p_held_bill_version int,
  p_held_reductions jsonb,
  p_offline jsonb
)
returns table (
  order_id uuid,
  order_number text,
  queue_number int,
  cash_received numeric,
  change_amount numeric,
  created boolean
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_existing record;
  v_held record;
  v_held_found boolean;
  -- The held bill this order is linked to and closes; null when there is none (or, under
  -- override, when it is no longer open).
  v_held_id uuid := p_held_bill_id;
  v_shift_id uuid;
  v_number text;
  v_queue int;
  v_order record;
  v_offline boolean := p_offline is not null;
  v_override jsonb;
  v_sold_at timestamptz;
  v_created timestamptz;
  v_device_queue int;
  v_charged numeric;
  v_item jsonb;
  v_item_id uuid;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_qty numeric;
  v_locked uuid[];
  v_bags numeric;
begin
  if v_offline then
    if jsonb_typeof(p_offline -> 'override') = 'object' then
      v_override := p_offline -> 'override';
    end if;
    v_sold_at := (p_offline ->> 'sold_at')::timestamptz;
    v_device_queue := (p_offline ->> 'queue_number')::int;
    if v_sold_at is null
       or (p_held_bill_id is null and (v_device_queue is null or v_device_queue < 1)) then
      raise exception 'invalid_offline';
    end if;
  end if;

  if v_override is null then
    perform public.shift_assert_actor(p_tenant_id, p_actor_id);
  else
    -- "Record as charged" keeps the original seller even if since deactivated; the approver
    -- must be an active owner/manager of the same tenant.
    if not exists (select 1 from public.profiles where id = p_actor_id and tenant_id = p_tenant_id)
       or not exists (select 1 from public.profiles
                      where id = (v_override ->> 'approver_id')::uuid and tenant_id = p_tenant_id
                        and role in ('owner', 'manager') and deactivated_at is null)
    then
      raise exception 'forbidden';
    end if;
    if coalesce(btrim(v_override ->> 'reason'), '') = '' then
      raise exception 'reason_required';
    end if;
    v_charged := (v_override ->> 'charged_total')::numeric;
    if v_charged is null then
      raise exception 'invalid_offline';
    end if;
  end if;

  if p_client_ref is null then
    raise exception 'invalid_client_ref';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || p_client_ref::text, 0));

  select o.id, o.order_number, o.queue_number, o.cash_received, o.change_amount
    into v_existing
    from public.orders o
   where o.tenant_id = p_tenant_id and o.client_ref = p_client_ref;
  if found then
    return query select v_existing.id, v_existing.order_number, v_existing.queue_number,
      v_existing.cash_received, v_existing.change_amount, false;
    return;
  end if;

  if p_held_bill_id is not null then
    select h.id, h.queue_number, h.status, h.version
      into v_held
      from public.held_bills h
     where h.id = p_held_bill_id and h.tenant_id = p_tenant_id
       for update;
    v_held_found := found;
    if v_override is null then
      if not v_held_found or v_held.status <> 'open'
         or v_held.version is distinct from p_held_bill_version then
        raise exception 'held_bill_stale';
      end if;
    elsif not v_held_found or v_held.status <> 'open' then
      -- Recorded as charged on its own: the held bill was paid or cancelled meanwhile.
      v_held_id := null;
      if v_device_queue is null or v_device_queue < 1 then
        raise exception 'invalid_offline';
      end if;
    end if;
  end if;

  if not v_offline then
    select s.id into v_shift_id
      from public.shifts s
     where s.tenant_id = p_tenant_id and s.status = 'open'
       for share;
  elsif v_override is not null and p_order ->> 'payment_method' = 'cash' then
    select s.id into v_shift_id
      from public.shifts s
     where s.tenant_id = p_tenant_id and s.status = 'open'
       for share;
    if v_shift_id is null then
      raise exception 'no_open_shift';
    end if;
  else
    select s.id into v_shift_id
      from public.shifts s
     where s.id = (p_offline ->> 'shift_id')::uuid
       and s.tenant_id = p_tenant_id and s.status = 'open'
       for share;
    if v_shift_id is null and p_order ->> 'payment_method' = 'cash' then
      raise exception 'offline_shift_closed';
    end if;
  end if;

  if v_offline then
    v_created := case when v_sold_at > now() + interval '5 minutes' then now() else v_sold_at end;
  else
    v_created := now();
  end if;

  v_number := public.generate_order_number(p_tenant_id);
  if v_held_id is not null then
    v_queue := v_held.queue_number;
  elsif v_offline then
    v_queue := v_device_queue;
    insert into public.tenant_queue_counters as c (tenant_id, business_date, last_number)
    values (p_tenant_id, (v_created at time zone 'Asia/Bangkok')::date, v_queue)
    on conflict (tenant_id, business_date)
    do update set last_number = greatest(c.last_number, excluded.last_number);
  else
    v_queue := public.next_queue_number(p_tenant_id);
  end if;

  -- Bags on the bill (decision D2-1): a whole number 0..99. Absent (the D1 app) or anything else
  -- is 0: a sale is never refused over its bag count.
  if jsonb_typeof(p_order -> 'bags') = 'number' then
    v_bags := (p_order ->> 'bags')::numeric;
  end if;
  if v_bags is null or v_bags <> trunc(v_bags) or v_bags < 0 or v_bags > 99 then
    v_bags := 0;
  end if;

  insert into public.orders (
    tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total,
    cash_received, change_amount, discount_type, discount_value, discount_amount,
    discount_reason, discount_approved_by, customer_id, note, order_number, queue_number,
    shift_id, held_bill_id, created_at, sold_offline, bags
  )
  values (
    p_tenant_id, p_actor_id, p_client_ref,
    p_order ->> 'payment_method',
    p_order ->> 'order_type',
    (p_order ->> 'subtotal')::numeric,
    (p_order ->> 'total')::numeric,
    (p_order ->> 'cash_received')::numeric,
    (p_order ->> 'change_amount')::numeric,
    p_order ->> 'discount_type',
    (p_order ->> 'discount_value')::numeric,
    coalesce((p_order ->> 'discount_amount')::numeric, 0),
    p_order ->> 'discount_reason',
    (p_order ->> 'discount_approved_by')::uuid,
    (p_order ->> 'customer_id')::uuid,
    p_order ->> 'note',
    v_number, v_queue, v_shift_id, v_held_id, v_created, v_offline, v_bags::int
  )
  returning id, cash_received, change_amount into v_order;

  -- Items one by one (to keep each id), collecting their usable stock lines.
  for v_item in select i.value from jsonb_array_elements(p_items) as i loop
    insert into public.order_items (
      order_id, product_id, product_name, unit_price, quantity, subtotal, category_name,
      modifiers_snapshot, note, choices
    )
    values (
      v_order.id,
      (v_item ->> 'product_id')::uuid,
      v_item ->> 'product_name',
      (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'quantity')::int,
      (v_item ->> 'subtotal')::numeric,
      v_item ->> 'category_name',
      case when jsonb_typeof(v_item -> 'modifiers_snapshot') = 'array' then v_item -> 'modifiers_snapshot' end,
      v_item ->> 'note',
      nullif(v_item -> 'choices', 'null'::jsonb)
    )
    returning id into v_item_id;

    if jsonb_typeof(v_item -> 'stock') = 'array' then
      for v_line in select s.value from jsonb_array_elements(v_item -> 'stock') as s loop
        -- A line that is not usable is skipped, never raised: a sale is never refused for stock.
        if jsonb_typeof(v_line) = 'object'
           and jsonb_typeof(v_line -> 'qty') = 'number'
           and (v_line ->> 'material_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then
          v_qty := round((v_line ->> 'qty')::numeric, 3);
          if v_qty > 0 and v_qty < 1000000 then
            v_lines := v_lines || jsonb_build_array(jsonb_build_object(
              'item', v_item_id, 'mat', v_line ->> 'material_id', 'qty', v_qty));
          end if;
        end if;
      end loop;
    end if;
  end loop;

  -- Bill-level stock lines (bags, decision D2-1), the same checks as the item lines above. Kept with
  -- item = null: the block below locks them with the items' materials and writes one 'sale' row per
  -- material with order_item_id null (the aggregation is what the bill-level unique index needs).
  if jsonb_typeof(p_order -> 'stock') = 'array' then
    for v_line in select s.value from jsonb_array_elements(p_order -> 'stock') as s loop
      -- A line that is not usable is skipped, never raised: a sale is never refused for stock.
      if jsonb_typeof(v_line) = 'object'
         and jsonb_typeof(v_line -> 'qty') = 'number'
         and (v_line ->> 'material_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        v_qty := round((v_line ->> 'qty')::numeric, 3);
        if v_qty > 0 and v_qty < 1000000 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object(
            'item', null, 'mat', v_line ->> 'material_id', 'qty', v_qty));
        end if;
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_lines) > 0 then
   -- Never refuse a sale because of stock: any error in this block (e.g. numeric overflow of a
   -- balance nobody restocks) rolls back to this savepoint only. The bill stays and its items keep
   -- cost_total null, which the owner later sees as "missing cost".
   begin
    -- Lock every material of the bill in id order before touching any of them. ORDER BY under
    -- FOR UPDATE locks rows in sorted order, so concurrent bills sharing materials queue up
    -- instead of deadlocking, and each one reads the other's committed balance (no lost update).
    -- The locked ids are kept: the statement below uses exactly that set.
    select array_agg(s.id) into v_locked
      from (select rm.id
              from public.raw_materials rm
             where rm.tenant_id = p_tenant_id
               and rm.archived_at is null
               and rm.id in (select (l ->> 'mat')::uuid from jsonb_array_elements(v_lines) as l)
             order by rm.id
               for update) s;

    -- One statement (fresh snapshot, after the locks): aggregate per (item, material), write one
    -- 'sale' row per tracked material, move the balances, freeze each item's cost.
    -- Bill-level lines (item null) group to one row per material and match no order item's cost.
    with agg as (
      select (l ->> 'item')::uuid as item_id, (l ->> 'mat')::uuid as mat_id,
             sum((l ->> 'qty')::numeric) as qty
        from jsonb_array_elements(v_lines) as l
       group by 1, 2
    ),
    valid as (
      select a.item_id, a.mat_id, a.qty, rm.cost_per_unit, rm.track_stock
        from agg a
        join public.raw_materials rm on rm.id = a.mat_id
       where a.mat_id = any(v_locked)
    ),
    led as (
      insert into public.inventory_transactions
        (tenant_id, raw_material_id, type, quantity, unit_cost, order_id, order_item_id,
         occurred_at, created_by)
      select p_tenant_id, v.mat_id, 'sale', -v.qty, v.cost_per_unit, v_order.id, v.item_id,
             v_created, p_actor_id
        from valid v
       where v.track_stock
      returning 1
    ),
    stk as (
      update public.raw_materials rm
         set current_stock = rm.current_stock - s.qty, updated_at = now()
        from (select v.mat_id, sum(v.qty) as qty from valid v where v.track_stock group by v.mat_id) s
       where rm.id = s.mat_id
      returning 1
    )
    update public.order_items oi
       set cost_total = round(c.total, 4)
      from (select v.item_id, sum(v.qty * v.cost_per_unit) as total from valid v group by v.item_id) c
     where oi.id = c.item_id;
   exception when others then
     raise warning 'order_record stock skipped: % %', sqlstate, sqlerrm;
     -- R28: leave the owner a "stock skipped" flag for this bill. Its own block, so the flag can
     -- never raise either (sqlstate / sqlerrm here are still the handler's: the inner block
     -- declares its own only for its own handler).
     begin
       insert into public.stock_flags (tenant_id, kind, order_id, business_date, detail, created_by)
       values (p_tenant_id, 'stock_skipped', v_order.id, (now() at time zone 'Asia/Bangkok')::date,
               sqlstate || ' ' || left(sqlerrm, 200), p_actor_id);
     exception when others then
       null;
     end;
   end;
  end if;

  if v_held_id is not null then
    update public.held_bills
       set status = 'paid', updated_by = p_actor_id, updated_at = now()
     where id = v_held_id;
    if jsonb_array_length(coalesce(p_held_reductions, '[]')) > 0 then
      insert into public.held_bill_events (held_bill_id, tenant_id, actor_id, event_type, detail)
      values (v_held_id, p_tenant_id, p_actor_id, 'items_reduced',
              jsonb_build_object('reductions', p_held_reductions, 'at_payment', true));
    end if;
    insert into public.held_bill_events (held_bill_id, tenant_id, actor_id, event_type, detail)
    values (v_held_id, p_tenant_id, p_actor_id, 'paid',
            jsonb_build_object('order_id', v_order.id, 'order_number', v_number,
                               'total', (p_order ->> 'total')::numeric));
  end if;

  if v_override is not null then
    insert into public.order_adjustments
      (tenant_id, order_id, kind, from_value, to_value, reason, actor_id, approver_id)
    values
      (p_tenant_id, v_order.id, 'offline_override',
       coalesce((v_override ->> 'server_total')::numeric::text, '-'),
       v_charged::text,
       btrim(v_override ->> 'reason'),
       p_actor_id,
       (v_override ->> 'approver_id')::uuid);
  end if;

  return query select v_order.id, v_number, v_queue, v_order.cash_received, v_order.change_amount, true;
end;
$$;

revoke all on function public.order_record(uuid, uuid, uuid, jsonb, jsonb, uuid, int, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.order_record(uuid, uuid, uuid, jsonb, jsonb, uuid, int, jsonb, jsonb)
  to service_role;

-- p_made: { "<order_item_id>": "all" | "none" | <integer cups made, 0..quantity> } for EVERY item
-- (unchanged). Bill-level stock goes back whatever the answers.
create or replace function public.order_void(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_approver_id uuid,
  p_order_id uuid,
  p_reason text,
  p_made jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_item record;
  v_sale record;
  v_made integer;
  v_val jsonb;
  v_restock numeric;
  v_ok boolean;
begin
  if not exists (select 1 from public.profiles p
                  where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.profiles p
                  where p.id = p_approver_id and p.tenant_id = p_tenant_id and p.deactivated_at is null
                    and p.role in ('owner', 'manager')) then
    raise exception 'forbidden';
  end if;
  if v_reason = '' or char_length(v_reason) > 500 then
    raise exception 'reason_required';
  end if;

  -- Same columns voidOrder wrote. Zero rows = already cancelled / refunded / unknown: nothing
  -- else happens, so a second call restocks nothing.
  update public.orders
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = p_actor_id,
         cancelled_approved_by = p_approver_id,
         cancel_reason = v_reason
   where id = p_order_id and tenant_id = p_tenant_id and status = 'completed';
  if not found then
    raise exception 'not_completed';
  end if;

  if p_made is null or jsonb_typeof(p_made) <> 'object' then
    raise exception 'invalid_made';
  end if;

  -- Every item needs an explicit answer; never default to "none". Any raise rolls the update back.
  for v_item in
    select oi.id, oi.quantity from public.order_items oi where oi.order_id = p_order_id
  loop
    v_val := p_made -> v_item.id::text;
    -- CASE keeps the numeric cast from running on a non-number.
    v_ok := case
      when v_val is null then false
      when v_val in ('"all"'::jsonb, '"none"'::jsonb) then true
      when jsonb_typeof(v_val) = 'number' then
        (v_val #>> '{}')::numeric = trunc((v_val #>> '{}')::numeric)
        and (v_val #>> '{}')::numeric between 0 and v_item.quantity
      else false
    end;
    if not v_ok then
      raise exception 'invalid_made';
    end if;
  end loop;

  -- Lock every material the order drew, in id order (same order as the other stock functions).
  perform 1 from public.raw_materials rm
   where rm.tenant_id = p_tenant_id
     and rm.id in (select t.raw_material_id from public.inventory_transactions t
                    where t.order_id = p_order_id and t.type = 'sale' and not t.legacy)
   order by rm.id
     for update;

  for v_item in
    select oi.id, oi.quantity from public.order_items oi where oi.order_id = p_order_id order by oi.id
  loop
    v_val := p_made -> v_item.id::text;
    v_made := case when v_val = '"all"'::jsonb then v_item.quantity
                   when v_val = '"none"'::jsonb then 0
                   else (v_val #>> '{}')::numeric::integer end;

    if v_made > 0 then
      update public.order_items set void_made = true where id = v_item.id;
    end if;

    if v_made >= v_item.quantity then
      continue;  -- every cup was made: nothing goes back on the shelf
    end if;

    -- A material archived since the sale is restocked too (the sale deducted it); only a material
    -- that no longer exists is skipped.
    for v_sale in
      select t.raw_material_id, t.quantity, t.unit_cost
        from public.inventory_transactions t
        join public.raw_materials rm on rm.id = t.raw_material_id and rm.tenant_id = p_tenant_id
       where t.order_item_id = v_item.id and t.type = 'sale' and not t.legacy
       order by t.raw_material_id
    loop
      v_restock := round(-v_sale.quantity * (v_item.quantity - v_made) / v_item.quantity, 3);
      if v_restock <= 0 then
        continue;
      end if;
      insert into public.inventory_transactions
        (tenant_id, raw_material_id, type, quantity, unit_cost, order_id, order_item_id,
         occurred_at, created_by)
      values (p_tenant_id, v_sale.raw_material_id, 'void_restock', v_restock, v_sale.unit_cost,
              p_order_id, v_item.id, now(), p_actor_id);
      update public.raw_materials
         set current_stock = current_stock + v_restock, updated_at = now()
       where id = v_sale.raw_material_id;
    end loop;
  end loop;

  -- Bill-level stock (bags, decision D2-1) always goes back on the shelf, whatever was made: from
  -- the bill's own 'sale' rows (order_item_id null), never from orders.bags (ruling R-D2a-5). Their
  -- materials are in the lock above (it reads every 'sale' row of the order).
  for v_sale in
    select t.raw_material_id, t.quantity, t.unit_cost
      from public.inventory_transactions t
      join public.raw_materials rm on rm.id = t.raw_material_id and rm.tenant_id = p_tenant_id
     where t.order_id = p_order_id and t.order_item_id is null and t.type = 'sale' and not t.legacy
     order by t.raw_material_id
  loop
    v_restock := -v_sale.quantity;
    if v_restock <= 0 then
      continue;
    end if;
    insert into public.inventory_transactions
      (tenant_id, raw_material_id, type, quantity, unit_cost, order_id, order_item_id,
       occurred_at, created_by)
    values (p_tenant_id, v_sale.raw_material_id, 'void_restock', v_restock, v_sale.unit_cost,
            p_order_id, null, now(), p_actor_id);
    update public.raw_materials
       set current_stock = current_stock + v_restock, updated_at = now()
     where id = v_sale.raw_material_id;
  end loop;
end;
$$;

revoke all on function public.order_void(uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.order_void(uuid, uuid, uuid, uuid, text, jsonb) to service_role;
