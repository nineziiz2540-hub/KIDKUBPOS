-- Round D1, Task 12: the menu editor saves bean/matcha slot lines and the menu's sweetness.
-- Same signatures (no overloads): create or replace replace_product_recipes(uuid, jsonb) and
-- save_menu(uuid, jsonb, jsonb, uuid[]); grants re-issued exactly as in 20261019120000 / 20261020120000.
-- Both stay SECURITY INVOKER (called with the user client), so RLS still applies on top.
-- New: save_option_effects(uuid, jsonb), same pattern (INVOKER, authenticated only), for "ผลต่อสต๊อก".
--
-- p_recipes[] rows:
--   { "line_kind": "fixed", "raw_material_id", "quantity_used" }
--   { "line_kind": "slot", "group_id", "quantity_used", "default_member_id" | null, "allow_special": bool }
--   A row without line_kind is a fixed row: the deployed pre-D1 editor keeps working unchanged.
-- p_menu.sweetness:
--   key absent = the menu's sweetness is left as it is (the deployed editor never sends it);
--   null       = the menu has no sweetness (its row and its own amounts are removed);
--   object     = { "group_id", "default_member_id", "allowed_member_ids": [], "default_level_id" | null,
--                  "use_custom": bool, "custom": [{ "member_id", "level_id", "amount" }] }
--                replaces the product_sweetness row and the menu's own sweetness_amounts rows.

-- ---------------------------------------------------------------------------
-- replace_product_recipes: fixed lines and slot lines
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
  v_kind text;
  v_qty numeric;
  v_group uuid;
  v_member uuid;
  v_groups uuid[] := '{}';
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
    v_kind := coalesce(v_row->>'line_kind', 'fixed');
    if v_kind = 'fixed' then
      if not exists (
        select 1 from raw_materials
         where id = (v_row->>'raw_material_id')::uuid and tenant_id = v_tenant
      ) then
        raise exception 'invalid_material';
      end if;
    elsif v_kind = 'slot' then
      v_group := (v_row->>'group_id')::uuid;
      -- A bean / matcha (or other) group of this shop; sweeteners belong to the menu's sweetness, not a line.
      if v_group is null or not exists (
        select 1 from choice_groups where id = v_group and tenant_id = v_tenant and kind <> 'sweetener'
      ) then
        raise exception 'invalid_group';
      end if;
      -- A menu has one line per choice group (also guarded by product_recipes_one_slot_per_group).
      if v_group = any(v_groups) then
        raise exception 'duplicate_slot_group';
      end if;
      v_groups := v_groups || v_group;
      v_member := nullif(v_row->>'default_member_id', '')::uuid;
      if v_member is not null and not exists (
        select 1 from choice_group_members
         where id = v_member and group_id = v_group and tenant_id = v_tenant
      ) then
        raise exception 'invalid_group_member';
      end if;
      if coalesce(jsonb_typeof(v_row->'allow_special'), 'null') not in ('boolean', 'null') then
        raise exception 'invalid_recipe_line';
      end if;
      -- A special default on a line that does not allow specials would never be used at the till.
      if v_member is not null and not coalesce((v_row->>'allow_special')::boolean, true) and exists (
        select 1 from choice_group_members where id = v_member and tier = 'special'
      ) then
        raise exception 'special_default_not_allowed';
      end if;
    else
      raise exception 'invalid_recipe_line';
    end if;
    v_qty := (v_row->>'quantity_used')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 or v_qty <> round(v_qty, 3) then
      raise exception 'invalid_quantity';
    end if;
  end loop;

  delete from product_recipes where product_id = p_product_id and tenant_id = v_tenant;

  -- Fixed lines: duplicate materials collapse to the last occurrence (as before).
  insert into product_recipes (tenant_id, product_id, line_kind, raw_material_id, quantity_used)
  select distinct on ((e.value->>'raw_material_id')::uuid)
         v_tenant, p_product_id, 'fixed', (e.value->>'raw_material_id')::uuid, (e.value->>'quantity_used')::numeric
    from jsonb_array_elements(p_rows) with ordinality as e(value, pos)
   where coalesce(e.value->>'line_kind', 'fixed') = 'fixed'
   order by (e.value->>'raw_material_id')::uuid, e.pos desc;

  -- Slot lines have no material of their own: they are never collapsed together
  -- (a second line for the same group was refused above).
  insert into product_recipes (tenant_id, product_id, line_kind, group_id, default_member_id, allow_special, quantity_used)
  select v_tenant, p_product_id, 'slot', (e.value->>'group_id')::uuid,
         nullif(e.value->>'default_member_id', '')::uuid,
         coalesce((e.value->>'allow_special')::boolean, true),
         (e.value->>'quantity_used')::numeric
    from jsonb_array_elements(p_rows) as e(value)
   where e.value->>'line_kind' = 'slot';
end;
$$;

-- ---------------------------------------------------------------------------
-- save_menu: product + recipe + modifier links + sweetness in one transaction
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
  v_sw jsonb;
  v_sw_group uuid;
  v_sw_member uuid;
  v_sw_allowed uuid[];
  v_sw_level uuid;
  v_sw_use_custom boolean;
  v_sw_custom jsonb;
  v_sw_members uuid[];
  v_c jsonb;
  v_c_member uuid;
  v_c_level uuid;
  v_c_amount numeric;
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

  -- Sweetness: key absent = untouched (the deployed editor); null = removed; object = replaced.
  if p_menu ? 'sweetness' then
    v_sw := p_menu->'sweetness';
    if jsonb_typeof(v_sw) not in ('object', 'null') then
      raise exception 'invalid_sweetness';
    end if;

    delete from sweetness_amounts where tenant_id = v_tenant and product_id = v_id;
    delete from product_sweetness where tenant_id = v_tenant and product_id = v_id;

    if jsonb_typeof(v_sw) = 'object' then
      if coalesce(jsonb_typeof(v_sw->'allowed_member_ids'), 'array') <> 'array'
         or coalesce(jsonb_typeof(v_sw->'custom'), 'array') <> 'array'
         or coalesce(jsonb_typeof(v_sw->'use_custom'), 'boolean') <> 'boolean' then
        raise exception 'invalid_sweetness';
      end if;

      -- The group is one of this shop's sweetener groups.
      v_sw_group := nullif(v_sw->>'group_id', '')::uuid;
      if v_sw_group is null or not exists (
        select 1 from choice_groups where id = v_sw_group and tenant_id = v_tenant and kind = 'sweetener'
      ) then
        raise exception 'invalid_sweetness';
      end if;

      -- The default and every allowed sweetener are members of that group.
      v_sw_member := nullif(v_sw->>'default_member_id', '')::uuid;
      if v_sw_member is null or not exists (
        select 1 from choice_group_members where id = v_sw_member and group_id = v_sw_group and tenant_id = v_tenant
      ) then
        raise exception 'invalid_sweetness';
      end if;
      select coalesce(array_agg(distinct a.x::uuid), '{}') into v_sw_allowed
        from jsonb_array_elements_text(coalesce(v_sw->'allowed_member_ids', '[]'::jsonb)) as a(x);
      if exists (
        select 1 from unnest(v_sw_allowed) as a(id)
         where not exists (select 1 from choice_group_members m
                            where m.id = a.id and m.group_id = v_sw_group and m.tenant_id = v_tenant)
      ) then
        raise exception 'invalid_sweetness';
      end if;

      -- The default level (optional) is one of this shop's levels.
      v_sw_level := nullif(v_sw->>'default_level_id', '')::uuid;
      if v_sw_level is not null
         and not exists (select 1 from sweetness_levels where id = v_sw_level and tenant_id = v_tenant) then
        raise exception 'invalid_sweetness';
      end if;

      v_sw_use_custom := coalesce((v_sw->>'use_custom')::boolean, false);
      v_sw_custom := coalesce(v_sw->'custom', '[]'::jsonb);
      v_sw_members := array(select distinct x from unnest(array[v_sw_member] || v_sw_allowed) as u(x));

      -- The menu's own amounts: only for the menu's sweeteners, levels of this shop, 0..10,000 with up to
      -- 3 decimals, one amount per (sweetener, level).
      for v_c in select * from jsonb_array_elements(v_sw_custom) loop
        v_c_member := nullif(v_c->>'member_id', '')::uuid;
        v_c_level := nullif(v_c->>'level_id', '')::uuid;
        v_c_amount := (v_c->>'amount')::numeric;
        if v_c_member is null or not (v_c_member = any(v_sw_members))
           or v_c_level is null
           or not exists (select 1 from sweetness_levels where id = v_c_level and tenant_id = v_tenant)
           or v_c_amount is null or v_c_amount < 0 or v_c_amount > 10000 or v_c_amount <> round(v_c_amount, 3) then
          raise exception 'invalid_sweetness';
        end if;
      end loop;
      if (select count(*) from jsonb_array_elements(v_sw_custom))
         <> (select count(distinct (c->>'member_id')::uuid::text || ':' || (c->>'level_id')::uuid::text)
               from jsonb_array_elements(v_sw_custom) as c) then
        raise exception 'invalid_sweetness';
      end if;
      -- "ใช้ปริมาณเฉพาะเมนูนี้" replaces the shop table for this menu, so it must cover every sweetener of
      -- the menu at every level (ไม่หวาน excepted), or that cup would silently deduct nothing.
      if v_sw_use_custom and exists (
        select 1 from unnest(v_sw_members) as m(id)
         cross join sweetness_levels l
         where l.tenant_id = v_tenant and not l.is_none
           and not exists (select 1 from jsonb_array_elements(v_sw_custom) as c
                            where (c->>'member_id')::uuid = m.id and (c->>'level_id')::uuid = l.id)
      ) then
        raise exception 'sweetness_table_incomplete';
      end if;

      insert into product_sweetness
        (product_id, tenant_id, group_id, default_member_id, allowed_member_ids, default_level_id, use_custom)
      values (v_id, v_tenant, v_sw_group, v_sw_member, v_sw_allowed, v_sw_level, v_sw_use_custom);

      -- The ไม่หวาน level is always 0, as in the shop table.
      insert into sweetness_amounts (tenant_id, product_id, member_id, level_id, amount)
      select v_tenant, v_id, (c->>'member_id')::uuid, l.id,
             case when l.is_none then 0 else (c->>'amount')::numeric end
        from jsonb_array_elements(v_sw_custom) as c
        join sweetness_levels l on l.id = (c->>'level_id')::uuid and l.tenant_id = v_tenant;
    end if;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_option_effects: "ผลต่อสต๊อก" of one modifier option, replaced as a set in one transaction
-- ---------------------------------------------------------------------------
-- p_effects[]: { "kind": "slot_add", "group_id", "amount" } | { "kind": "material_add", "raw_material_id", "amount" }
-- The option's modifier, every group (never the sweetener group) and every material (not archived) must
-- belong to the caller's shop. Amounts > 0, <= 100000, up to 3 decimals; one effect per target; <= 20.
create or replace function public.save_option_effects(p_option_id uuid, p_effects jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  v_e jsonb;
  v_kind text;
  v_group uuid;
  v_material uuid;
  v_amount numeric;
  v_key text;
  v_seen text[] := '{}';
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;

  if p_option_id is null or not exists (
    select 1 from modifier_options mo
      join modifiers m on m.id = mo.modifier_id
     where mo.id = p_option_id and m.tenant_id = v_tenant
  ) then
    raise exception 'option_not_found';
  end if;

  if jsonb_typeof(p_effects) is distinct from 'array' then
    raise exception 'invalid_effect';
  end if;
  if jsonb_array_length(p_effects) > 20 then
    raise exception 'invalid_effect';
  end if;

  for v_e in select * from jsonb_array_elements(p_effects) loop
    v_kind := v_e->>'kind';
    v_amount := (v_e->>'amount')::numeric;
    if v_amount is null or v_amount <= 0 or v_amount > 100000 or v_amount <> round(v_amount, 3) then
      raise exception 'invalid_effect_amount';
    end if;
    if v_kind = 'slot_add' then
      v_group := nullif(v_e->>'group_id', '')::uuid;
      if v_group is null or not exists (
        select 1 from choice_groups where id = v_group and tenant_id = v_tenant and kind <> 'sweetener'
      ) then
        raise exception 'invalid_group';
      end if;
      v_key := 'g:' || v_group::text;
    elsif v_kind = 'material_add' then
      v_material := nullif(v_e->>'raw_material_id', '')::uuid;
      if v_material is null or not exists (
        select 1 from raw_materials where id = v_material and tenant_id = v_tenant and archived_at is null
      ) then
        raise exception 'invalid_material';
      end if;
      v_key := 'm:' || v_material::text;
    else
      raise exception 'invalid_effect';
    end if;
    if v_key = any(v_seen) then
      raise exception 'duplicate_effect';
    end if;
    v_seen := v_seen || v_key;
  end loop;

  delete from modifier_option_effects where option_id = p_option_id and tenant_id = v_tenant;

  insert into modifier_option_effects (tenant_id, option_id, kind, group_id, raw_material_id, amount)
  select v_tenant, p_option_id, e.value->>'kind',
         case when e.value->>'kind' = 'slot_add' then (e.value->>'group_id')::uuid end,
         case when e.value->>'kind' = 'material_add' then (e.value->>'raw_material_id')::uuid end,
         (e.value->>'amount')::numeric
    from jsonb_array_elements(p_effects) as e(value);
end;
$$;

revoke execute on function public.replace_product_recipes(uuid, jsonb) from public, anon;
grant execute on function public.replace_product_recipes(uuid, jsonb) to authenticated;
revoke execute on function public.save_menu(uuid, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.save_menu(uuid, jsonb, jsonb, uuid[]) to authenticated;
revoke execute on function public.save_option_effects(uuid, jsonb) from public, anon;
grant execute on function public.save_option_effects(uuid, jsonb) to authenticated;
