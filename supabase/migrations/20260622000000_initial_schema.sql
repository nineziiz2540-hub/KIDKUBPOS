-- ============================================================
-- TENANTS: แต่ละร้านค้า/ธุรกิจ = 1 tenant
-- ============================================================
create table public.tenants (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  slug       text        unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- PROFILES: ขยาย auth.users ด้วย tenant membership + role
-- ============================================================
create table public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  full_name  text,
  role       text        not null default 'staff'
             check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_tenant_id_idx on public.profiles(tenant_id);

-- ============================================================
-- ROW LEVEL SECURITY — ทุก table ต้องเปิด RLS (กฎเหล็กจาก CLAUDE.md)
-- ============================================================
alter table public.tenants  enable row level security;
alter table public.profiles enable row level security;

-- tenants: ผู้ใช้เห็นได้เฉพาะ tenant ของตัวเอง
create policy "tenants_select_own_tenant"
  on public.tenants for select
  using (
    id in (
      select tenant_id from public.profiles
      where id = auth.uid()
    )
  );

-- profiles: ผู้ใช้เห็นได้เฉพาะ profiles ใน tenant เดียวกัน
create policy "profiles_select_own_tenant"
  on public.profiles for select
  using (
    tenant_id in (
      select tenant_id from public.profiles
      where id = auth.uid()
    )
  );

-- profiles: ผู้ใช้แก้ได้เฉพาะ profile ของตัวเอง
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid());

-- ============================================================
-- AUTO-UPDATE updated_at ON CHANGE
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
