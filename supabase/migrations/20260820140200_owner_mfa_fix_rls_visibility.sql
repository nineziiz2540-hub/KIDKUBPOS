-- Corrects a load-bearing bug in the restrictive policy added by
-- 20260820140000_owner_mfa.sql: auth.mfa_factors has RLS enabled with ZERO policies (confirmed
-- live: `select * from pg_policies where tablename = 'mfa_factors'` returns no rows). RLS
-- enabled + no policies means Postgres denies ALL access to that table for any non-owner role,
-- INCLUDING the `authenticated` role reading its own rows, regardless of table-level GRANTs.
-- 20260820140100_owner_mfa_grant_mfa_factors_select.sql granted `authenticated` SELECT on the
-- table specifically to fix a "42501 permission denied" error, and that grant alone made the
-- error go away — but proven live via a simulated authenticated-role query
-- (`set local role authenticated; set local request.jwt.claim.sub = '<uid-with-a-real-verified-
-- factor>'`) that the restrictive policy's subquery against auth.mfa_factors STILL always saw
-- zero rows even for a user's own verified factor, because RLS-with-no-policies blocks visibility
-- independent of the GRANT. The practical effect: the restrictive policy's CASE always fell into
-- the "no factor" branch and NEVER required aal2 for anyone, silently making the entire RLS half
-- of this feature a no-op — the exact failure mode this session's earlier tenants-forgery
-- incident (20260820130000) already burned time on once.
--
-- Fix: a SECURITY DEFINER helper function bypasses auth.mfa_factors' RLS safely (it always checks
-- auth.uid() internally, never a caller-supplied id, so it can only ever answer "does the CALLING
-- user have a verified factor" — it cannot be used to probe any other user's MFA status). The
-- broad SELECT grant is no longer needed and is revoked to restore least-privilege.
--
-- Re-verified live after this fix, both directions: an aal1 session for an account WITH a real
-- verified factor is now rejected (0 rows affected on PATCH); an aal1 session for an account with
-- NO factor still succeeds unchanged (proving the pre-2FA Owner update path is unaffected).

create or replace function public.caller_has_verified_mfa_factor()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from auth.mfa_factors
    where user_id = auth.uid() and status = 'verified'
  );
$$;

comment on function public.caller_has_verified_mfa_factor() is
  'Returns whether the CURRENT session''s user (auth.uid(), never a parameter) has a verified TOTP
   factor. SECURITY DEFINER so it can read auth.mfa_factors despite that table''s RLS having no
   policies for the authenticated role. Always self-scoped — cannot be used to check another
   user''s MFA status. Used by the restrictive AAL2 policy on public.tenants.';

drop policy if exists "require_aal2_if_mfa_enrolled_for_tenants_update" on public.tenants;

create policy "require_aal2_if_mfa_enrolled_for_tenants_update"
on public.tenants
as restrictive
for update
to authenticated
using (
  case
    when public.caller_has_verified_mfa_factor() then (select auth.jwt()->>'aal') = 'aal2'
    else true
  end
);

revoke select on auth.mfa_factors from authenticated;
