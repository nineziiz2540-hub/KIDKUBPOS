-- profiles_update_own (id = auth.uid()) has no column restriction, so any authenticated
-- user can PATCH their own role/tenant_id directly via the Data API and self-promote to
-- owner or move themselves into another tenant. Confirmed exploitable live 2026-07-16
-- (a disposable Staff test account successfully escalated itself to 'owner' via a raw
-- PATCH request against the public REST API). This blocks exactly that: changing
-- role/tenant_id on your OWN row.
--
-- Deliberately scoped to self-updates only (auth.uid() = OLD.id) so it does not affect:
--   - Owner changing a teammate's role via updateMemberRole (targets a DIFFERENT row,
--     auth.uid() != OLD.id, governed by the separate "owners can update team member
--     roles" policy) — re-verified live after this fix, still works
--   - Any admin-client (service_role) call, e.g. resetTeamMemberPin, createTeamMember,
--     switchToMember's lockout-counter updates — service_role calls have no user JWT,
--     so auth.uid() is NULL there and NULL = OLD.id is never true
--   - setOwnPin / verifyOwnPin / resetOwnPinViaPassword, which update the caller's own
--     row but never touch role or tenant_id — re-verified: legitimate self-updates
--     (e.g. full_name) still succeed after this fix

create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.tenant_id is distinct from old.tenant_id)
     and auth.uid() = old.id then
    raise exception 'Cannot change your own role or tenant_id';
  end if;
  return new;
end;
$$;

create trigger prevent_self_privilege_escalation_trigger
before update on public.profiles
for each row
execute function public.prevent_self_privilege_escalation();
