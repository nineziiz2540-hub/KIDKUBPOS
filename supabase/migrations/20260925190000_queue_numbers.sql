create table public.tenant_queue_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_date date not null,
  last_number int not null default 0,
  primary key (tenant_id, business_date)
);
-- Only reachable through next_queue_number (SECURITY DEFINER); no policies = no direct access.
alter table public.tenant_queue_counters enable row level security;

alter table public.orders add column queue_number int;

create or replace function public.next_queue_number(p_tenant_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number int;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.profiles where id = auth.uid() and tenant_id = p_tenant_id
  ) then
    raise exception 'p_tenant_id must match the caller''s own tenant';
  end if;

  insert into public.tenant_queue_counters as c (tenant_id, business_date, last_number)
  values (p_tenant_id, (now() at time zone 'Asia/Bangkok')::date, 1)
  on conflict (tenant_id, business_date)
  do update set last_number = c.last_number + 1
  returning last_number into v_number;

  return v_number;
end;
$$;

-- Unlike generate_order_number, anon must not reach this at all (its uid-only guard lets an
-- unauthenticated caller through).
revoke execute on function public.next_queue_number(uuid) from public, anon;
grant execute on function public.next_queue_number(uuid) to authenticated, service_role;
