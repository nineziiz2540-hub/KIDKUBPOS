alter table public.profiles
  add column has_backup_password boolean not null default true;

comment on column public.profiles.has_backup_password is
  'true if this profile''s auth.users row has a usable password (set at email/password signup, or added later via /onboarding/set-password for OAuth-only accounts). Owners with false are gated to /onboarding/set-password before reaching /job-level, so the password-based "forgot PIN" re-auth flow always has a password to check against. Defaults true since pre-existing rows were created via the password-based signUp flow.';
