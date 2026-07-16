-- The original tenant-wide SELECT policy ("profiles_select_own_tenant") was replaced at
-- some point (outside tracked migrations, likely during Stack 8's security hardening) with
-- "profiles_select_own" (id = auth.uid() only). This silently broke the Team Management page's
-- ability to list any teammate other than yourself, discovered live while QA'ing the new
-- login/auth revamp's Team Management extension (Owner adds Manager/Staff).
create policy "owners_select_tenant_members"
  on public.profiles for select
  using (
    tenant_id = (select tenant_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) = 'owner'
  );
