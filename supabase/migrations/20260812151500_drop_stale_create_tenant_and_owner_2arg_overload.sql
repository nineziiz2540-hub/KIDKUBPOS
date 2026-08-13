-- `create or replace function` only replaces a function with the EXACT SAME argument
-- list; adding p_has_backup_password to create_tenant_and_owner in the previous
-- migration created a second, overloaded function instead of replacing the original.
-- Two overloads meant a 2-argument call (as used by the email/password signUp flow)
-- became ambiguous ("could not choose a best candidate function"). Drop the stale
-- 2-argument version so only the 3-argument one (with its default) remains.
drop function if exists public.create_tenant_and_owner(uuid, text);
