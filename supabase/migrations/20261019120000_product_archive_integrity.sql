-- Products: archive instead of delete, bounded input, atomic recipe/modifier saves,
-- recipe writes and image storage scoped to the owning shop's owner/manager.

-- ---------------------------------------------------------------------------
-- Archive + CHECKs
-- ---------------------------------------------------------------------------
alter table public.products add column archived_at timestamptz;

-- An archived product is never sellable.
alter table public.products
  add constraint products_archived_inactive_check
    check (archived_at is null or is_active = false),
  add constraint products_price_range_check
    check (price >= 0 and price <= 100000 and price = round(price, 2)),
  add constraint products_name_length_check
    check (char_length(btrim(name)) between 1 and 100),
  add constraint products_description_length_check
    check (description is null or char_length(description) <= 500);

alter table public.product_recipes
  add constraint product_recipes_quantity_check
    check (quantity_used > 0 and quantity_used <= 100000);

-- ---------------------------------------------------------------------------
-- product_recipes: everyone in the shop reads (stock deduction reads recipes
-- as the cashier), only owner/manager write.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_isolation on public.product_recipes;

create policy product_recipes_select on public.product_recipes
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

create policy product_recipes_write on public.product_recipes
  for all to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'))
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'));

-- ---------------------------------------------------------------------------
-- Atomic replace RPCs (SECURITY INVOKER: RLS still applies on top)
-- ---------------------------------------------------------------------------
create or replace function public.replace_product_recipes(p_product_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  v_archived timestamptz;
  v_found boolean;
  v_row jsonb;
  v_qty numeric;
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;

  select true, archived_at into v_found, v_archived
    from products where id = p_product_id and tenant_id = v_tenant;
  if v_found is null then
    raise exception 'product_not_found';
  end if;
  if v_archived is not null then
    raise exception 'product_archived';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_quantity';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if not exists (
      select 1 from raw_materials
       where id = (v_row->>'raw_material_id')::uuid and tenant_id = v_tenant
    ) then
      raise exception 'invalid_material';
    end if;
    v_qty := (v_row->>'quantity_used')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 or v_qty <> round(v_qty, 3) then
      raise exception 'invalid_quantity';
    end if;
  end loop;

  delete from product_recipes where product_id = p_product_id and tenant_id = v_tenant;

  -- Duplicate materials collapse to the last occurrence.
  insert into product_recipes (tenant_id, product_id, raw_material_id, quantity_used)
  select distinct on (e.value->>'raw_material_id')
         v_tenant, p_product_id, (e.value->>'raw_material_id')::uuid, (e.value->>'quantity_used')::numeric
    from jsonb_array_elements(p_rows) with ordinality as e(value, pos)
   order by e.value->>'raw_material_id', e.pos desc;
end;
$$;

create or replace function public.replace_product_modifiers(p_product_id uuid, p_modifier_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  v_archived timestamptz;
  v_found boolean;
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;

  select true, archived_at into v_found, v_archived
    from products where id = p_product_id and tenant_id = v_tenant;
  if v_found is null then
    raise exception 'product_not_found';
  end if;
  if v_archived is not null then
    raise exception 'product_archived';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_modifier_ids, '{}')) as m(id)
     where not exists (select 1 from modifiers where modifiers.id = m.id and tenant_id = v_tenant)
  ) then
    raise exception 'invalid_modifier';
  end if;

  delete from product_modifiers where product_id = p_product_id and tenant_id = v_tenant;

  insert into product_modifiers (tenant_id, product_id, modifier_id)
  select distinct v_tenant, p_product_id, m.id
    from unnest(coalesce(p_modifier_ids, '{}')) as m(id);
end;
$$;

revoke execute on function public.replace_product_recipes(uuid, jsonb) from public, anon;
revoke execute on function public.replace_product_modifiers(uuid, uuid[]) from public, anon;
grant execute on function public.replace_product_recipes(uuid, jsonb) to authenticated;
grant execute on function public.replace_product_modifiers(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: product images live under <tenant_id>/ and only that shop's
-- owner/manager may write there. Reads stay public (public bucket).
-- ---------------------------------------------------------------------------
drop policy if exists authenticated_upload on storage.objects;
drop policy if exists authenticated_update on storage.objects;
drop policy if exists authenticated_delete on storage.objects;

-- Storage's remove() selects the object before deleting it, so the shop's
-- owner/manager also need to see their own folder through the API.
create policy product_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
    and public.auth_role() in ('owner', 'manager')
  );

create policy product_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
    and public.auth_role() in ('owner', 'manager')
  );

create policy product_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
    and public.auth_role() in ('owner', 'manager')
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
    and public.auth_role() in ('owner', 'manager')
  );

create policy product_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
    and public.auth_role() in ('owner', 'manager')
  );

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'product-images';
