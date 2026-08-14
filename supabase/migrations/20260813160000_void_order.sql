alter table public.orders
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id),
  add column cancelled_approved_by uuid references public.profiles(id),
  add column cancel_reason text;

comment on column public.orders.cancelled_at is
  'Timestamp the order was voided. Null unless status = ''cancelled''.';
comment on column public.orders.cancelled_by is
  'Profile that tapped "ยกเลิกบิล" — the acting staff member (whoever getProfile() resolved to).';
comment on column public.orders.cancelled_approved_by is
  'Profile whose PIN matched during the void approval modal. Always role owner or manager.';
comment on column public.orders.cancel_reason is
  'Required free-text reason entered in the void modal.';

create or replace function public.restock_for_voided_order(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  r record;
  tenant uuid;
begin
  select tenant_id into tenant from orders where id = p_order_id;

  if tenant is null then
    raise exception 'Order not found: %', p_order_id;
  end if;

  for r in
    select
      oi.product_id,
      oi.quantity        as order_qty,
      pr.raw_material_id,
      pr.quantity_used
    from order_items oi
    join product_recipes pr
      on pr.product_id = oi.product_id
     and pr.tenant_id  = tenant
    where oi.order_id = p_order_id
  loop
    update raw_materials
    set
      current_stock = current_stock + (r.quantity_used * r.order_qty),
      updated_at    = now()
    where id = r.raw_material_id;

    insert into inventory_transactions
      (tenant_id, raw_material_id, type, quantity, note)
    values
      (tenant,
       r.raw_material_id,
       'void_restock',
       (r.quantity_used * r.order_qty),
       'Restock from voided order ' || p_order_id::text);
  end loop;
end;
$$;
