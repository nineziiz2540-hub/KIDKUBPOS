-- restock_for_voided_order was callable by any authenticated user, on any order, with no state
-- check — a staff member could loop this RPC directly against the Data API to silently inflate
-- raw_materials.current_stock (concealing shrinkage/theft) while writing a plausible-looking
-- 'void_restock' inventory_transactions row each time. Revoke direct execute (voidOrder is being
-- switched to call this via the admin/service_role client, which is unaffected by these revokes)
-- and add an internal guard so even a service_role caller can't restock a non-cancelled order.
revoke execute on function public.restock_for_voided_order(uuid) from public;
revoke execute on function public.restock_for_voided_order(uuid) from anon;
revoke execute on function public.restock_for_voided_order(uuid) from authenticated;

create or replace function public.restock_for_voided_order(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  r record;
  tenant uuid;
  ord_status text;
begin
  select tenant_id, status into tenant, ord_status from orders where id = p_order_id;

  if tenant is null then
    raise exception 'Order not found: %', p_order_id;
  end if;

  if ord_status is distinct from 'cancelled' then
    raise exception 'Order % is not cancelled, refusing to restock', p_order_id;
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
