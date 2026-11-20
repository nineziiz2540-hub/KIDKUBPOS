-- Round D2a, Task 1: packaging sets, menu pause columns, bag settings, stock flags, FK indexes.
-- Additive; the deployed D1 app ignores every new column. Nothing is dropped or renamed. The one function
-- replaced (config_refs_ok) keeps its signature, and every existing case stays byte-identical.
--
-- What each object is for (spec §6.7 packaging, §7.6 close/open, §8 roles, §10 security):
--   * packaging_sets / packaging_set_items: the owner's "ชุดภาชนะ" (e.g. ชุดเย็น 16oz = แก้ว + ฝาโดม + หลอด).
--     A menu deducts its set once per cup, on every bill. An archived set frees its name.
--     Every member of the shop reads them (the POS resolves packaging). Owner/manager write them through the
--     user client; the reference check (config_refs_ok) keeps the set and the material in the caller's shop.
--   * products.packaging_set_id: the menu's default set (null = no packaging deduction).
--   * products.house_glass_default: the menu is normally served in a "แก้วร้าน" (no set deducted).
--   * products.paused_at / paused_by: "ปิดขายชั่วคราว". Written only by set_menu_paused (service role, Task 2);
--     the trigger prevent_direct_menu_pause refuses any user-client write to them.
--   * tenants.bag_material_id / bags_per_cups: the bag material and "1 ถุงต่อทุก ๆ N แก้ว" (null = 0 bags by default).
--   * orders.bags: the bill's bag count. Bags are bill-level stock (decision D2-1).
--   * stock_flags: "ยอดน่าจะผิด" for the owner. Two kinds:
--       - sold_while_out: at most one per material per business day
--       - stock_skipped: R28
--     Owner/manager read them. Nobody writes them through the Data API; the Task 2 / Task 3 functions do.
--   * inventory_transactions_one_per_bill_material_type: at most one bill-level sale row and one bill-level
--     void_restock row per bill and material (bill-level = order_item_id null, e.g. bags). The D1 index
--     inventory_transactions_one_per_item_material_type cannot see these rows: their order_item_id is null.
--   * config_refs_ok: gains the 'packaging_set_items' case (set and material in the caller's shop) and the
--     'packaging_sets' case (no references besides the tenant).
--   * btree indexes on foreign keys (below).
--
-- Performance advisor, unindexed_foreign_keys (get_advisors type performance, read 2026-11-20, 55 findings).
--   Indexed here: the tables round D1 created or extended (23):
--     choice_group_members:    raw_material_id, tenant_id
--     choice_groups:           tenant_id
--     inventory_transactions:  created_by, raw_material_id
--     modifier_option_effects: group_id, option_id, raw_material_id, tenant_id
--     order_items:             order_id, product_id
--     product_recipes:         default_member_id, group_id, raw_material_id, tenant_id
--     product_sweetness:       default_level_id, default_member_id, group_id, tenant_id
--     raw_materials:           tenant_id
--     sweetness_amounts:       level_id, member_id, product_id
--   Left as they are: not D1 tables (32):
--     cash_movements:    created_by, tenant_id
--     held_bill_events:  actor_id, tenant_id
--     held_bills:        cancelled_approved_by, cancelled_by, created_by, customer_id, updated_by
--     mfa_backup_codes:  profile_id
--     modifier_options:  modifier_id
--     modifiers:         tenant_id
--     order_adjustments: actor_id, approver_id
--     orders:            cancelled_approved_by, cancelled_by, created_by, customer_id, discount_approved_by,
--                        refunded_approved_by, refunded_by, transfer_verified_by, unpaid_approved_by, unpaid_by
--     product_modifiers: modifier_id, tenant_id
--     products:          category_id
--     shift_cash_counts: created_by, tenant_id
--     shifts:            closed_by, opened_by, previous_shift_id
--   Also indexed here: every foreign-key column of the new tables and of the new columns.
--   packaging_set_items.set_id is already covered by its unique (set_id, raw_material_id).

set local lock_timeout = '5s';

-- ── packaging sets ─────────────────────────────────────────────────────────
create table public.packaging_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  sort_order int not null default 0,
  archived_at timestamptz null,
  created_at timestamptz not null default now()
);
-- one live set per name in a shop, ignoring case and outer spaces; an archived set frees its name
create unique index packaging_sets_name_per_tenant
  on public.packaging_sets (tenant_id, lower(btrim(name))) where archived_at is null;

create table public.packaging_set_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  set_id uuid not null references public.packaging_sets(id) on delete cascade,
  raw_material_id uuid not null references public.raw_materials(id),
  qty numeric(12,3) not null check (qty > 0 and qty <= 1000),
  unique (set_id, raw_material_id)
);

-- ── products: packaging and pause ──────────────────────────────────────────
alter table public.products
  add column packaging_set_id uuid null references public.packaging_sets(id),  -- null = no packaging deduction
  add column house_glass_default boolean not null default false,
  add column paused_at timestamptz null,
  add column paused_by uuid null references public.profiles(id);

-- ── tenants: bag settings ──────────────────────────────────────────────────
alter table public.tenants
  add column bag_material_id uuid null references public.raw_materials(id),
  add column bags_per_cups int null check (bags_per_cups between 1 and 20);  -- null = 0 bags by default

-- ── orders: bags on the bill ───────────────────────────────────────────────
alter table public.orders
  add column bags int not null default 0 check (bags between 0 and 99);

-- ── stock flags ("ยอดน่าจะผิด") ─────────────────────────────────────────────
create table public.stock_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  kind text not null check (kind in ('sold_while_out','stock_skipped')),
  raw_material_id uuid null references public.raw_materials(id),
  product_id uuid null references public.products(id),
  order_id uuid null references public.orders(id),
  business_date date not null,
  detail text null check (char_length(detail) <= 300),
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references public.profiles(id)
);
create unique index stock_flags_one_sold_while_out_per_day
  on public.stock_flags (tenant_id, raw_material_id, business_date) where kind = 'sold_while_out';

-- ── ledger: bill-level stock rows (order_item_id null), once per bill, material and type ──
create unique index inventory_transactions_one_per_bill_material_type
  on public.inventory_transactions (order_id, raw_material_id, type)
  where order_item_id is null and type in ('sale','void_restock') and not legacy;

-- ── config_refs_ok: the lockdown body plus 'packaging_set_items' and 'packaging_sets' ──
-- Every referenced id of a row must belong to the row's tenant (null reference = no reference).
create or replace function public.config_refs_ok(p_table text, p_row jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((p_row->>'tenant_id')::uuid = public.auth_tenant_id(), false)
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
        when 'packaging_set_items' then
          exists (select 1 from public.packaging_sets s
                   where s.id = (p_row->>'set_id')::uuid and s.tenant_id = (p_row->>'tenant_id')::uuid)
          and public.row_in_tenant('raw_materials', (p_row->>'raw_material_id')::uuid, (p_row->>'tenant_id')::uuid)
        when 'choice_groups'    then true  -- no references besides the tenant
        when 'sweetness_levels' then true
        when 'packaging_sets'   then true
        else false  -- fail closed: an unknown table is never allowed
      end);
$$;
revoke all on function public.config_refs_ok(text, jsonb) from public, anon;
grant execute on function public.config_refs_ok(text, jsonb) to authenticated, service_role;

-- ── RLS: packaging sets and items ──────────────────────────────────────────
alter table public.packaging_sets enable row level security;
alter table public.packaging_set_items enable row level security;

create policy packaging_sets_select on public.packaging_sets
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());
create policy packaging_sets_insert on public.packaging_sets
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager')
              and public.config_refs_ok('packaging_sets', to_jsonb(packaging_sets)));
create policy packaging_sets_update on public.packaging_sets
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'))
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager')
              and public.config_refs_ok('packaging_sets', to_jsonb(packaging_sets)));
create policy packaging_sets_delete on public.packaging_sets
  for delete to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'));

create policy packaging_set_items_select on public.packaging_set_items
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());
create policy packaging_set_items_insert on public.packaging_set_items
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager')
              and public.config_refs_ok('packaging_set_items', to_jsonb(packaging_set_items)));
create policy packaging_set_items_update on public.packaging_set_items
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'))
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager')
              and public.config_refs_ok('packaging_set_items', to_jsonb(packaging_set_items)));
create policy packaging_set_items_delete on public.packaging_set_items
  for delete to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'));

-- ── RLS: stock flags (owner/manager read; no write policy at all) ───────────
alter table public.stock_flags enable row level security;

create policy stock_flags_select on public.stock_flags
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'));

-- ── grants: explicit, nothing to anon ──────────────────────────────────────
revoke all on public.packaging_sets, public.packaging_set_items, public.stock_flags from anon, authenticated;
grant select, insert, update, delete on public.packaging_sets, public.packaging_set_items to authenticated;
grant select on public.stock_flags to authenticated;
grant all on public.packaging_sets, public.packaging_set_items, public.stock_flags to service_role;

-- ── products: the pause columns are written only by the service role (set_menu_paused) ──
-- Same pattern as prevent_direct_held_bill_link: a user-client session (auth.uid() set) may not touch them.
create or replace function public.prevent_direct_menu_pause()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.paused_at is not null or new.paused_by is not null then
      raise exception 'Pausing a menu requires a service-role write';
    end if;
  elsif new.paused_at is distinct from old.paused_at or new.paused_by is distinct from old.paused_by then
    raise exception 'Pausing a menu requires a service-role write';
  end if;
  return new;
end;
$$;
create trigger prevent_direct_menu_pause_trigger
  before insert or update on public.products
  for each row execute function public.prevent_direct_menu_pause();

-- ── foreign-key indexes: the advisor's list on D1 tables ───────────────────
create index if not exists choice_group_members_raw_material_id_idx on public.choice_group_members (raw_material_id);
create index if not exists choice_group_members_tenant_id_idx       on public.choice_group_members (tenant_id);
create index if not exists choice_groups_tenant_id_idx              on public.choice_groups (tenant_id);
create index if not exists inventory_transactions_created_by_idx    on public.inventory_transactions (created_by);
create index if not exists inventory_transactions_raw_material_id_idx on public.inventory_transactions (raw_material_id);
create index if not exists modifier_option_effects_group_id_idx     on public.modifier_option_effects (group_id);
create index if not exists modifier_option_effects_option_id_idx    on public.modifier_option_effects (option_id);
create index if not exists modifier_option_effects_raw_material_id_idx on public.modifier_option_effects (raw_material_id);
create index if not exists modifier_option_effects_tenant_id_idx    on public.modifier_option_effects (tenant_id);
create index if not exists order_items_order_id_idx                 on public.order_items (order_id);
create index if not exists order_items_product_id_idx               on public.order_items (product_id);
create index if not exists product_recipes_default_member_id_idx    on public.product_recipes (default_member_id);
create index if not exists product_recipes_group_id_idx             on public.product_recipes (group_id);
create index if not exists product_recipes_raw_material_id_idx      on public.product_recipes (raw_material_id);
create index if not exists product_recipes_tenant_id_idx            on public.product_recipes (tenant_id);
create index if not exists product_sweetness_default_level_id_idx   on public.product_sweetness (default_level_id);
create index if not exists product_sweetness_default_member_id_idx  on public.product_sweetness (default_member_id);
create index if not exists product_sweetness_group_id_idx           on public.product_sweetness (group_id);
create index if not exists product_sweetness_tenant_id_idx          on public.product_sweetness (tenant_id);
create index if not exists raw_materials_tenant_id_idx              on public.raw_materials (tenant_id);
create index if not exists sweetness_amounts_level_id_idx           on public.sweetness_amounts (level_id);
create index if not exists sweetness_amounts_member_id_idx          on public.sweetness_amounts (member_id);
create index if not exists sweetness_amounts_product_id_idx         on public.sweetness_amounts (product_id);

-- ── foreign-key indexes: the new tables and the new columns ────────────────
create index packaging_sets_tenant_id_idx              on public.packaging_sets (tenant_id);
create index packaging_set_items_tenant_id_idx         on public.packaging_set_items (tenant_id);
create index packaging_set_items_raw_material_id_idx   on public.packaging_set_items (raw_material_id);
create index stock_flags_tenant_id_idx                 on public.stock_flags (tenant_id);
create index stock_flags_raw_material_id_idx           on public.stock_flags (raw_material_id);
create index stock_flags_product_id_idx                on public.stock_flags (product_id);
create index stock_flags_order_id_idx                  on public.stock_flags (order_id);
create index stock_flags_created_by_idx                on public.stock_flags (created_by);
create index stock_flags_resolved_by_idx               on public.stock_flags (resolved_by);
create index products_packaging_set_id_idx             on public.products (packaging_set_id);
create index products_paused_by_idx                    on public.products (paused_by);
create index tenants_bag_material_id_idx               on public.tenants (bag_material_id);
