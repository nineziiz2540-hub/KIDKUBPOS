-- Round C2 fix (ruling R25): "record as charged" (override) and a held bill.
--
-- A held bill paid offline can reach manager review and be recorded as charged. Without this
-- change order_record raised held_bill_stale whenever the held bill's version had moved, so the
-- app used to record the bill without the held bill — which left a still-open held bill on the
-- server to be resumed and paid a second time.
--
-- Only the held-bill check changes, and only under override:
--   * the held bill is locked FOR UPDATE as before;
--   * still open → linked and closed exactly as the normal path does (queue number, status paid,
--     held_bill_events), a version mismatch is ignored (the manager approved recording it as
--     charged);
--   * not found / no longer open (paid, cancelled) → recorded as a standalone bill with the
--     device's queue number, nothing raised, nothing linked.
-- Without override the check is unchanged (held_bill_stale). Same signature, so no overload; the
-- grants are re-issued. Safe to apply while the deployed app still calls order_create only.

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

  insert into public.orders (
    tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total,
    cash_received, change_amount, discount_type, discount_value, discount_amount,
    discount_reason, discount_approved_by, customer_id, note, order_number, queue_number,
    shift_id, held_bill_id, created_at, sold_offline
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
    v_number, v_queue, v_shift_id, v_held_id, v_created, v_offline
  )
  returning id, cash_received, change_amount into v_order;

  insert into public.order_items (
    order_id, product_id, product_name, unit_price, quantity, subtotal, category_name,
    modifiers_snapshot, note
  )
  select v_order.id,
         (i ->> 'product_id')::uuid,
         i ->> 'product_name',
         (i ->> 'unit_price')::numeric,
         (i ->> 'quantity')::int,
         (i ->> 'subtotal')::numeric,
         i ->> 'category_name',
         case when jsonb_typeof(i -> 'modifiers_snapshot') = 'array' then i -> 'modifiers_snapshot' end,
         i ->> 'note'
    from jsonb_array_elements(p_items) as i;

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
