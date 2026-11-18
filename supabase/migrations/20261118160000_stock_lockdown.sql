-- Round D1, Task 9: security lockdown for stock and costs.
-- PHASE TWO — apply only after the D1 deploy is READY (the deployed pre-D1 app still writes stock and reads costs with the user client).
--
-- What it closes (live facts read 2026-11-18):
--   * raw_materials / inventory_transactions: policy tenant_isolation (ALL, tenant only) + full grants let any
--     Staff session rewrite cost_per_unit / current_stock or forge ledger rows through the Data API.
--   * order_items: policy order_items_insert lets any tenant member forge items (cost_total, choices).
--   * anon holds full table grants on all of these (RLS is the only wall).
--   * the six round-D config tables accept ids of OTHER tenants (WITH CHECK only looks at the row's tenant_id).
-- After this: writes to stock go through service-role functions / the admin client behind an owner/manager
-- check; cost columns are not selectable by authenticated or anon.

set local lock_timeout = '5s';

-- ── anon: nothing on stock, ledger, config tables, order_items ─────────────
revoke all on public.raw_materials, public.inventory_transactions, public.order_items,
              public.choice_groups, public.choice_group_members, public.sweetness_levels,
              public.sweetness_amounts, public.product_sweetness, public.modifier_option_effects
  from anon;

-- ── authenticated: no writes to stock or the ledger ────────────────────────
revoke insert, update, delete, truncate, references, trigger
  on public.raw_materials, public.inventory_transactions from authenticated;

-- ── authenticated: no cost columns (table-level select replaced by a column list) ──
revoke select on public.raw_materials from authenticated;
grant select (id, tenant_id, name, unit, current_stock, min_stock_alert, created_at, updated_at,
              category, purchase_unit, purchase_size, track_stock, archived_at)
  on public.raw_materials to authenticated;

revoke select on public.inventory_transactions from authenticated;
grant select (id, tenant_id, raw_material_id, type, quantity, note, created_by, created_at,
              order_id, order_item_id, occurred_at, reason, legacy, ref_id)
  on public.inventory_transactions to authenticated;

-- ── order_items: written only by order_record (service role); cost_total hidden ──
drop policy if exists order_items_insert on public.order_items;
revoke insert, update, delete, truncate, references, trigger on public.order_items from authenticated;
revoke select on public.order_items from authenticated;
grant select (id, order_id, product_id, product_name, unit_price, quantity, subtotal, created_at,
              category_name, modifiers_snapshot, note, choices, void_made)
  on public.order_items to authenticated;

-- ── cross-tenant references ────────────────────────────────────────────────
-- SECURITY DEFINER so the lookup ignores RLS of the looked-up table (no policy recursion, 42P17).
-- Only called from policies of OTHER tables.
create or replace function public.row_in_tenant(p_table text, p_id uuid, p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_table
    when 'choice_groups'        then exists (select 1 from public.choice_groups        where id = p_id and tenant_id = p_tenant)
    when 'choice_group_members' then exists (select 1 from public.choice_group_members where id = p_id and tenant_id = p_tenant)
    when 'raw_materials'        then exists (select 1 from public.raw_materials        where id = p_id and tenant_id = p_tenant)
    when 'products'             then exists (select 1 from public.products             where id = p_id and tenant_id = p_tenant)
    when 'sweetness_levels'     then exists (select 1 from public.sweetness_levels     where id = p_id and tenant_id = p_tenant)
    when 'modifier_options'     then exists (select 1 from public.modifier_options mo
                                              join public.modifiers m on m.id = mo.modifier_id
                                             where mo.id = p_id and m.tenant_id = p_tenant)
    else false
  end;
$$;
revoke all on function public.row_in_tenant(text, uuid, uuid) from public, anon;
grant execute on function public.row_in_tenant(text, uuid, uuid) to authenticated, service_role;

-- Every referenced id of a row must belong to the row's tenant (null reference = no reference).
create or replace function public.config_refs_ok(p_table text, p_row jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (p_row->>'tenant_id') is not null
    and (
      case p_table
        when 'choice_group_members' then
          public.row_in_tenant('choice_groups', (p_row->>'group_id')::uuid, (p_row->>'tenant_id')::uuid)
          and public.row_in_tenant('raw_materials', (p_row->>'raw_material_id')::uuid, (p_row->>'tenant_id')::uuid)
        when 'sweetness_amounts' then
          ((p_row->>'product_id') is null
            or public.row_in_tenant('products', (p_row->>'product_id')::uuid, (p_row->>'tenant_id')::uuid))
          and public.row_in_tenant('choice_group_members', (p_row->>'member_id')::uuid, (p_row->>'tenant_id')::uuid)
          and public.row_in_tenant('sweetness_levels', (p_row->>'level_id')::uuid, (p_row->>'tenant_id')::uuid)
        when 'product_sweetness' then
          public.row_in_tenant('products', (p_row->>'product_id')::uuid, (p_row->>'tenant_id')::uuid)
          and public.row_in_tenant('choice_groups', (p_row->>'group_id')::uuid, (p_row->>'tenant_id')::uuid)
          and public.row_in_tenant('choice_group_members', (p_row->>'default_member_id')::uuid, (p_row->>'tenant_id')::uuid)
          and ((p_row->>'default_level_id') is null
            or public.row_in_tenant('sweetness_levels', (p_row->>'default_level_id')::uuid, (p_row->>'tenant_id')::uuid))
          and not exists (
            select 1 from jsonb_array_elements_text(coalesce(p_row->'allowed_member_ids', '[]'::jsonb)) a(id)
             where not public.row_in_tenant('choice_group_members', a.id::uuid, (p_row->>'tenant_id')::uuid))
        when 'modifier_option_effects' then
          public.row_in_tenant('modifier_options', (p_row->>'option_id')::uuid, (p_row->>'tenant_id')::uuid)
          and ((p_row->>'group_id') is null
            or public.row_in_tenant('choice_groups', (p_row->>'group_id')::uuid, (p_row->>'tenant_id')::uuid))
          and ((p_row->>'raw_material_id') is null
            or public.row_in_tenant('raw_materials', (p_row->>'raw_material_id')::uuid, (p_row->>'tenant_id')::uuid))
        when 'product_recipes' then
          public.row_in_tenant('products', (p_row->>'product_id')::uuid, (p_row->>'tenant_id')::uuid)
          and ((p_row->>'raw_material_id') is null
            or public.row_in_tenant('raw_materials', (p_row->>'raw_material_id')::uuid, (p_row->>'tenant_id')::uuid))
          and ((p_row->>'group_id') is null
            or public.row_in_tenant('choice_groups', (p_row->>'group_id')::uuid, (p_row->>'tenant_id')::uuid))
          and ((p_row->>'default_member_id') is null
            or public.row_in_tenant('choice_group_members', (p_row->>'default_member_id')::uuid, (p_row->>'tenant_id')::uuid))
        else true  -- choice_groups, sweetness_levels: no references besides the tenant
      end);
$$;
revoke all on function public.config_refs_ok(text, jsonb) from public, anon;
grant execute on function public.config_refs_ok(text, jsonb) to authenticated, service_role;

-- Recreate the write policies of the six config tables with the reference check.
do $$
declare t text;
begin
  foreach t in array array['choice_groups','choice_group_members','sweetness_levels',
                           'sweetness_amounts','product_sweetness','modifier_option_effects']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (tenant_id = public.auth_tenant_id() and public.auth_role() in (''owner'',''manager'') and public.config_refs_ok(%L, to_jsonb(%I)))',
                   t || '_insert', t, t, t);
    execute format('create policy %I on public.%I for update to authenticated using (tenant_id = public.auth_tenant_id() and public.auth_role() in (''owner'',''manager'')) with check (tenant_id = public.auth_tenant_id() and public.auth_role() in (''owner'',''manager'') and public.config_refs_ok(%L, to_jsonb(%I)))',
                   t || '_update', t, t, t);
  end loop;
end $$;

-- product_recipes: select policy stays; the write policy now checks the references too.
drop policy if exists product_recipes_write on public.product_recipes;
create policy product_recipes_write on public.product_recipes
  for all to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'))
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager')
              and public.config_refs_ok('product_recipes', to_jsonb(product_recipes)));
