-- QR e-receipt, task 1 (spec 7.2, 7.3, 7.6, 7.9). Three additive objects:
--   * orders_client_ref_idx  — the public receipt link carries an order's client_ref as its token;
--     the existing orders_tenant_client_ref starts with tenant_id and cannot serve a lookup by
--     client_ref alone.
--   * tenants.logo_url       — the shop logo printed on the receipt (null = none). The check keeps
--     it inside the shop's own folder of the public product-images bucket. No grant/policy change:
--     tenants has table-level grants and the update policy "owners can update their tenant name"
--     already limits writes to the owner.
--   * receipt_get(p_token)   — the ONLY way a customer-facing page reads a bill. Service role only.
-- Additive; the deployed app neither reads logo_url nor calls receipt_get.
-- The whitelist of fields that may reach a customer lives in receipt_get: nothing else (notes,
-- reasons, customers, staff, costs, ids, client_ref) is ever selected into its result.

set local lock_timeout = '5s';

create index if not exists orders_client_ref_idx
  on public.orders (client_ref)
  where client_ref is not null;

alter table public.tenants add column if not exists logo_url text;

alter table public.tenants
  add constraint tenants_logo_url_own_folder
  check (
    logo_url is null
    or (char_length(logo_url) <= 500
        and logo_url like '%/storage/v1/object/public/product-images/' || id::text || '/logo-%')
  );

-- Returns null for a null token, an unknown token, or a token shared by more than one order
-- (any tenants). Otherwise the six base fields; a completed bill adds its lines and money.
create or replace function public.receipt_get(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  o record;
  v_shop_name text;
  v_logo text;
  v_out jsonb;
  v_items jsonb;
  v_cash boolean;
begin
  if p_token is null then
    return null;
  end if;

  select count(*) into v_count from public.orders where client_ref = p_token;
  if v_count <> 1 then
    return null;
  end if;

  select ord.order_number, ord.queue_number, ord.created_at, ord.status, ord.subtotal,
         ord.discount_amount, ord.total, ord.payment_method, ord.cash_received, ord.change_amount,
         ord.id
    into o
    from public.orders ord
   where ord.client_ref = p_token;

  select t.name, t.logo_url into v_shop_name, v_logo
    from public.tenants t
   where t.id = (select tenant_id from public.orders where id = o.id);

  v_out := jsonb_build_object(
    'shop_name', v_shop_name,
    'shop_logo_url', v_logo,
    'order_number', o.order_number,
    'queue_number', o.queue_number,
    'created_at', o.created_at,
    'status', o.status);

  if o.status = 'completed' then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'name', i.product_name,
               'quantity', i.quantity,
               'subtotal', i.subtotal,
               'choices', i.choices,
               'options', i.modifiers_snapshot)
             order by i.created_at, i.product_name, i.id), '[]'::jsonb)
      into v_items
      from public.order_items i
     where i.order_id = o.id;

    v_cash := o.payment_method = 'cash';
    v_out := v_out || jsonb_build_object(
      'items', v_items,
      'subtotal', o.subtotal,
      'discount_amount', o.discount_amount,
      'total', o.total,
      'payment_method', o.payment_method,
      'cash_received', case when v_cash then to_jsonb(o.cash_received) else 'null'::jsonb end,
      'change_amount', case when v_cash then to_jsonb(o.change_amount) else 'null'::jsonb end);
  end if;

  return v_out;
end;
$$;

revoke all on function public.receipt_get(uuid) from public, anon, authenticated;
grant execute on function public.receipt_get(uuid) to service_role;
