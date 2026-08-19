create table public.login_lockouts (
  email text primary key,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.login_lockouts is
  'Tracks failed email/password login attempts, keyed by normalized (trim+lowercase) email.
   Shared by signIn and resetOwnPinViaPassword (see src/lib/login-lockout.ts) so an attacker
   cannot dodge the counter by switching between the two forms. Written exclusively via the
   service-role admin client — RLS is enabled with zero policies, so the anon/authenticated
   Data API can never read or write this table under any circumstance.';

alter table public.login_lockouts enable row level security;
