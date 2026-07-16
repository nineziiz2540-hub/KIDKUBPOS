alter table public.profiles
  add column pin_hash text,
  add column recovery_contact text,
  add column auth_managed boolean not null default true,
  add column pin_failed_attempts int not null default 0,
  add column pin_locked_until timestamptz;

comment on column public.profiles.pin_hash is
  'bcrypt hash of the 6-digit PIN used at the /job-level gate. Null until first set.';
comment on column public.profiles.recovery_contact is
  'Free-text contact info (phone, etc.) shown to the owner on the Team page. Never emailed automatically.';
comment on column public.profiles.auth_managed is
  'true = this profile''s auth.users row belongs to the person themselves (Owner via signup).
   false = the auth.users row is a synthetic account created by the Owner for Manager/Staff PIN login.';
comment on column public.profiles.pin_failed_attempts is
  'Consecutive wrong-PIN count at /job-level. Reset to 0 on a correct attempt.';
comment on column public.profiles.pin_locked_until is
  'If set and in the future, PIN attempts for this profile are rejected until this time.';

create or replace function public.create_tenant_and_owner(
  p_user_id    uuid,
  p_store_name text
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

  insert into public.profiles (id, tenant_id, role, auth_managed)
  values (p_user_id, v_tenant_id, 'owner', true);

  return v_tenant_id;
end;
$$;
