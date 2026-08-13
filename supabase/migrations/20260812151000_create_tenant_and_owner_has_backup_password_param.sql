-- The OAuth first-login flow (src/app/auth/callback/route.ts) previously called
-- create_tenant_and_owner (which always defaulted has_backup_password to true via the
-- column default) and then issued a *separate* UPDATE to flip it to false. That second
-- step had no error handling — if it silently failed, the new OAuth owner would be left
-- with has_backup_password = true despite having no real password, permanently and
-- silently bypassing the /onboarding/set-password gate. Making the flag part of the same
-- atomic insert removes that failure window entirely.
create or replace function public.create_tenant_and_owner(
  p_user_id             uuid,
  p_store_name          text,
  p_has_backup_password boolean default true
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
  v_slug text;
begin
  v_slug := lower(regexp_replace(p_store_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(md5(random()::text), 1, 6);

  insert into public.tenants (name, slug)
  values (p_store_name, v_slug)
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, role, auth_managed, has_backup_password)
  values (p_user_id, v_tenant_id, 'owner', true, p_has_backup_password);

  return v_tenant_id;
end;
$$;
