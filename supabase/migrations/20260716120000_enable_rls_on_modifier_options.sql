-- Supabase security advisor flagged "RLS Disabled in Public" (ERROR/Critical) on
-- modifier_options: it was originally designed with no tenant_id and no RLS,
-- relying solely on app-level ownership checks in src/app/actions/modifiers.ts.
-- Since the anon key is public, this let anyone query modifier_options across
-- every tenant directly via the Data API, bypassing those checks entirely.
alter table public.modifier_options enable row level security;

create policy "tenant_isolation" on public.modifier_options
  using (
    modifier_id in (
      select id from public.modifiers
      where tenant_id = (select tenant_id from public.profiles where id = auth.uid())
    )
  );
