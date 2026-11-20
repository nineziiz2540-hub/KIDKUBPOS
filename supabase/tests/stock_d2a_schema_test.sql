-- Round D2a, Task 1 (packaging sets, pause columns, bag settings, stock flags, FK indexes) — DB test.
-- EXPECTS 20261123120000_stock_d2a_schema.sql TO BE APPLIED.
-- (Dry run: the migration text + this file in ONE execute_sql call. Run alone before the migration, it stops
--  at the first missing table: that is the RED state.)
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back. Every key must be true, except
-- the diagnostic keys that start with an underscore (_succeeded lists the probes that got through,
-- _unindexed_fks the foreign keys without a full index, _flag_reads the flag counts, _*_err any error text).
-- Sessions are simulated with `set local role` + request.jwt.claims, as PostgREST does.
-- "Probe succeeded" = a write that raised nothing AND touched >=1 row, or a read that raised nothing.
-- A probe is refused when it raises (permission denied / RLS violation / check) or a write touches 0 rows.
do $$
declare
  r jsonb := '{}';
  hit text[] := '{}';            -- labels of probes that got through
  ua uuid := gen_random_uuid();  -- owner, tenant A
  um uuid := gen_random_uuid();  -- manager, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A
  ub uuid := gen_random_uuid();  -- owner, tenant B
  ta uuid; tb uuid;
  sa uuid;
  pa uuid; pb uuid;
  mA1 uuid; mA2 uuid; mA3 uuid; mB uuid;
  setO uuid; setM uuid; setX uuid; setB uuid; setO2 uuid;
  oa uuid; item1 uuid;
  fA1 uuid; fA2 uuid; fB uuid;
  bkk date := (now() at time zone 'Asia/Bangkok')::date;
  actor uuid; actor_name text;
  p record;
  n int; n_sets int; n_items int;
  ok boolean; ok2 boolean; ok3 boolean; ok4 boolean;
  okp boolean; okt boolean;
  flag_reads jsonb := '{}';
  unindexed text[];
  v_src text;
  v_items_case text;
  v_sets_case text;
  v_rit_case text;
begin
  -- ── fixtures (as the default role) ──────────────────────────────────────
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2s-a-' || ua || '@example.test', 'x', now(), now()),
    (um, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2s-m-' || um || '@example.test', 'x', now(), now()),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2s-s-' || us || '@example.test', 'x', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2s-b-' || ub || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA D2S A', true);
  perform public.create_tenant_and_owner(ub, 'QA D2S B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.profiles (id, tenant_id, full_name, role)
  values (um, ta, 'QA Manager', 'manager')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'manager';
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us, ta, 'QA Staff', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';

  sa := public.shift_open(ta, ua, array[0]::numeric[], null);
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'ลาเต้เย็น', 60, true) returning id into pa;
  insert into public.products (tenant_id, name, price, is_active) values (tb, 'เมนูร้านอื่น', 60, true) returning id into pb;

  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, category)
  values (ta, 'แก้ว 16oz', 'ใบ', 2.5, 100, 'บรรจุภัณฑ์') returning id into mA1;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, category)
  values (ta, 'ฝาโดม', 'ใบ', 1, 100, 'บรรจุภัณฑ์') returning id into mA2;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, category)
  values (ta, 'หลอด', 'อัน', 0.3, 100, 'บรรจุภัณฑ์') returning id into mA3;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, category)
  values (tb, 'แก้ว ร้านอื่น', 'ใบ', 2, 100, 'บรรจุภัณฑ์') returning id into mB;

  insert into public.orders (tenant_id, created_by, status, payment_method, total, subtotal, shift_id)
  values (ta, ua, 'completed', 'cash', 60, 60, sa) returning id into oa;
  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (oa, pa, 'ลาเต้เย็น', 60, 1, 60) returning id into item1;

  -- shop B's own set, with the same name shop A will use
  insert into public.packaging_sets (tenant_id, name) values (tb, 'ชุดเย็น 16oz') returning id into setB;
  insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (tb, setB, mB, 1);

  -- flags, as the service functions will write them
  insert into public.stock_flags (tenant_id, kind, raw_material_id, product_id, business_date, created_by)
  values (ta, 'sold_while_out', mA1, pa, bkk, us) returning id into fA1;
  insert into public.stock_flags (tenant_id, kind, order_id, business_date, detail)
  values (ta, 'stock_skipped', oa, bkk, 'ข้ามสต๊อก 1 รายการ') returning id into fA2;
  insert into public.stock_flags (tenant_id, kind, raw_material_id, business_date)
  values (tb, 'sold_while_out', mB, bkk) returning id into fB;

  -- ── OWNER (user client): a set with items, edits, a set deleted with its items ──
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  begin
    insert into public.packaging_sets (tenant_id, name) values (ta, 'ชุดเย็น 16oz') returning id into setO;
    insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty)
    values (ta, setO, mA1, 1), (ta, setO, mA2, 1), (ta, setO, mA3, 1);
    update public.packaging_set_items set qty = 2 where set_id = setO and raw_material_id = mA3;
    get diagnostics n = row_count; ok := ok and n = 1;
    update public.packaging_sets set sort_order = 1 where id = setO;
    get diagnostics n = row_count; ok := ok and n = 1;
    insert into public.packaging_sets (tenant_id, name) values (ta, 'ชุดช็อต') returning id into setX;
    insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (ta, setX, mA1, 1);
    delete from public.packaging_sets where id = setX;
    get diagnostics n = row_count; ok := ok and n = 1;
  exception when others then
    ok := false;
    r := r || jsonb_build_object('_owner_err', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('owner_creates_set_with_items', ok
    and (select count(*) = 3 from public.packaging_set_items where set_id = setO and tenant_id = ta)
    and (select qty = 2 from public.packaging_set_items where set_id = setO and raw_material_id = mA3)
    and (select sort_order = 1 and archived_at is null and created_at is not null
           from public.packaging_sets where id = setO)
    and not exists (select 1 from public.packaging_sets where id = setX)
    and not exists (select 1 from public.packaging_set_items where set_id = setX));

  -- ── MANAGER (user client) ───────────────────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  ok := true;
  begin
    insert into public.packaging_sets (tenant_id, name, sort_order) values (ta, 'ชุดร้อน 8oz', 2) returning id into setM;
    insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (ta, setM, mA1, 1);
    update public.packaging_sets set name = 'ชุดร้อน 8oz (ใหม่)' where id = setM;
    get diagnostics n = row_count; ok := ok and n = 1;
  exception when others then
    ok := false;
    r := r || jsonb_build_object('_manager_err', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('manager_creates_set', ok
    and (select name = 'ชุดร้อน 8oz (ใหม่)' and tenant_id = ta from public.packaging_sets where id = setM)
    and (select count(*) = 1 from public.packaging_set_items where set_id = setM));

  select count(*) into n_sets from public.packaging_sets where tenant_id = ta;
  select count(*) into n_items from public.packaging_set_items where tenant_id = ta;

  -- ── STAFF (user client): reads sets and items, writes nothing ───────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  for p in select * from (values
    ('set_ins',  format('insert into public.packaging_sets (tenant_id, name) values (%L, ''ชุดของน้อง'')', ta)),
    ('set_upd',  format('update public.packaging_sets set name = ''เปลี่ยนชื่อ'' where id = %L', setO)),
    ('set_arch', format('update public.packaging_sets set archived_at = now() where id = %L', setM)),
    ('set_del',  format('delete from public.packaging_sets where id = %L', setM)),
    ('item_ins', format('insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (%L, %L, %L, 1)', ta, setM, mA2)),
    ('item_upd', format('update public.packaging_set_items set qty = 9 where set_id = %L', setO)),
    ('item_del', format('delete from public.packaging_set_items where set_id = %L', setO))
  ) v(label, q) loop
    ok := false;
    begin
      execute p.q;
      get diagnostics n = row_count;
      ok := n > 0;
    exception when others then ok := false;
    end;
    if ok then hit := hit || ('staff:' || p.label); end if;
  end loop;
  ok := true;
  begin
    select count(*) into n from public.packaging_sets;       ok := ok and n = n_sets and n >= 2;
    select count(*) into n from public.packaging_set_items;  ok := ok and n = n_items and n >= 4;
    perform id, tenant_id, name, sort_order, archived_at, created_at from public.packaging_sets;
    perform id, tenant_id, set_id, raw_material_id, qty from public.packaging_set_items;
  exception when others then ok := false;
  end;
  reset role;
  r := r || jsonb_build_object('staff_cannot_write_set',
    not exists (select 1 from unnest(hit) h where h like 'staff:%')
    and (select name = 'ชุดเย็น 16oz' from public.packaging_sets where id = setO)
    and (select archived_at is null from public.packaging_sets where id = setM)
    and (select count(*) = n_items from public.packaging_set_items where tenant_id = ta)
    and (select count(*) = n_sets from public.packaging_sets where tenant_id = ta));
  r := r || jsonb_build_object('staff_reads_sets', ok);

  -- ── cross-tenant references, as the OWNER of shop A (shop B's ids) ─────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  for p in select * from (values
    ('item_material_b',  format('insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (%L, %L, %L, 1)', ta, setM, mB)),
    ('item_set_b',       format('insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (%L, %L, %L, 1)', ta, setB, mA2)),
    ('item_tenant_b',    format('insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (%L, %L, %L, 1)', tb, setB, mB)),
    ('item_repoint_mat', format('update public.packaging_set_items set raw_material_id = %L where set_id = %L and raw_material_id = %L', mB, setO, mA1)),
    ('item_repoint_set', format('update public.packaging_set_items set set_id = %L where set_id = %L and raw_material_id = %L', setB, setO, mA1)),
    ('set_tenant_b',     format('insert into public.packaging_sets (tenant_id, name) values (%L, ''แอบสร้าง'')', tb)),
    ('set_b_rename',     format('update public.packaging_sets set name = ''แอบแก้'' where id = %L', setB)),
    ('set_b_delete',     format('delete from public.packaging_sets where id = %L', setB))
  ) v(label, q) loop
    ok := false;
    begin
      execute p.q;
      get diagnostics n = row_count;
      ok := n > 0;
    exception when others then ok := false;
    end;
    if ok then hit := hit || ('xtenant:' || p.label); end if;
  end loop;
  -- positive control: the same owner adds a valid item of her own shop; she sees nothing of shop B
  ok := true;
  begin
    insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (ta, setM, mA2, 1);
    select count(*) into n from public.packaging_sets where tenant_id = tb;      ok := ok and n = 0;
    select count(*) into n from public.packaging_set_items where tenant_id = tb; ok := ok and n = 0;
  exception when others then ok := false;
  end;
  reset role;
  r := r || jsonb_build_object('set_item_other_tenant_material_refused',
    ok
    and not exists (select 1 from unnest(hit) h where h like 'xtenant:%')
    and (select count(*) = 3 from public.packaging_set_items where set_id = setO and raw_material_id in (mA1, mA2, mA3))
    and (select count(*) = 1 from public.packaging_set_items where set_id = setB)
    and (select name = 'ชุดเย็น 16oz' from public.packaging_sets where id = setB));

  -- ── set names: unique per shop among live sets, ignoring case and outer spaces ──
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := false;
  begin
    insert into public.packaging_sets (tenant_id, name) values (ta, '  ชุดเย็น 16OZ ');
  exception when unique_violation then ok := true;
            when others then ok := false;
  end;
  ok2 := false;
  begin
    update public.packaging_sets set name = 'ชุดเย็น 16OZ' where id = setM;
  exception when unique_violation then ok2 := true;
            when others then ok2 := false;
  end;
  reset role;
  r := r || jsonb_build_object('set_name_unique_per_tenant_case_insensitive',
    ok and ok2
    -- shop B's 'ชุดเย็น 16oz' lives next to shop A's
    and (select count(*) = 2 from public.packaging_sets where lower(btrim(name)) = 'ชุดเย็น 16oz' and id in (setO, setB)));

  -- ── an archived set frees its name; bringing it back while the name is taken clashes ──
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  begin
    update public.packaging_sets set archived_at = now() where id = setO;
    get diagnostics n = row_count; ok := ok and n = 1;
    insert into public.packaging_sets (tenant_id, name) values (ta, 'ชุดเย็น 16oz') returning id into setO2;
  exception when others then ok := false;
  end;
  ok2 := false;
  begin
    update public.packaging_sets set archived_at = null where id = setO;
  exception when unique_violation then ok2 := true;
            when others then ok2 := false;
  end;
  reset role;
  r := r || jsonb_build_object('archived_set_name_reusable',
    ok and ok2 and setO2 is not null
    and (select archived_at is not null from public.packaging_sets where id = setO));

  -- ── column checks on sets and items (default role: no RLS in the way) ──
  ok := true;
  begin
    begin insert into public.packaging_sets (tenant_id, name) values (ta, '   '); ok := false;
    exception when check_violation then null; end;
    begin insert into public.packaging_sets (tenant_id, name) values (ta, repeat('ก', 61)); ok := false;
    exception when check_violation then null; end;
    insert into public.packaging_sets (tenant_id, name) values (ta, repeat('ข', 60));
    begin insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (ta, setM, mA3, 0); ok := false;
    exception when check_violation then null; end;
    begin insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (ta, setM, mA3, 1000.001); ok := false;
    exception when check_violation then null; end;
    begin insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (ta, setM, mA1, 1); ok := false;
    exception when unique_violation then null; end;
    insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (ta, setM, mA3, 1000);
  exception when others then
    ok := false;
    r := r || jsonb_build_object('_checks_err', sqlerrm);
  end;
  r := r || jsonb_build_object('set_name_and_qty_checks', ok);

  -- ── anon reads and writes nothing on the three new tables ──────────────
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  for p in select * from (values
    ('read_sets',   'select 1 from public.packaging_sets limit 1'),
    ('read_items',  'select 1 from public.packaging_set_items limit 1'),
    ('read_flags',  'select 1 from public.stock_flags limit 1'),
    ('ins_set',     format('insert into public.packaging_sets (tenant_id, name) values (%L, ''anon'')', ta)),
    ('ins_flag',    format('insert into public.stock_flags (tenant_id, kind, business_date) values (%L, ''stock_skipped'', current_date)', ta))
  ) v(label, q) loop
    begin
      execute p.q;
      hit := hit || ('anon:' || p.label);   -- not even a permission error
    exception when others then null;
    end;
  end loop;
  reset role;
  r := r || jsonb_build_object('anon_reads_nothing',
    not exists (select 1 from unnest(hit) h where h like 'anon:%')
    and not has_table_privilege('anon', 'public.packaging_sets', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    and not has_table_privilege('anon', 'public.packaging_set_items', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    and not has_table_privilege('anon', 'public.stock_flags', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'));

  -- ── stock flags: owner and manager read their shop's, staff reads none ─
  for actor_name, actor in select * from (values ('owner', ua), ('manager', um), ('staff', us)) v(a, u) loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
    begin
      select count(*) into n from public.stock_flags;
      perform id, tenant_id, kind, raw_material_id, product_id, order_id, business_date, detail,
              created_by, created_at, resolved_at, resolved_by
         from public.stock_flags;
    exception when others then n := -1;   -- refused outright
    end;
    reset role;
    flag_reads := flag_reads || jsonb_build_object(actor_name, n);
  end loop;
  r := r || jsonb_build_object('_flag_reads', flag_reads);
  r := r || jsonb_build_object('staff_cannot_read_flags', (flag_reads->>'staff')::int in (0, -1));
  r := r || jsonb_build_object('owner_reads_flags', (flag_reads->>'owner')::int = 2);     -- fA1, fA2; never shop B's
  r := r || jsonb_build_object('manager_reads_flags', (flag_reads->>'manager')::int = 2);

  -- ── stock flags: nobody writes them through the Data API ────────────────
  for actor_name, actor in select * from (values ('owner', ua), ('manager', um), ('staff', us)) v(a, u) loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
    for p in select * from (values
      ('ins', format('insert into public.stock_flags (tenant_id, kind, raw_material_id, business_date) values (%L, ''sold_while_out'', %L, %L)', ta, mA2, bkk - 1)),
      ('upd', format('update public.stock_flags set resolved_at = now(), resolved_by = %L where id = %L', actor, fA1)),
      ('del', format('delete from public.stock_flags where id = %L', fA2))
    ) v(label, q) loop
      ok := false;
      begin
        execute p.q;
        get diagnostics n = row_count;
        ok := n > 0;
      exception when others then ok := false;
      end;
      if ok then hit := hit || ('flagw:' || actor_name || ':' || p.label); end if;
    end loop;
    reset role;
  end loop;
  r := r || jsonb_build_object('nobody_writes_flags_directly',
    not exists (select 1 from unnest(hit) h where h like 'flagw:%')
    and (select resolved_at is null and resolved_by is null from public.stock_flags where id = fA1)
    and exists (select 1 from public.stock_flags where id = fA2)
    and (select count(*) = 3 from public.stock_flags where tenant_id in (ta, tb))
    and not has_table_privilege('authenticated', 'public.stock_flags', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_flags' and cmd <> 'SELECT'));

  -- ── stock flags: the service role (Task 2 / 3 functions) writes them; one sold_while_out per material per day ──
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  ok := true;
  begin
    insert into public.stock_flags (tenant_id, kind, raw_material_id, product_id, business_date, created_by)
    values (ta, 'sold_while_out', mA2, pa, bkk, us);
    insert into public.stock_flags (tenant_id, kind, raw_material_id, business_date)
    values (ta, 'sold_while_out', mA1, bkk - 1);                            -- same material, another day
    insert into public.stock_flags (tenant_id, kind, order_id, business_date)
    values (ta, 'stock_skipped', oa, bkk), (ta, 'stock_skipped', oa, bkk);  -- skipped: no per-day limit
    update public.stock_flags set resolved_at = now(), resolved_by = ua where id = fA1;
    get diagnostics n = row_count; ok := ok and n = 1;
  exception when others then
    ok := false;
    r := r || jsonb_build_object('_service_flag_err', sqlerrm);
  end;
  ok2 := false;
  begin
    insert into public.stock_flags (tenant_id, kind, raw_material_id, business_date) values (ta, 'sold_while_out', mA1, bkk);
  exception when unique_violation then ok2 := true;
            when others then ok2 := false;
  end;
  -- a sold_while_out flag always names its material (a null one would slip past the per-day index)
  ok4 := false;
  begin
    insert into public.stock_flags (tenant_id, kind, product_id, business_date) values (ta, 'sold_while_out', pa, bkk);
  exception when check_violation then ok4 := true;
            when others then ok4 := false;
  end;
  ok3 := true;
  begin
    begin insert into public.stock_flags (tenant_id, kind, business_date) values (ta, 'bogus', bkk); ok3 := false;
    exception when check_violation then null; end;
    begin insert into public.stock_flags (tenant_id, kind, business_date, detail) values (ta, 'stock_skipped', bkk, repeat('ก', 301)); ok3 := false;
    exception when check_violation then null; end;
    begin insert into public.stock_flags (tenant_id, kind, raw_material_id) values (ta, 'stock_skipped', mA1); ok3 := false;
    exception when not_null_violation then null; end;
  exception when others then ok3 := false;
  end;
  reset role;
  r := r || jsonb_build_object('service_role_writes_flags', ok);
  r := r || jsonb_build_object('sold_while_out_one_per_material_per_day', ok2);
  r := r || jsonb_build_object('flag_checks', ok3);
  r := r || jsonb_build_object('sold_while_out_needs_material', ok4
    and exists (select 1 from pg_constraint where conname = 'stock_flags_sold_while_out_has_material'
                  and conrelid = 'public.stock_flags'::regclass and contype = 'c')
    -- stock_skipped rows may still have no material (the service inserts above wrote two)
    and (select count(*) >= 3 from public.stock_flags where tenant_id = ta and kind = 'stock_skipped' and raw_material_id is null));

  -- ── products: packaging and pause columns ───────────────────────────────
  r := r || jsonb_build_object('products_has_pause_columns',
    (select count(*) = 4 from information_schema.columns
      where table_schema = 'public' and table_name = 'products'
        and ((column_name = 'packaging_set_id' and data_type = 'uuid' and is_nullable = 'YES' and column_default is null)
          or (column_name = 'house_glass_default' and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false')
          or (column_name = 'paused_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES' and column_default is null)
          or (column_name = 'paused_by' and data_type = 'uuid' and is_nullable = 'YES' and column_default is null)))
    and exists (select 1 from pg_constraint where conname = 'products_paused_by_fkey'
                  and conrelid = 'public.products'::regclass and confrelid = 'public.profiles'::regclass)
    -- the set is checked against the menu's own shop: one composite FK, no single-column one
    and exists (select 1 from pg_constraint where conname = 'products_packaging_set_tenant_fkey'
                  and conrelid = 'public.products'::regclass and confrelid = 'public.packaging_sets'::regclass
                  and cardinality(conkey) = 2)
    and not exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.products'::regclass
                      and confrelid = 'public.packaging_sets'::regclass and cardinality(conkey) = 1)
    and (select packaging_set_id is null and not house_glass_default and paused_at is null and paused_by is null
           from public.products where id = pa));

  -- the owner's user client sets the menu's packaging and glass default, never the pause columns
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  begin
    update public.products set packaging_set_id = setM, house_glass_default = true where id = pa;
    get diagnostics n = row_count; ok := ok and n = 1;
  exception when others then
    ok := false;
    r := r || jsonb_build_object('_menu_pack_err', sqlerrm);
  end;
  for p in select * from (values
    ('upd_paused_at', format('update public.products set paused_at = now() where id = %L', pa)),
    ('upd_paused_by', format('update public.products set paused_by = %L where id = %L', ua, pa)),
    ('ins_paused',    format('insert into public.products (tenant_id, name, price, is_active, paused_at, paused_by) values (%L, ''ปิดไว้'', 50, true, now(), %L)', ta, ua))
  ) v(label, q) loop
    ok2 := false;
    begin
      execute p.q;
      get diagnostics n = row_count;
      ok2 := n > 0;
    exception when others then ok2 := false;
    end;
    if ok2 then hit := hit || ('pause:' || p.label); end if;
  end loop;
  reset role;
  r := r || jsonb_build_object('owner_sets_menu_packaging', ok
    and (select packaging_set_id = setM and house_glass_default from public.products where id = pa));

  -- the service role (set_menu_paused) pauses and resumes
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  ok := true;
  begin
    update public.products set paused_at = now(), paused_by = us where id = pa;
    get diagnostics n = row_count; ok := ok and n = 1;
    ok := ok and (select paused_by = us and paused_at is not null from public.products where id = pa);
    update public.products set paused_at = null, paused_by = null where id = pa;
    get diagnostics n = row_count; ok := ok and n = 1;
  exception when others then
    ok := false;
    r := r || jsonb_build_object('_service_pause_err', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('pause_columns_service_only', ok
    and not exists (select 1 from unnest(hit) h where h like 'pause:%')
    and (select paused_at is null and paused_by is null from public.products where id = pa)
    and not exists (select 1 from public.products where tenant_id = ta and name = 'ปิดไว้'));

  -- ── a menu's set and the shop's bag material belong to the same shop (composite FKs, R-D2a-7) ──
  -- as shop A's OWNER (user client): shop B's set or material is refused; her own, or none, is accepted
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  for p in select * from (values
    ('menu_set_b',     format('update public.products set packaging_set_id = %L where id = %L', setB, pa)),
    ('new_menu_set_b', format('insert into public.products (tenant_id, name, price, is_active, packaging_set_id) values (%L, ''เมนูแอบ'', 50, true, %L)', ta, setB)),
    ('bag_material_b', format('update public.tenants set bag_material_id = %L where id = %L', mB, ta))
  ) v(label, q) loop
    ok := false;
    begin
      execute p.q;
      get diagnostics n = row_count;
      ok := n > 0;
    exception when others then ok := false;
    end;
    if ok then hit := hit || ('xref:' || p.label); end if;
  end loop;
  okp := true;
  begin
    update public.products set packaging_set_id = null where id = pa;
    get diagnostics n = row_count; okp := okp and n = 1;
    update public.products set packaging_set_id = setM where id = pa;
    get diagnostics n = row_count; okp := okp and n = 1;
  exception when others then
    okp := false;
    r := r || jsonb_build_object('_menu_own_set_err', sqlerrm);
  end;
  okt := true;
  begin
    update public.tenants set bag_material_id = mA3 where id = ta;
    get diagnostics n = row_count; okt := okt and n = 1;
    update public.tenants set bag_material_id = null where id = ta;
    get diagnostics n = row_count; okt := okt and n = 1;
  exception when others then
    okt := false;
    r := r || jsonb_build_object('_bag_own_material_err', sqlerrm);
  end;
  reset role;
  -- the FKs hold for the service role too (no RLS, no app check in the way)
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  ok := false;
  begin
    update public.products set packaging_set_id = setB where id = pa;
  exception when foreign_key_violation then ok := true;
            when others then ok := false;
  end;
  ok2 := false;
  begin
    update public.tenants set bag_material_id = mB where id = ta;
  exception when foreign_key_violation then ok2 := true;
            when others then ok2 := false;
  end;
  reset role;
  r := r || jsonb_build_object('product_packaging_set_other_tenant_refused',
    okp and ok
    and not exists (select 1 from unnest(hit) h where h in ('xref:menu_set_b', 'xref:new_menu_set_b'))
    and (select packaging_set_id = setM from public.products where id = pa)
    and not exists (select 1 from public.products where packaging_set_id = setB and tenant_id = ta));
  r := r || jsonb_build_object('tenant_bag_material_other_tenant_refused',
    okt and ok2
    and not exists (select 1 from unnest(hit) h where h = 'xref:bag_material_b')
    and (select bag_material_id is null from public.tenants where id = ta));

  -- ── orders.bags ─────────────────────────────────────────────────────────
  ok := (select bags = 0 from public.orders where id = oa)
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'orders' and column_name = 'bags'
                   and data_type = 'integer' and is_nullable = 'NO' and column_default = '0');
  begin
    begin
      insert into public.orders (tenant_id, created_by, status, payment_method, total, subtotal, shift_id, bags)
      values (ta, ua, 'completed', 'cash', 60, 60, sa, 100);
      ok := false;
    exception when check_violation then null; end;
    begin
      insert into public.orders (tenant_id, created_by, status, payment_method, total, subtotal, shift_id, bags)
      values (ta, ua, 'completed', 'cash', 60, 60, sa, -1);
      ok := false;
    exception when check_violation then null; end;
    update public.orders set bags = 99 where id = oa;
    ok := ok and (select bags = 99 from public.orders where id = oa);
  exception when others then
    ok := false;
    r := r || jsonb_build_object('_bags_err', sqlerrm);
  end;
  r := r || jsonb_build_object('orders_bags_default_0', ok);

  -- ── orders.bags: no member of the shop changes it through the Data API ──
  for actor_name, actor in select * from (values ('owner', ua), ('manager', um), ('staff', us)) v(a, u) loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
    ok := false;
    begin
      execute format('update public.orders set bags = 7 where id = %L', oa);
      get diagnostics n = row_count;
      ok := n > 0;
    exception when others then ok := false;
    end;
    if ok then hit := hit || ('bagsw:' || actor_name); end if;
    reset role;
  end loop;
  -- control: the guard touches only bags; staff still updates another column of the same bill
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  ok := true;
  begin
    update public.orders set note = 'โต๊ะริมหน้าต่าง' where id = oa;
    get diagnostics n = row_count; ok := n = 1;
  exception when others then
    ok := false;
    r := r || jsonb_build_object('_staff_note_err', sqlerrm);
  end;
  reset role;
  -- the service role (order_record / order_void) still writes it
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  ok2 := true;
  begin
    update public.orders set bags = 2 where id = oa;
    get diagnostics n = row_count; ok2 := n = 1;
  exception when others then
    ok2 := false;
    r := r || jsonb_build_object('_service_bags_err', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('staff_cannot_change_order_bags',
    ok and ok2
    and not exists (select 1 from unnest(hit) h where h like 'bagsw:%')
    and (select bags = 2 and note = 'โต๊ะริมหน้าต่าง' from public.orders where id = oa));

  -- ── tenants: bag material and "1 bag per N cups" ────────────────────────
  ok := (select bag_material_id is null and bags_per_cups is null from public.tenants where id = ta);
  begin
    begin update public.tenants set bags_per_cups = 0 where id = ta; ok := false;
    exception when check_violation then null; end;
    begin update public.tenants set bags_per_cups = 21 where id = ta; ok := false;
    exception when check_violation then null; end;
    update public.tenants set bag_material_id = mA3, bags_per_cups = 20 where id = ta;
    update public.tenants set bags_per_cups = 1 where id = ta;
    ok := ok and (select bag_material_id = mA3 and bags_per_cups = 1 from public.tenants where id = ta)
      and exists (select 1 from pg_constraint where conname = 'tenants_bag_material_tenant_fkey'
                    and conrelid = 'public.tenants'::regclass and confrelid = 'public.raw_materials'::regclass
                    and cardinality(conkey) = 2)
      and not exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.tenants'::regclass
                        and confrelid = 'public.raw_materials'::regclass and cardinality(conkey) = 1);
  exception when others then
    ok := false;
    r := r || jsonb_build_object('_tenant_bags_err', sqlerrm);
  end;
  r := r || jsonb_build_object('tenant_bag_settings', ok);

  -- ── bill-level stock rows (order_item_id null): one sale and one void_restock per bill and material ──
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id)
  values (ta, mA3, 'sale', -1, oa);
  ok := false;
  begin
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id)
    values (ta, mA3, 'sale', -1, oa);
  exception when unique_violation then ok := true;
            when others then ok := false;
  end;
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id)
  values (ta, mA3, 'void_restock', 1, oa);
  ok2 := false;
  begin
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id)
    values (ta, mA3, 'void_restock', 1, oa);
  exception when unique_violation then ok2 := true;
            when others then ok2 := false;
  end;
  -- not caught: another material, an item-level row of the same bill and material, legacy rows, waste rows
  ok3 := true;
  begin
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id)
    values (ta, mA2, 'sale', -1, oa);
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id, order_item_id)
    values (ta, mA3, 'sale', -1, oa, item1);
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id, legacy)
    values (ta, mA1, 'sale', -1, oa, true), (ta, mA1, 'sale', -1, oa, true);
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity)
    values (ta, mA1, 'waste', -1), (ta, mA1, 'waste', -1);
  exception when others then
    ok3 := false;
    r := r || jsonb_build_object('_bill_level_err', sqlerrm);
  end;
  r := r || jsonb_build_object('bill_level_sale_row_unique', ok and ok2 and ok3
    and (select pg_get_indexdef('public.inventory_transactions_one_per_bill_material_type'::regclass))
        = 'CREATE UNIQUE INDEX inventory_transactions_one_per_bill_material_type ON public.inventory_transactions USING btree (order_id, raw_material_id, type) WHERE ((order_item_id IS NULL) AND (type = ANY (ARRAY[''sale''::text, ''void_restock''::text])) AND (NOT legacy))');

  -- ── the D1 item-level index is untouched and still bites ────────────────
  ok := false;
  begin
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id, order_item_id)
    values (ta, mA3, 'sale', -1, oa, item1);
  exception when unique_violation then ok := true;
            when others then ok := false;
  end;
  r := r || jsonb_build_object('item_level_index_unchanged', ok
    and (select pg_get_indexdef('public.inventory_transactions_one_per_item_material_type'::regclass))
        = 'CREATE UNIQUE INDEX inventory_transactions_one_per_item_material_type ON public.inventory_transactions USING btree (order_item_id, raw_material_id, type) WHERE ((type = ANY (ARRAY[''sale''::text, ''void_restock''::text])) AND (NOT legacy))');

  -- ── config_refs_ok: fails closed for an unknown table; new and old cases answer as they should ──
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := not public.config_refs_ok('no_such_table', jsonb_build_object('tenant_id', ta))
    and not public.config_refs_ok('packaging_set', jsonb_build_object('tenant_id', ta))
    and not public.config_refs_ok('stock_flags', jsonb_build_object('tenant_id', ta))
    and not public.config_refs_ok('', jsonb_build_object('tenant_id', ta))
    and not coalesce(public.config_refs_ok(null, jsonb_build_object('tenant_id', ta)), false);
  ok2 := public.config_refs_ok('packaging_sets', jsonb_build_object('tenant_id', ta))
    and not public.config_refs_ok('packaging_sets', jsonb_build_object('tenant_id', tb))
    and public.config_refs_ok('packaging_set_items', jsonb_build_object('tenant_id', ta, 'set_id', setM, 'raw_material_id', mA2))
    and not public.config_refs_ok('packaging_set_items', jsonb_build_object('tenant_id', ta, 'set_id', setB, 'raw_material_id', mA2))
    and not public.config_refs_ok('packaging_set_items', jsonb_build_object('tenant_id', ta, 'set_id', setM, 'raw_material_id', mB))
    and not public.config_refs_ok('packaging_set_items', jsonb_build_object('tenant_id', ta, 'set_id', setM))
    and not public.config_refs_ok('packaging_set_items', jsonb_build_object('tenant_id', tb, 'set_id', setB, 'raw_material_id', mB))
    and public.config_refs_ok('choice_groups', jsonb_build_object('tenant_id', ta))
    and public.config_refs_ok('sweetness_levels', jsonb_build_object('tenant_id', ta))
    and not public.config_refs_ok('choice_group_members', jsonb_build_object('tenant_id', ta, 'group_id', null, 'raw_material_id', mA1));
  -- row_in_tenant knows packaging_sets, and still answers only for the caller's own shop (no oracle)
  ok3 := public.row_in_tenant('packaging_sets', setM, ta)
    and not public.row_in_tenant('packaging_sets', setB, tb)
    and not public.row_in_tenant('packaging_sets', setB, ta)
    and not public.row_in_tenant('packaging_sets', setM, tb)
    and not public.row_in_tenant('packaging_sets', mA1, ta)
    and public.row_in_tenant('raw_materials', mA1, ta)
    and not public.row_in_tenant('raw_materials', mB, tb)
    and not public.row_in_tenant('no_such_table', setM, ta);
  reset role;
  r := r || jsonb_build_object('config_refs_ok_still_fails_closed_for_unknown_table', ok);
  r := r || jsonb_build_object('config_refs_ok_packaging_cases', ok2);
  r := r || jsonb_build_object('row_in_tenant_packaging_sets', ok3);

  -- row_in_tenant: everything but the new case is byte-identical to the lockdown body (md5 of its prosrc, read live 2026-11-20)
  select prosrc into v_src from pg_proc where oid = 'public.row_in_tenant(text, uuid, uuid)'::regprocedure;
  v_rit_case := E'    when ''packaging_sets''       then exists (select 1 from public.packaging_sets       where id = p_id and tenant_id = p_tenant)\n';
  r := r || jsonb_build_object('row_in_tenant_rest_byte_identical',
    position(v_rit_case in v_src) > 0
    and md5(replace(v_src, v_rit_case, '')) = '39436466bd98d8ffb406b4164ab1d28c'
    and (select prosecdef and provolatile = 's' and proconfig = array['search_path=public']
           from pg_proc where oid = 'public.row_in_tenant(text, uuid, uuid)'::regprocedure)
    and not has_function_privilege('anon', 'public.row_in_tenant(text, uuid, uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.row_in_tenant(text, uuid, uuid)', 'execute'));

  -- config_refs_ok: everything but the two new cases is byte-identical to the lockdown body (md5 of its prosrc, read live 2026-11-20)
  select prosrc into v_src from pg_proc where oid = 'public.config_refs_ok(text, jsonb)'::regprocedure;
  v_items_case := E'        when ''packaging_set_items'' then\n'
    || E'          public.row_in_tenant(''packaging_sets'', (p_row->>''set_id'')::uuid, (p_row->>''tenant_id'')::uuid)\n'
    || E'          and public.row_in_tenant(''raw_materials'', (p_row->>''raw_material_id'')::uuid, (p_row->>''tenant_id'')::uuid)\n';
  v_sets_case := E'        when ''packaging_sets''   then true\n';
  r := r || jsonb_build_object('config_refs_ok_rest_byte_identical',
    position(v_items_case in v_src) > 0
    and position(v_sets_case in v_src) > 0
    and md5(replace(replace(v_src, v_items_case, ''), v_sets_case, '')) = 'b42950ff73f539ffef2ead4063ef8151'
    and (select prosecdef and provolatile = 's' and proconfig = array['search_path=public']
           from pg_proc where oid = 'public.config_refs_ok(text, jsonb)'::regprocedure)
    and not has_function_privilege('anon', 'public.config_refs_ok(text, jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.config_refs_ok(text, jsonb)', 'execute'));

  -- ── grants and RLS of the new tables ────────────────────────────────────
  r := r || jsonb_build_object('new_table_grants',
    has_table_privilege('authenticated', 'public.packaging_sets', 'SELECT')
    and has_table_privilege('authenticated', 'public.packaging_sets', 'INSERT')
    and has_table_privilege('authenticated', 'public.packaging_sets', 'UPDATE')
    and has_table_privilege('authenticated', 'public.packaging_sets', 'DELETE')
    and has_table_privilege('authenticated', 'public.packaging_set_items', 'SELECT')
    and has_table_privilege('authenticated', 'public.packaging_set_items', 'INSERT')
    and has_table_privilege('authenticated', 'public.packaging_set_items', 'UPDATE')
    and has_table_privilege('authenticated', 'public.packaging_set_items', 'DELETE')
    and has_table_privilege('authenticated', 'public.stock_flags', 'SELECT')
    and not has_table_privilege('authenticated', 'public.packaging_sets', 'TRUNCATE, REFERENCES, TRIGGER')
    and not has_table_privilege('authenticated', 'public.packaging_set_items', 'TRUNCATE, REFERENCES, TRIGGER')
    and has_table_privilege('service_role', 'public.stock_flags', 'INSERT')
    and (select bool_and(relrowsecurity) from pg_class
          where oid in ('public.packaging_sets'::regclass, 'public.packaging_set_items'::regclass, 'public.stock_flags'::regclass)));

  -- ── foreign keys: every FK of the D1 tables and the new tables / columns has a full (non-partial) index that
  --    leads with its columns, in FK column order. A partial index cannot serve the FK's lookup.
  select coalesce(array_agg(c.conrelid::regclass::text || ':' || c.conname order by c.conname), '{}') into unindexed
    from pg_constraint c
   where c.contype = 'f'
     and (c.conrelid = any (array['public.packaging_sets', 'public.packaging_set_items', 'public.stock_flags',
                                  'public.raw_materials', 'public.inventory_transactions', 'public.order_items',
                                  'public.product_recipes', 'public.choice_groups', 'public.choice_group_members',
                                  'public.sweetness_levels', 'public.sweetness_amounts', 'public.product_sweetness',
                                  'public.modifier_option_effects']::regclass[])
          or c.conname in ('products_packaging_set_tenant_fkey', 'products_paused_by_fkey', 'tenants_bag_material_tenant_fkey'))
     and not exists (select 1 from pg_index i
                      where i.indrelid = c.conrelid
                        and i.indpred is null
                        and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey);
  r := r || jsonb_build_object('_unindexed_fks', to_jsonb(unindexed));
  r := r || jsonb_build_object('fk_columns_indexed',
    cardinality(unindexed) = 0
    and (select count(*) = 3 from pg_constraint
          where conname in ('products_packaging_set_tenant_fkey', 'products_paused_by_fkey', 'tenants_bag_material_tenant_fkey'))
    -- the same test still sees a foreign key this migration leaves alone (products.category_id is not a D1 table's)
    and exists (select 1 from pg_constraint c
                 where c.conname = 'products_category_id_fkey'
                   and not exists (select 1 from pg_index i
                                    where i.indrelid = c.conrelid
                                      and i.indpred is null
                                      and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)));

  r := r || jsonb_build_object('_succeeded', to_jsonb(hit));
  raise exception 'RESULT %', r;
end;
$$;
