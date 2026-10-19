-- Menu ordering: owner-controlled order of categories and menus, a single atomic save for the
-- menu editor, and owner/manager-only category writes.
--
-- The deployed app shares this database and still inserts categories/products without a
-- sort order (and moves products between categories), so the database — not app code —
-- decides "append to the end".

-- ---------------------------------------------------------------------------
-- sort_order columns + backfill
-- ---------------------------------------------------------------------------
alter table public.categories add column sort_order int;
alter table public.products add column sort_order int;

update public.categories c
   set sort_order = o.rn
  from (select id, row_number() over (partition by tenant_id order by name, id) as rn
          from public.categories) o
 where o.id = c.id;

-- "เรียงตามการเพิ่ม": the order the menus were added in.
update public.products p
   set sort_order = o.rn
  from (select id, row_number() over (partition by tenant_id, category_id order by created_at, id) as rn
          from public.products) o
 where o.id = p.id;

alter table public.categories alter column sort_order set not null;
alter table public.products alter column sort_order set not null;

create index products_tenant_category_sort_idx on public.products (tenant_id, category_id, sort_order);
create index categories_tenant_sort_idx on public.categories (tenant_id, sort_order);

-- ---------------------------------------------------------------------------
-- Append-to-end triggers (NOT NULL is checked after BEFORE triggers run)
-- ---------------------------------------------------------------------------
create or replace function public.products_assign_sort_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.sort_order is null then
      select coalesce(max(sort_order), 0) + 1 into new.sort_order
        from products
       where tenant_id = new.tenant_id
         and category_id is not distinct from new.category_id;
    end if;
  elsif new.category_id is distinct from old.category_id
     or (old.archived_at is not null and new.archived_at is null) then
    -- Moved to another category (including ON DELETE SET NULL) or restored from the archive.
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
      from products
     where tenant_id = new.tenant_id
       and category_id is not distinct from new.category_id
       and id <> new.id;
  end if;
  return new;
end;
$$;

create trigger products_assign_sort_order
  before insert or update on public.products
  for each row execute function public.products_assign_sort_order();

create or replace function public.categories_assign_sort_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sort_order is null then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
      from categories
     where tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;

create trigger categories_assign_sort_order
  before insert on public.categories
  for each row execute function public.categories_assign_sort_order();

-- ---------------------------------------------------------------------------
-- categories: everyone in the shop reads, only owner/manager write
-- ---------------------------------------------------------------------------
drop policy if exists categories_select on public.categories;
drop policy if exists categories_insert on public.categories;
drop policy if exists categories_update on public.categories;
drop policy if exists categories_delete on public.categories;

create policy categories_select on public.categories
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

create policy categories_write on public.categories
  for all to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'))
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'));

alter table public.categories
  add constraint categories_name_length_check
    check (char_length(btrim(name)) between 1 and 50);

-- ---------------------------------------------------------------------------
-- Reorder RPCs: the id list must be exactly the current set, or nothing changes
-- ---------------------------------------------------------------------------
create or replace function public.reorder_categories(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  v_current uuid[];
  v_given uuid[];
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;
  if p_ids is null or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'stale_order';
  end if;

  select coalesce(array_agg(id order by id), '{}') into v_current
    from categories where tenant_id = v_tenant;
  select coalesce(array_agg(x order by x), '{}') into v_given from unnest(p_ids) x;
  if v_current <> v_given then
    raise exception 'stale_order';
  end if;

  update categories c
     set sort_order = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where c.id = o.id and c.tenant_id = v_tenant;
end;
$$;

create or replace function public.reorder_products(p_category_id uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  v_current uuid[];
  v_given uuid[];
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;
  if p_ids is null or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'stale_order';
  end if;

  -- Closed (is_active = false) menus are part of the set; archived ones are not.
  select coalesce(array_agg(id order by id), '{}') into v_current
    from products
   where tenant_id = v_tenant
     and category_id is not distinct from p_category_id
     and archived_at is null;
  select coalesce(array_agg(x order by x), '{}') into v_given from unnest(p_ids) x;
  if v_current <> v_given then
    raise exception 'stale_order';
  end if;

  update products p
     set sort_order = o.ord::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where p.id = o.id and p.tenant_id = v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_menu: product + recipe + modifier links in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.save_menu(
  p_id uuid,
  p_menu jsonb,
  p_recipes jsonb,
  p_modifier_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  v_id uuid;
  v_category uuid := nullif(p_menu->>'category_id', '')::uuid;
  v_archived timestamptz;
  v_found boolean;
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;

  if v_category is not null
     and not exists (select 1 from categories where id = v_category and tenant_id = v_tenant) then
    raise exception 'invalid_category';
  end if;

  if p_id is null then
    insert into products (tenant_id, name, price, description, category_id, drink_type, is_active)
    values (
      v_tenant,
      btrim(p_menu->>'name'),
      (p_menu->>'price')::numeric,
      nullif(p_menu->>'description', ''),
      v_category,
      nullif(p_menu->>'drink_type', ''),
      coalesce((p_menu->>'is_active')::boolean, true)
    )
    returning id into v_id;
  else
    update products
       set name = btrim(p_menu->>'name'),
           price = (p_menu->>'price')::numeric,
           description = nullif(p_menu->>'description', ''),
           category_id = v_category,
           drink_type = nullif(p_menu->>'drink_type', ''),
           is_active = coalesce((p_menu->>'is_active')::boolean, true)
     where id = p_id and tenant_id = v_tenant and archived_at is null
    returning id into v_id;

    if v_id is null then
      select true, archived_at into v_found, v_archived
        from products where id = p_id and tenant_id = v_tenant;
      if v_found is null then
        raise exception 'product_not_found';
      end if;
      raise exception 'product_archived';
    end if;
  end if;

  -- Both validate tenant ownership and quantities, and raise (rolling everything back) on any problem.
  perform public.replace_product_recipes(v_id, coalesce(p_recipes, '[]'::jsonb));
  perform public.replace_product_modifiers(v_id, coalesce(p_modifier_ids, '{}'::uuid[]));

  return v_id;
end;
$$;

revoke execute on function public.reorder_categories(uuid[]) from public, anon;
revoke execute on function public.reorder_products(uuid, uuid[]) from public, anon;
revoke execute on function public.save_menu(uuid, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.reorder_categories(uuid[]) to authenticated;
grant execute on function public.reorder_products(uuid, uuid[]) to authenticated;
grant execute on function public.save_menu(uuid, jsonb, jsonb, uuid[]) to authenticated;

-- Trigger functions are not meant to be called over the API.
revoke execute on function public.products_assign_sort_order() from public, anon, authenticated;
revoke execute on function public.categories_assign_sort_order() from public, anon, authenticated;
