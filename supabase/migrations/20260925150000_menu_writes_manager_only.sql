-- Menu pricing tables accepted writes from ANY tenant member, including Staff, straight through the
-- Data API: products had tenant-only INSERT/UPDATE/DELETE policies, and modifiers /
-- modifier_options / product_modifiers had a single tenant-only FOR ALL policy. The app itself only
-- lets Owner/Manager edit the menu (every action in products.ts / modifiers.ts checks
-- isManagerOrOwner), so a Staff member could e.g. PATCH a latte to ฿1, ring up sales at that
-- price, and set it back. createOrder now re-prices every line from these tables, which only
-- helps if the tables themselves can't be rewritten by Staff — so writes are narrowed to
-- Owner/Manager here, matching the app. Reads stay open to the whole tenant (the POS needs them).
-- Uses the SECURITY DEFINER helpers auth_tenant_id()/auth_role() rather than subselecting
-- profiles, per the RLS-recursion lesson.

-- products ---------------------------------------------------------------------------------
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists products_delete on public.products;

create policy products_insert on public.products
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'));

create policy products_update on public.products
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'))
  with check (tenant_id = public.auth_tenant_id());

create policy products_delete on public.products
  for delete to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'));

-- modifiers --------------------------------------------------------------------------------
drop policy if exists tenant_isolation on public.modifiers;

create policy modifiers_select on public.modifiers
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

create policy modifiers_write on public.modifiers
  for all to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'))
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'));

-- modifier_options (no tenant_id column; scoped through its modifier) ------------------------
drop policy if exists tenant_isolation on public.modifier_options;

create policy modifier_options_select on public.modifier_options
  for select to authenticated
  using (modifier_id in (select id from public.modifiers where tenant_id = public.auth_tenant_id()));

create policy modifier_options_write on public.modifier_options
  for all to authenticated
  using (
    public.auth_role() in ('owner', 'manager')
    and modifier_id in (select id from public.modifiers where tenant_id = public.auth_tenant_id())
  )
  with check (
    public.auth_role() in ('owner', 'manager')
    and modifier_id in (select id from public.modifiers where tenant_id = public.auth_tenant_id())
  );

-- product_modifiers ------------------------------------------------------------------------
drop policy if exists tenant_isolation on public.product_modifiers;

create policy product_modifiers_select on public.product_modifiers
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

create policy product_modifiers_write on public.product_modifiers
  for all to authenticated
  using (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'))
  with check (tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner', 'manager'));
