-- Held (parked, unpaid) bills + audit log. Readable by tenant members; written only by server
-- actions via the admin client. See docs/superpowers/specs/2026-09-25-held-bills-queue-notes-design.md.
create table public.held_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  queue_number int not null,
  business_date date not null,
  customer_label text check (customer_label is null or char_length(customer_label) <= 40),
  customer_id uuid references public.customers(id) on delete set null,
  order_type text not null default 'dine_in' check (order_type in ('dine_in', 'take_away')),
  items jsonb not null,
  discount_type text check (discount_type is null or discount_type in ('percent', 'amount')),
  discount_value numeric,
  discount_reason text,
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  version int not null default 1,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_approved_by uuid references public.profiles(id),
  cancel_reason text,
  cancelled_at timestamptz
);
create index held_bills_tenant_open_idx on public.held_bills (tenant_id) where status = 'open';
alter table public.held_bills enable row level security;
create policy held_bills_select on public.held_bills
  for select to authenticated using (tenant_id = public.auth_tenant_id());

create table public.held_bill_events (
  id uuid primary key default gen_random_uuid(),
  held_bill_id uuid not null references public.held_bills(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  event_type text not null check (event_type in ('held', 'updated', 'items_reduced', 'paid', 'cancelled')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index held_bill_events_bill_idx on public.held_bill_events (held_bill_id);
alter table public.held_bill_events enable row level security;
create policy held_bill_events_select on public.held_bill_events
  for select to authenticated using (tenant_id = public.auth_tenant_id());

alter table public.orders
  add column held_bill_id uuid unique references public.held_bills(id);

-- orders accepts direct INSERTs from tenant members through the Data API, so without this anyone
-- could insert a bogus order pointing at a real held bill and — thanks to the UNIQUE constraint —
-- make that bill unpayable. Only service_role (createOrder) may set or change the link.
create or replace function public.prevent_direct_held_bill_link()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.held_bill_id is not null then
      raise exception 'Linking an order to a held bill requires a service-role write';
    end if;
  elsif new.held_bill_id is distinct from old.held_bill_id then
    raise exception 'Linking an order to a held bill requires a service-role write';
  end if;
  return new;
end;
$$;
create trigger prevent_direct_held_bill_link_trigger
  before insert or update on public.orders
  for each row execute function public.prevent_direct_held_bill_link();
