-- Round D2a, Task 8: the menu editor saves the menu's "ภาชนะ" (spec §6.7, §7.9).
-- Same signature (no overload): create or replace save_menu(uuid, jsonb, jsonb, uuid[]). Still SECURITY
-- INVOKER with search_path = public (called with the user client, so RLS applies on top); grants re-issued
-- exactly as in 20261118170000. The body is the live 20261118170000 body (md5 fad8f7da…, checked
-- 2026-11-20) plus the two packaging keys below; nothing else changes.
--
-- p_menu.packaging_set_id:
--   key absent  = the menu's set is left as it is (the deployed D1 editor never sends it; a new menu gets none);
--   null        = the menu has no set ("ไม่หักภาชนะ");
--   uuid        = one of the caller's shop's sets that is not archived, else 'packaging_set_not_found'
--                 (another shop's set, an unknown id and an archived set all read the same).
-- p_menu.house_glass_default ("ปกติเสิร์ฟแก้วร้าน"):
--   key absent  = left as it is (a new menu gets false); present = the boolean (null = false).
--
-- Archive race: the set row is locked FOR SHARE before archived_at is read. archive_packaging_set locks it
-- FOR UPDATE, so either the archive commits first (this save then reads archived_at and refuses) or it waits
-- until this save commits (it then sees this menu using the set: 'set_in_use').

set local lock_timeout = '5s';

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
  v_has_set boolean := coalesce(p_menu ? 'packaging_set_id', false);
  v_has_glass boolean := coalesce(p_menu ? 'house_glass_default', false);
  v_set uuid;
  v_set_found boolean;
  v_set_archived timestamptz;
  v_glass boolean;
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

  -- Packaging: key absent = untouched (the deployed D1 editor); null = no set; uuid = a live set of this shop.
  if v_has_set then
    v_set := nullif(p_menu->>'packaging_set_id', '')::uuid;
    if v_set is not null then
      select true, s.archived_at into v_set_found, v_set_archived
        from packaging_sets s
       where s.id = v_set and s.tenant_id = v_tenant
         for share;
      if v_set_found is null or v_set_archived is not null then
        raise exception 'packaging_set_not_found';
      end if;
    end if;
  end if;
  if v_has_glass then
    v_glass := coalesce((p_menu->>'house_glass_default')::boolean, false);
  end if;

  if p_id is null then
    insert into products (tenant_id, name, price, description, category_id, drink_type, is_active,
                          packaging_set_id, house_glass_default)
    values (
      v_tenant,
      btrim(p_menu->>'name'),
      (p_menu->>'price')::numeric,
      nullif(p_menu->>'description', ''),
      v_category,
      nullif(p_menu->>'drink_type', ''),
      coalesce((p_menu->>'is_active')::boolean, true),
      v_set,
      coalesce(v_glass, false)
    )
    returning id into v_id;
  else
    update products
       set name = btrim(p_menu->>'name'),
           price = (p_menu->>'price')::numeric,
           description = nullif(p_menu->>'description', ''),
           category_id = v_category,
           drink_type = nullif(p_menu->>'drink_type', ''),
           is_active = coalesce((p_menu->>'is_active')::boolean, true),
           packaging_set_id = case when v_has_set then v_set else packaging_set_id end,
           house_glass_default = case when v_has_glass then v_glass else house_glass_default end
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

revoke execute on function public.save_menu(uuid, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.save_menu(uuid, jsonb, jsonb, uuid[]) to authenticated;
