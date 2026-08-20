create table public.mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.mfa_backup_codes is
  'One-time recovery codes for Owner TOTP 2FA, bcrypt-hashed. Written exclusively via the
   service-role admin client (src/lib/mfa-backup-codes.ts) — RLS is enabled with zero policies,
   so the anon/authenticated Data API can never read or write this table. Using a valid code
   disables the account''s MFA factor entirely (see src/app/actions/mfa.ts) rather than acting as
   a repeatable second factor — Supabase''s AAL cannot be elevated by anything outside its own
   mfa.verify/challengeAndVerify flow.';

alter table public.mfa_backup_codes enable row level security;

-- Restrictive policy: when the acting user has a verified TOTP factor enrolled, an UPDATE on
-- tenants requires an aal2 session (i.e. the MFA challenge must have been completed in this
-- session, not just password sign-in). Users with no verified factor are unaffected — the CASE
-- falls back to allowing both aal1 and aal2. This is Supabase's own documented pattern for
-- MFA-gating specific tables (see https://supabase.com/docs/guides/auth/auth-mfa). Being
-- restrictive, this can only ever narrow what tenants' existing permissive UPDATE policy
-- ("owners can update their tenant name") already allows — it cannot grant new access.
create policy "require_aal2_if_mfa_enrolled_for_tenants_update"
on public.tenants
as restrictive
for update
to authenticated
using (
  array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where user_id = auth.uid() and status = 'verified'
  )
);
