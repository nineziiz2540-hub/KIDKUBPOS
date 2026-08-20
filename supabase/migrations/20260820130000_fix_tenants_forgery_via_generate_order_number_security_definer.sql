-- CRITICAL, live-exploit-confirmed fix: "tenant_members_can_update" granted ANY tenant member
-- (including Staff, the lowest-privilege role) unrestricted UPDATE on the entire tenants row —
-- including promptpay_id, fixed_cost_monthly, delivery_gp_percent, order_prefix — fields the app
-- layer (src/app/actions/settings.ts) already correctly gates to owner-only. Proven exploitable
-- live via a direct Data API PATCH using a real Staff session token: a disposable QA staff
-- account successfully rewrote the tenant's promptpay_id, fixed_cost_monthly, delivery_gp_percent,
-- and order_prefix with zero owner privileges, completely bypassing every app-level role check.
--
-- The policy existed only because generate_order_number (previously SECURITY INVOKER) needed the
-- calling user to hold raw UPDATE rights on tenants to increment order_sequence during order
-- creation (see feedback_key_patterns memory / migrations/stack9_fix_tenants_update_policy_for_order_sequence.sql).
-- Converting that function to SECURITY DEFINER (with an internal tenant-match guard, mirroring
-- this codebase's established trigger-guard pattern) removes that need entirely, so the broad
-- policy can be dropped without breaking order creation for staff/manager. Also sets search_path
-- explicitly, closing the separate function_search_path_mutable advisory for this function.

create or replace function public.generate_order_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  seq int;
  prefix text;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.profiles where id = auth.uid() and tenant_id = p_tenant_id
  ) then
    raise exception 'p_tenant_id must match the caller''s own tenant';
  end if;

  update tenants
  set order_sequence = order_sequence + 1
  where id = p_tenant_id
  returning order_sequence, order_prefix into seq, prefix;

  if seq is null then
    raise exception 'Tenant not found: %', p_tenant_id;
  end if;

  return prefix || '.' || lpad(seq::text, 3, '0');
end;
$$;

drop policy if exists "tenant_members_can_update" on public.tenants;
