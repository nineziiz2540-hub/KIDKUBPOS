-- Round C1 (reliable payments): one-transaction, idempotent bill write.
--
-- createOrder used to write a bill in ~8 separate round trips (order number, queue number, order
-- row, item rows with a hand-written rollback, held-bill close-out). A dropped connection left the
-- outcome unknown, and paying again recorded the sale twice. order_create does every write in one
-- transaction, keyed by a client-generated id (client_ref) per payment attempt: sending the same
-- client_ref again returns the bill that already exists instead of creating another.
--
-- Additive only, safe for the deployed code: it never sends client_ref (null never conflicts with
-- the partial unique index) and never calls order_create. No restrictive follow-up migration.

alter table public.orders add column client_ref uuid;

comment on column public.orders.client_ref is
  'Client-generated id of the payment attempt; a retry with the same id returns this order.';

create unique index orders_tenant_client_ref
  on public.orders (tenant_id, client_ref) where client_ref is not null;

-- Called only by the createOrder server action through the admin client, after it has re-priced
-- the cart, checked the discount (and its manager PIN) and the cash tendered. p_order and p_items
-- carry those server-computed values; this function owns everything that must be atomic:
--   * Two requests with the same client_ref (a double tap, a retry while the first is in flight)
--     queue on the advisory lock, so the second always sees the first one's bill.
--   * A replay returns the saved bill before any other check: by then its held bill is paid and
--     its shift may have closed, and neither may turn a successful sale into an error.
--   * The open shift is read FOR SHARE: a concurrent shift_close (FOR UPDATE) waits for this bill,
--     so a sale can no longer be refused with shift_closed because the shift closed between a
--     check and the insert. No open shift is fine for a transfer; guard_order_drawer refuses cash.
create or replace function public.order_create(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_client_ref uuid,
  p_order jsonb,
  p_items jsonb,
  p_held_bill_id uuid,
  p_held_bill_version int,
  p_held_reductions jsonb
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
  v_shift_id uuid;
  v_number text;
  v_queue int;
  v_order record;
begin
  perform public.shift_assert_actor(p_tenant_id, p_actor_id);
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
    if not found or v_held.status <> 'open' or v_held.version is distinct from p_held_bill_version then
      raise exception 'held_bill_stale';
    end if;
  end if;

  select s.id into v_shift_id
    from public.shifts s
   where s.tenant_id = p_tenant_id and s.status = 'open'
     for share;

  v_number := public.generate_order_number(p_tenant_id);
  if p_held_bill_id is not null then
    v_queue := v_held.queue_number;
  else
    v_queue := public.next_queue_number(p_tenant_id);
  end if;

  insert into public.orders (
    tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total,
    cash_received, change_amount, discount_type, discount_value, discount_amount,
    discount_reason, discount_approved_by, customer_id, note, order_number, queue_number,
    shift_id, held_bill_id
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
    v_number, v_queue, v_shift_id, p_held_bill_id
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

  if p_held_bill_id is not null then
    update public.held_bills
       set status = 'paid', updated_by = p_actor_id, updated_at = now()
     where id = p_held_bill_id;
    if jsonb_array_length(coalesce(p_held_reductions, '[]')) > 0 then
      insert into public.held_bill_events (held_bill_id, tenant_id, actor_id, event_type, detail)
      values (p_held_bill_id, p_tenant_id, p_actor_id, 'items_reduced',
              jsonb_build_object('reductions', p_held_reductions, 'at_payment', true));
    end if;
    insert into public.held_bill_events (held_bill_id, tenant_id, actor_id, event_type, detail)
    values (p_held_bill_id, p_tenant_id, p_actor_id, 'paid',
            jsonb_build_object('order_id', v_order.id, 'order_number', v_number,
                               'total', (p_order ->> 'total')::numeric));
  end if;

  return query select v_order.id, v_number, v_queue, v_order.cash_received, v_order.change_amount, true;
end;
$$;

revoke all on function public.order_create(uuid, uuid, uuid, jsonb, jsonb, uuid, int, jsonb)
  from public, anon, authenticated;
grant execute on function public.order_create(uuid, uuid, uuid, jsonb, jsonb, uuid, int, jsonb)
  to service_role;
