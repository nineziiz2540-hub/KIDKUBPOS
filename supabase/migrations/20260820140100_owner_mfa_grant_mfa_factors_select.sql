-- Required for the "require_aal2_if_mfa_enrolled_for_tenants_update" restrictive policy on
-- public.tenants (migration 20260820140000_owner_mfa.sql) to actually work: the policy's USING
-- clause queries auth.mfa_factors as the invoking (authenticated) role, and without this grant
-- Postgres raises 42501 "permission denied for table mfa_factors" on every UPDATE to tenants —
-- not just for MFA-enrolled users, breaking the existing Owner update path entirely. This is
-- part of Supabase's own documented MFA-gating pattern (the omission was caught by the Step 5
-- QA verification in the Task 1 brief, which requires an unenrolled Owner's UPDATE to still
-- succeed). auth.mfa_factors exposes only factor metadata (id, user_id, status, factor_type,
-- friendly_name, timestamps) — no secrets — so this grant does not leak sensitive data.
grant select on auth.mfa_factors to authenticated;
