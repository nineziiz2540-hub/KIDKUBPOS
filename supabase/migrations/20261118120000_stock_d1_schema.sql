-- Round D1, migration A: stock schema, ledger columns, opening rows, frozen old costs.
-- Additive only: the deployed app keeps working. The old inventory_transactions type check is
-- replaced by one that lets old rows through as 'legacy' and allows the new ledger types.

-- ── raw_materials ──────────────────────────────────────────────────────────
alter table public.raw_materials
  add column category text not null default 'วัตถุดิบทั่วไป',
  add column purchase_unit text null,
  add column purchase_size numeric(12,3) null check (purchase_size > 0),
  add column track_stock boolean not null default true,
  add column archived_at timestamptz null;

-- ── choice groups ──────────────────────────────────────────────────────────
create table public.choice_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  kind text not null check (kind in ('bean','matcha','sweetener','other')),
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create table public.choice_group_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  group_id uuid not null references public.choice_groups(id) on delete cascade,
  raw_material_id uuid not null references public.raw_materials(id),
  label text not null,
  tier text not null check (tier in ('house','special')),
  price_delta numeric(10,2) not null default 0 check (price_delta >= 0),
  is_default boolean not null default false,
  sort_order int not null default 0,
  unique (group_id, raw_material_id)
);
create unique index choice_group_members_one_default
  on public.choice_group_members (group_id) where is_default;

-- ── product_recipes: fixed lines and choice-group slot lines ───────────────
alter table public.product_recipes
  add column line_kind text not null default 'fixed' check (line_kind in ('fixed','slot')),
  add column group_id uuid null references public.choice_groups(id),
  add column default_member_id uuid null references public.choice_group_members(id) on delete set null,
  add column allow_special boolean not null default true;
alter table public.product_recipes alter column raw_material_id drop not null;
alter table public.product_recipes add constraint product_recipes_line_kind_shape check (
  (line_kind = 'fixed' and raw_material_id is not null and group_id is null)
  or (line_kind = 'slot' and group_id is not null and raw_material_id is null));
-- a menu has at most one slot line per choice group
create unique index product_recipes_one_slot_per_group
  on public.product_recipes (product_id, group_id) where line_kind = 'slot';

-- ── sweetness ──────────────────────────────────────────────────────────────
create table public.sweetness_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  is_none boolean not null default false,
  is_default boolean not null default false,
  sort_order int not null default 0
);
create unique index sweetness_levels_one_default
  on public.sweetness_levels (tenant_id) where is_default;

create table public.sweetness_amounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid null references public.products(id) on delete cascade,  -- null = the shop's standard table
  member_id uuid not null references public.choice_group_members(id) on delete cascade,
  level_id uuid not null references public.sweetness_levels(id) on delete cascade,
  amount numeric(12,3) not null check (amount >= 0),
  unique nulls not distinct (tenant_id, product_id, member_id, level_id)
);

create table public.product_sweetness (
  product_id uuid primary key references public.products(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  group_id uuid not null references public.choice_groups(id),
  default_member_id uuid not null references public.choice_group_members(id),
  allowed_member_ids uuid[] not null default '{}',
  default_level_id uuid null references public.sweetness_levels(id) on delete set null,
  use_custom boolean not null default false
);

-- ── modifier effects ───────────────────────────────────────────────────────
create table public.modifier_option_effects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  option_id uuid not null references public.modifier_options(id) on delete cascade,
  kind text not null check (kind in ('slot_add','material_add')),
  group_id uuid null references public.choice_groups(id),
  raw_material_id uuid null references public.raw_materials(id),
  amount numeric(12,3) not null check (amount > 0),
  check ((kind = 'slot_add' and group_id is not null and raw_material_id is null)
      or (kind = 'material_add' and raw_material_id is not null and group_id is null))
);

-- ── ledger columns ─────────────────────────────────────────────────────────
alter table public.inventory_transactions
  add column unit_cost numeric(14,6) null,
  add column order_id uuid null references public.orders(id),
  add column order_item_id uuid null references public.order_items(id),
  add column occurred_at timestamptz not null default now(),
  add column reason text null,
  add column legacy boolean not null default false,
  add column ref_id uuid null;  -- held bill / future count session

-- every row that exists right now is an old-style row; it keeps the time it was made
update public.inventory_transactions set legacy = true, occurred_at = coalesce(created_at, occurred_at);

alter table public.inventory_transactions drop constraint inventory_transactions_type_check;
-- 'deduct' stays allowed: the deployed pre-D1 app's deduct_stock_for_order writes non-legacy 'deduct' rows;
-- nothing writes it after Task 14 drops that function.
alter table public.inventory_transactions add constraint inventory_transactions_type_check
  check (legacy or type in ('opening','sale','void_restock','waste','receive','adjust','deduct'));

create unique index inventory_transactions_one_per_item_material_type
  on public.inventory_transactions (order_item_id, raw_material_id, type)
  where type in ('sale','void_restock') and not legacy;
create index inventory_transactions_material_time
  on public.inventory_transactions (tenant_id, raw_material_id, occurred_at);
create index inventory_transactions_order on public.inventory_transactions (order_id);
create index inventory_transactions_order_item on public.inventory_transactions (order_item_id);

-- ── order_items ────────────────────────────────────────────────────────────
alter table public.order_items
  add column cost_total numeric(12,4) null,
  add column choices jsonb null,
  add column void_made boolean null;

-- ── opening rows: one per material with non-zero stock, negative included (idempotent) ────────
insert into public.inventory_transactions
  (tenant_id, raw_material_id, type, quantity, unit_cost, note, occurred_at)
select rm.tenant_id, rm.id, 'opening', rm.current_stock, rm.cost_per_unit, 'ยอดตั้งต้นรอบ D', now()
from public.raw_materials rm
where rm.current_stock <> 0
  and not exists (select 1 from public.inventory_transactions t
                  where t.raw_material_id = rm.id and t.type = 'opening' and not t.legacy);

-- ── frozen old costs: null when the product has no recipe (idempotent) ─────
update public.order_items oi
set cost_total = r.unit_cost * oi.quantity
from (
  select pr.product_id, sum(pr.quantity_used * rm.cost_per_unit) as unit_cost
  from public.product_recipes pr
  join public.raw_materials rm on rm.id = pr.raw_material_id
  group by pr.product_id
) r
where r.product_id = oi.product_id and oi.cost_total is null;

-- ── RLS for the six new tables ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['choice_groups','choice_group_members','sweetness_levels',
                           'sweetness_amounts','product_sweetness','modifier_option_effects']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.auth_tenant_id())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (tenant_id = public.auth_tenant_id() and public.auth_role() in (''owner'',''manager''))',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update using (tenant_id = public.auth_tenant_id() and public.auth_role() in (''owner'',''manager'')) with check (tenant_id = public.auth_tenant_id() and public.auth_role() in (''owner'',''manager''))',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete using (tenant_id = public.auth_tenant_id() and public.auth_role() in (''owner'',''manager''))',
                   t || '_delete', t);
  end loop;
end $$;
