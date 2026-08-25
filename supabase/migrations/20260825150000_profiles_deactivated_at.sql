alter table public.profiles
  add column deactivated_at timestamptz null default null;
