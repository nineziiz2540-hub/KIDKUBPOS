-- The owners_select_tenant_members policy (added in 20260716092551) put a subquery
-- that selects from public.profiles inside a SELECT policy ON public.profiles.
-- Postgres must evaluate that subquery under RLS, which re-triggers the same policy
-- -> "infinite recursion detected in policy for relation profiles" (42P17) on EVERY
-- read of profiles, including getProfile()'s own-row self-select. That broke all
-- auth-dependent reads app-wide and caused an infinite redirect loop
-- (ERR_TOO_MANY_REDIRECTS): getProfile() returned null -> /job-level redirected to
-- /login -> proxy bounced the authed user back to / -> shell to /job-level -> ...
--
-- Fix: read the caller's own tenant_id/role via SECURITY DEFINER helper functions.
-- Running as definer bypasses RLS inside the function, so the policy no longer
-- recurses. search_path is pinned (also satisfies the function-search-path advisor).

create or replace function public.auth_tenant_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function public.auth_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

drop policy if exists "owners_select_tenant_members" on public.profiles;

create policy "owners_select_tenant_members"
  on public.profiles for select
  using (
    tenant_id = public.auth_tenant_id()
    and public.auth_role() = 'owner'
  );
