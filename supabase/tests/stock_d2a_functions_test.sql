-- Round D2a, Task 2 (pause/resume, packaging set save/archive, waste undo, stock flags) — DB test.
-- EXPECTS 20261123130000_stock_d2a_functions.sql TO BE APPLIED (and 20261123120000_stock_d2a_schema.sql).
-- (Dry run: the migration text + this file in ONE execute_sql call. Run alone before the migration, every
--  call raises "function ... does not exist" and the keys come out false: that is the RED state.)
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back. Every key must be true, except
-- the diagnostic keys that start with an underscore (_errs: unexpected error text per step, _codes: the
-- error each save_packaging_set probe raised, _md5: md5(prosrc) of the six functions).
-- Sessions are simulated with `set local role` + request.jwt.claims, as PostgREST does. The admin client
-- (service role) carries no `sub`, so auth.uid() is null there, as in production.
do $$
declare
  r jsonb := '{}';
  errs jsonb := '{}';            -- unexpected errors, by step
  codes jsonb := '{}';           -- save_packaging_set error probes: label -> raised message
  want jsonb := '{}';            -- save_packaging_set error probes: label -> expected code
  ua uuid := gen_random_uuid();  -- owner, tenant A
  um uuid := gen_random_uuid();  -- manager, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A (records the waste)
  us2 uuid := gen_random_uuid(); -- another staff, tenant A
  ux uuid := gen_random_uuid();  -- manager of tenant A, deactivated
  ub uuid := gen_random_uuid();  -- owner, tenant B
  ta uuid; tb uuid;
  pa uuid; pa2 uuid; parch uuid; pb uuid;
  mA1 uuid; mA2 uuid; mA3 uuid; mA4 uuid; march uuid; mB uuid;
  setA uuid; setA2 uuid; setU uuid; setB uuid; v_id uuid;
  ref1 uuid := gen_random_uuid();  -- undone by the recorder, then again
  ref2 uuid := gen_random_uuid();  -- 11 minutes old
  ref3 uuid := gen_random_uuid();  -- other staff refused, then the manager (9 minutes old)
  ref4 uuid := gen_random_uuid();  -- shop B's waste
  hb uuid;                         -- a held bill whose cancel recorded waste
  f1 uuid; fB uuid;
  bkk date := (now() at time zone 'Asia/Bangkok')::date;
  v_at timestamptz; v_at2 timestamptz;
  s1 numeric; s2 numeric; s3 numeric;
  n int; n2 int; n3 int; n4 int; n5 int; n6 int;
  ok boolean; ok2 boolean;
  err text; err2 text; err3 text; err4 text; err5 text; err6 text;
  st text; st2 text; st3 text; st4 text; st5 text; st6 text; st7 text; st8 text;
  items21 jsonb; items20dup jsonb;
  p record;
begin
  -- ── fixtures (as the default role) ──────────────────────────────────────
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2f-a-'  || ua  || '@example.test', 'x', now(), now()),
    (um,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2f-m-'  || um  || '@example.test', 'x', now(), now()),
    (us,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2f-s-'  || us  || '@example.test', 'x', now(), now()),
    (us2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2f-s2-' || us2 || '@example.test', 'x', now(), now()),
    (ux,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2f-x-'  || ux  || '@example.test', 'x', now(), now()),
    (ub,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-d2f-b-'  || ub  || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA D2F A', true);
  perform public.create_tenant_and_owner(ub, 'QA D2F B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.profiles (id, tenant_id, full_name, role)
  values (um, ta, 'QA Manager', 'manager')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'manager';
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us, ta, 'QA Staff', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us2, ta, 'QA Staff 2', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';
  insert into public.profiles (id, tenant_id, full_name, role, deactivated_at)
  values (ux, ta, 'QA Manager (ปิดใช้งาน)', 'manager', now())
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'manager', deactivated_at = now();

  insert into public.products (tenant_id, name, price, is_active) values (ta, 'ลาเต้เย็น', 60, true) returning id into pa;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'อเมริกาโน่', 50, true) returning id into pa2;
  insert into public.products (tenant_id, name, price, is_active, archived_at)
  values (ta, 'เมนูเก่า', 50, false, now()) returning id into parch;
  insert into public.products (tenant_id, name, price, is_active) values (tb, 'เมนูร้านอื่น', 60, true) returning id into pb;

  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, category, track_stock)
  values (ta, 'แก้ว 16oz', 'ใบ', 2.5, 100, 'บรรจุภัณฑ์', true) returning id into mA1;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, category, track_stock)
  values (ta, 'ฝาโดม', 'ใบ', 1, 100, 'บรรจุภัณฑ์', true) returning id into mA2;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, category, track_stock)
  values (ta, 'หลอด', 'อัน', 0.3, 100, 'บรรจุภัณฑ์', true) returning id into mA3;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (ta, 'นมสด', 'ml', 0.05, 2000, true) returning id into mA4;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, category, track_stock, archived_at)
  values (ta, 'แก้วเก่า', 'ใบ', 2, 100, 'บรรจุภัณฑ์', true, now()) returning id into march;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, category, track_stock)
  values (tb, 'แก้ว ร้านอื่น', 'ใบ', 2, 100, 'บรรจุภัณฑ์', true) returning id into mB;

  -- shop B's own set, with the name shop A will use
  insert into public.packaging_sets (tenant_id, name) values (tb, 'ชุดเย็น 16oz') returning id into setB;
  insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty) values (tb, setB, mB, 1);
  -- shop B's own flag
  insert into public.stock_flags (tenant_id, kind, business_date, detail)
  values (tb, 'stock_skipped', bkk, 'ร้านอื่น') returning id into fB;

  -- ═══ set_menu_paused ═══════════════════════════════════════════════════

  -- ── staff_pauses_and_resumes ──
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  err := null;
  begin
    v_at := public.set_menu_paused(ta, us, pa, true);
  exception when others then err := sqlerrm; errs := errs || jsonb_build_object('pause', sqlerrm);
  end;
  ok := err is null and v_at is not null
    and (select paused_at = v_at and paused_by = us from public.products where id = pa);
  err2 := null;
  v_at2 := now();  -- a resume must return null
  begin
    v_at2 := public.set_menu_paused(ta, us, pa, false);
  exception when others then err2 := sqlerrm; errs := errs || jsonb_build_object('resume', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('staff_pauses_and_resumes', coalesce(ok and err2 is null and v_at2 is null
    and (select paused_at is null and paused_by is null from public.products where id = pa), false));

  -- ── pause_records_actor: the manager pauses, then another staff pauses again; the latest actor is kept ──
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  err := null; v_at := null; v_at2 := null;
  begin
    v_at := public.set_menu_paused(ta, um, pa2, true);
  exception when others then err := sqlerrm; errs := errs || jsonb_build_object('pause_mgr', sqlerrm);
  end;
  ok := err is null and v_at = now()
    and (select paused_at = now() and paused_by = um from public.products where id = pa2);
  begin
    v_at2 := public.set_menu_paused(ta, us2, pa2, true);
  exception when others then err := sqlerrm; errs := errs || jsonb_build_object('pause_again', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('pause_records_actor', coalesce(ok and err is null and v_at2 = now()
    and (select paused_at = now() and paused_by = us2 from public.products where id = pa2)
    and (select paused_at is null and paused_by is null from public.products where id = pa), false));

  -- ── pause_foreign_product_refused: another shop's menu, an archived menu, an unknown id ──
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  err := null; err2 := null; err3 := null; err4 := null;
  begin perform public.set_menu_paused(ta, us, pb, true);    exception when others then err  := sqlerrm; end;
  begin perform public.set_menu_paused(ta, us, parch, true); exception when others then err2 := sqlerrm; end;
  begin perform public.set_menu_paused(ta, us, gen_random_uuid(), true); exception when others then err3 := sqlerrm; end;
  begin perform public.set_menu_paused(tb, ub, pa, true);    exception when others then err4 := sqlerrm; end;  -- B's owner, A's menu
  reset role;
  r := r || jsonb_build_object('pause_foreign_product_refused', coalesce(
    err = 'product_not_found' and err2 = 'product_not_found' and err3 = 'product_not_found'
    and err4 = 'product_not_found'
    and (select paused_at is null and paused_by is null from public.products where id = pb)
    and (select paused_at is null and paused_by is null from public.products where id = parch)
    and (select paused_at is null from public.products where id = pa), false));

  -- ── inactive_member_refused: a deactivated manager, and another shop's owner, for every service function ──
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  err := null; err2 := null; err3 := null; err4 := null; err5 := null; err6 := null;
  begin perform public.set_menu_paused(ta, ux, pa, true);                         exception when others then err  := sqlerrm; end;
  begin perform public.set_menu_paused(ta, ub, pa, true);                         exception when others then err2 := sqlerrm; end;
  begin perform public.stock_flag_sold_while_out(ta, ux, array[mA1], pa);         exception when others then err3 := sqlerrm; end;
  begin perform public.stock_waste_undo(ta, ux, ref1);                            exception when others then err4 := sqlerrm; end;
  begin perform public.stock_flag_resolve(ta, ux, gen_random_uuid());             exception when others then err5 := sqlerrm; end;
  begin perform public.set_menu_paused(ta, gen_random_uuid(), pa, true);          exception when others then err6 := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('inactive_member_refused', coalesce(
    err = 'forbidden' and err2 = 'forbidden' and err3 = 'forbidden' and err4 = 'forbidden'
    and err5 = 'forbidden' and err6 = 'forbidden'
    and (select paused_at is null from public.products where id = pa)
    and not exists (select 1 from public.stock_flags where tenant_id = ta), false));

  -- ═══ save_packaging_set / archive_packaging_set (user client) ══════════

  -- ── save_set_replaces_items_atomically ──
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  begin
    setA := public.save_packaging_set(null, '  ชุดเย็น 16oz  ',
      jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1),
                        jsonb_build_object('material_id', mA2, 'qty', 1)));
    ok := ok and (select count(*) = 2 from public.packaging_set_items where set_id = setA);
    v_id := public.save_packaging_set(setA, 'ชุดเย็น 16oz',
      jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 2),
                        jsonb_build_object('material_id', mA3, 'qty', 1.5)));
    ok := ok and v_id = setA;
  exception when others then ok := false; errs := errs || jsonb_build_object('save_set', sqlerrm);
  end;
  -- a rename with a bad item (another shop's material): nothing changes
  err := null;
  begin
    perform public.save_packaging_set(setA, 'ชื่อใหม่',
      jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 5),
                        jsonb_build_object('material_id', mB, 'qty', 1)));
  exception when others then err := sqlerrm;
  end;
  -- a rename with a bad LAST item (qty 0) after a valid one: nothing changes either
  err2 := null;
  begin
    perform public.save_packaging_set(setA, 'ชื่อใหม่',
      jsonb_build_array(jsonb_build_object('material_id', mA2, 'qty', 3),
                        jsonb_build_object('material_id', mA1, 'qty', 0)));
  exception when others then err2 := sqlerrm;
  end;
  reset role;
  -- the manager may save a set too
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  begin
    setA2 := public.save_packaging_set(null, 'ชุดร้อน 8oz', jsonb_build_array(jsonb_build_object('material_id', mA2, 'qty', 1)));
  exception when others then errs := errs || jsonb_build_object('save_set_mgr', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('save_set_replaces_items_atomically', coalesce(ok
    and err = 'material_not_found' and err2 = 'invalid_qty'
    and (select name = 'ชุดเย็น 16oz' and tenant_id = ta and archived_at is null from public.packaging_sets where id = setA)
    and (select count(*) = 2 from public.packaging_set_items where set_id = setA)
    and (select qty = 2 and tenant_id = ta from public.packaging_set_items where set_id = setA and raw_material_id = mA1)
    and (select qty = 1.5 and tenant_id = ta from public.packaging_set_items where set_id = setA and raw_material_id = mA3)
    and not exists (select 1 from public.packaging_set_items where set_id = setA and raw_material_id in (mA2, mB))
    and (select name = 'ชุดร้อน 8oz' and tenant_id = ta from public.packaging_sets where id = setA2)
    and (select count(*) = 1 from public.packaging_set_items where set_id = setA2), false));

  -- ── save_set_errors_are_codes ──
  select jsonb_agg(jsonb_build_object('material_id', mA1, 'qty', 1)) into items21 from generate_series(1, 21);
  select jsonb_agg(jsonb_build_object('material_id', mA1, 'qty', 1)) into items20dup from generate_series(1, 20);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  for p in select * from (values
    ('name_blank',      null::uuid, '   ',               jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)), 'name_required'),
    ('name_null',       null::uuid, null::text,          jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)), 'name_required'),
    ('name_too_long',   null::uuid, repeat('ก', 61),     jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)), 'name_too_long'),
    ('name_taken',      null::uuid, '  ชุดเย็น 16OZ ',   jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)), 'name_taken'),
    ('name_taken_edit', setA2,      'ชุดเย็น 16oz',      jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)), 'name_taken'),
    ('items_empty',     null::uuid, 'ชุดว่าง',            '[]'::jsonb,                                                         'items_required'),
    ('items_null',      null::uuid, 'ชุดว่าง',            null::jsonb,                                                         'items_required'),
    ('items_object',    null::uuid, 'ชุดว่าง',            jsonb_build_object('material_id', mA1, 'qty', 1),                    'items_required'),
    ('too_many',        null::uuid, 'ชุดใหญ่',            items21,                                                             'too_many_items'),
    ('twenty_dup',      null::uuid, 'ชุดใหญ่',            items20dup,                                                          'duplicate_material'),
    ('duplicate',       null::uuid, 'ชุดซ้ำ',             jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1),
                                                                            jsonb_build_object('material_id', mA2, 'qty', 1),
                                                                            jsonb_build_object('material_id', mA1, 'qty', 2)), 'duplicate_material'),
    ('qty_zero',        null::uuid, 'ชุด q',             jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 0)), 'invalid_qty'),
    ('qty_negative',    null::uuid, 'ชุด q',             jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', -1)), 'invalid_qty'),
    ('qty_over',        null::uuid, 'ชุด q',             jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1000.001)), 'invalid_qty'),
    ('qty_decimals',    null::uuid, 'ชุด q',             jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1.2345)), 'invalid_qty'),
    ('qty_string',      null::uuid, 'ชุด q',             jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', '1')), 'invalid_qty'),
    ('qty_missing',     null::uuid, 'ชุด q',             jsonb_build_array(jsonb_build_object('material_id', mA1)), 'invalid_qty'),
    ('mat_foreign',     null::uuid, 'ชุด m',             jsonb_build_array(jsonb_build_object('material_id', mB, 'qty', 1)), 'material_not_found'),
    ('mat_archived',    null::uuid, 'ชุด m',             jsonb_build_array(jsonb_build_object('material_id', march, 'qty', 1)), 'material_not_found'),
    ('mat_unknown',     null::uuid, 'ชุด m',             jsonb_build_array(jsonb_build_object('material_id', gen_random_uuid(), 'qty', 1)), 'material_not_found'),
    ('mat_not_uuid',    null::uuid, 'ชุด m',             jsonb_build_array(jsonb_build_object('material_id', 'not-a-uuid', 'qty', 1)), 'material_not_found'),
    ('item_not_object', null::uuid, 'ชุด m',             jsonb_build_array(to_jsonb('junk'::text)),                            'material_not_found'),
    ('set_foreign',     setB,       'ชุด s',             jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)), 'set_not_found'),
    ('set_unknown',     gen_random_uuid(), 'ชุด s',      jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)), 'set_not_found')
  ) v(label, sid, nm, items, expect) loop
    want := want || jsonb_build_object(p.label, p.expect);
    begin
      perform public.save_packaging_set(p.sid, p.nm, p.items);
      codes := codes || jsonb_build_object(p.label, 'no error');
    exception when others then
      codes := codes || jsonb_build_object(p.label, sqlerrm);
    end;
  end loop;
  reset role;
  -- staff (user client) may not save
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  want := want || jsonb_build_object('staff', 'forbidden');
  begin
    perform public.save_packaging_set(null, 'ชุดของน้อง', jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)));
    codes := codes || jsonb_build_object('staff', 'no error');
  exception when others then codes := codes || jsonb_build_object('staff', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('save_set_errors_are_codes', coalesce(codes = want
    and (select count(*) = 2 from public.packaging_sets where tenant_id = ta)
    and (select count(*) = 3 from public.packaging_set_items where tenant_id = ta)
    and (select name = 'ชุดร้อน 8oz' from public.packaging_sets where id = setA2)
    and (select name = 'ชุดเย็น 16oz' from public.packaging_sets where id = setB), false));
  r := r || jsonb_build_object('_codes', codes);

  -- ── archive_set_in_use_refused ──
  update public.products set packaging_set_id = setA where id = pa;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  begin
    setU := public.save_packaging_set(null, 'ชุดเมนูเก่า', jsonb_build_array(jsonb_build_object('material_id', mA3, 'qty', 1)));
  exception when others then errs := errs || jsonb_build_object('save_setU', sqlerrm);
  end;
  reset role;
  update public.products set packaging_set_id = setU where id = parch;  -- only an archived menu uses setU
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null; err2 := null; err3 := null;
  begin perform public.archive_packaging_set(setA); exception when others then err := sqlerrm; end;
  begin perform public.archive_packaging_set(setU); exception when others then err2 := sqlerrm; end;
  begin perform public.archive_packaging_set(setB); exception when others then err3 := sqlerrm; end;  -- another shop's set
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  err4 := null;
  begin perform public.archive_packaging_set(setA2); exception when others then err4 := sqlerrm; end;  -- staff
  reset role;
  r := r || jsonb_build_object('archive_set_in_use_refused', coalesce(
    err = 'set_in_use'
    and (select archived_at is null from public.packaging_sets where id = setA)
    and err4 = 'forbidden'
    and (select archived_at is null from public.packaging_sets where id = setA2), false));
  r := r || jsonb_build_object('archive_set_ok_when_only_archived_menus_use_it', coalesce(
    err2 is null and (select archived_at = now() from public.packaging_sets where id = setU)
    and err3 = 'set_not_found' and (select archived_at is null from public.packaging_sets where id = setB), false));
  -- once the menu stops using it, the set archives; archiving again is a no-op; its name is free again
  update public.products set packaging_set_id = null where id = pa;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null; err2 := null; v_id := null;
  begin
    perform public.archive_packaging_set(setA);
    perform public.archive_packaging_set(setA);
  exception when others then err := sqlerrm;
  end;
  begin
    v_id := public.save_packaging_set(null, 'ชุดเย็น 16oz', jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)));
  exception when others then err2 := sqlerrm;
  end;
  -- an archived set cannot be edited
  err3 := null;
  begin
    perform public.save_packaging_set(setA, 'ชุดเย็น 16oz เดิม', jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 1)));
  exception when others then err3 := sqlerrm;
  end;
  reset role;
  r := r || jsonb_build_object('archive_after_unassign_frees_name', coalesce(
    err is null and (select archived_at = now() from public.packaging_sets where id = setA)
    and err2 is null and v_id is not null and v_id <> setA
    and err3 = 'set_not_found'
    and (select name = 'ชุดเย็น 16oz' from public.packaging_sets where id = setA), false));

  -- ═══ stock_waste_undo ══════════════════════════════════════════════════

  -- ── waste_undo_restores_stock / net zero / twice ──
  select current_stock into s1 from public.raw_materials where id = mA1;
  select current_stock into s2 from public.raw_materials where id = mA2;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  n := null; err := null; err2 := null;
  begin
    perform public.stock_waste(ta, us, jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 3),
                                                         jsonb_build_object('material_id', mA2, 'qty', 2)),
                               'ทำหก · ลาเต้เย็น 1 แก้ว', ref1);
  exception when others then errs := errs || jsonb_build_object('waste1', sqlerrm);
  end;
  ok := (select current_stock = s1 - 3 from public.raw_materials where id = mA1)
    and (select current_stock = s2 - 2 from public.raw_materials where id = mA2);
  begin
    n := public.stock_waste_undo(ta, us, ref1);
  exception when others then err := sqlerrm; errs := errs || jsonb_build_object('undo1', sqlerrm);
  end;
  select count(*) into n2 from public.inventory_transactions where ref_id = ref1;
  begin
    perform public.stock_waste_undo(ta, us, ref1);
  exception when others then err2 := sqlerrm;
  end;
  reset role;
  r := r || jsonb_build_object('waste_undo_restores_stock', coalesce(ok and err is null and n = 2
    and (select current_stock = s1 from public.raw_materials where id = mA1)
    and (select current_stock = s2 from public.raw_materials where id = mA2)
    and (select count(*) = 2 from public.inventory_transactions where ref_id = ref1 and quantity > 0)
    and (select type = 'waste' and quantity = 3 and unit_cost = 2.5 and reason = 'ย้อนกลับ · ทำหก · ลาเต้เย็น 1 แก้ว'
                and tenant_id = ta and created_by = us and not legacy and order_id is null and order_item_id is null
           from public.inventory_transactions where ref_id = ref1 and raw_material_id = mA1 and quantity > 0)
    and (select type = 'waste' and quantity = 2 and unit_cost = 1 and reason = 'ย้อนกลับ · ทำหก · ลาเต้เย็น 1 แก้ว'
                and created_by = us
           from public.inventory_transactions where ref_id = ref1 and raw_material_id = mA2 and quantity > 0), false));
  r := r || jsonb_build_object('waste_undo_net_waste_zero', coalesce(
    (select count(*) = 4 and sum(quantity) = 0 and bool_and(type = 'waste')
       from public.inventory_transactions where ref_id = ref1 and tenant_id = ta)
    and (select sum(quantity) = 0 from public.inventory_transactions where ref_id = ref1 and raw_material_id = mA1)
    and (select sum(quantity) = 0 from public.inventory_transactions where ref_id = ref1 and raw_material_id = mA2), false));
  r := r || jsonb_build_object('waste_undo_twice_refused', coalesce(err2 = 'already_undone' and n2 = 4
    and (select count(*) = 4 from public.inventory_transactions where ref_id = ref1)
    and (select current_stock = s1 from public.raw_materials where id = mA1)
    and (select current_stock = s2 from public.raw_materials where id = mA2), false));

  -- ── waste_undo_after_10_min_refused ──
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.stock_waste(ta, us, jsonb_build_array(jsonb_build_object('material_id', mA1, 'qty', 4)),
                               'หมดอายุ/เสีย · แก้ว 16oz 4 ใบ', ref2);
  exception when others then errs := errs || jsonb_build_object('waste2', sqlerrm);
  end;
  reset role;
  update public.inventory_transactions set created_at = now() - interval '11 minutes' where ref_id = ref2;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  err := null; err2 := null;
  begin perform public.stock_waste_undo(ta, us, ref2); exception when others then err := sqlerrm; end;
  begin perform public.stock_waste_undo(ta, ua, ref2); exception when others then err2 := sqlerrm; end;  -- the owner too
  reset role;
  r := r || jsonb_build_object('waste_undo_after_10_min_refused', coalesce(err = 'too_late' and err2 = 'too_late'
    and (select current_stock = s1 - 4 from public.raw_materials where id = mA1)
    and (select count(*) = 1 from public.inventory_transactions where ref_id = ref2), false));

  -- ── waste_undo_other_staff_refused, then waste_undo_by_manager_ok (9 minutes old: still inside) ──
  select current_stock into s3 from public.raw_materials where id = mA3;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.stock_waste(ta, us, jsonb_build_array(jsonb_build_object('material_id', mA3, 'qty', 1.5)),
                               'ทำหก · หลอด 1.5 อัน', ref3);
  exception when others then errs := errs || jsonb_build_object('waste3', sqlerrm);
  end;
  err := null;
  begin perform public.stock_waste_undo(ta, us2, ref3); exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('waste_undo_other_staff_refused', coalesce(err = 'forbidden'
    and (select current_stock = s3 - 1.5 from public.raw_materials where id = mA3)
    and (select count(*) = 1 from public.inventory_transactions where ref_id = ref3), false));
  update public.inventory_transactions set created_at = now() - interval '9 minutes' where ref_id = ref3;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  err := null; n := null;
  begin
    n := public.stock_waste_undo(ta, um, ref3);
  exception when others then err := sqlerrm; errs := errs || jsonb_build_object('undo3', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('waste_undo_by_manager_ok', coalesce(err is null and n = 1
    and (select current_stock = s3 from public.raw_materials where id = mA3)
    and (select quantity = 1.5 and unit_cost = 0.3 and created_by = um and reason = 'ย้อนกลับ · ทำหก · หลอด 1.5 อัน'
           from public.inventory_transactions where ref_id = ref3 and quantity > 0)
    and (select sum(quantity) = 0 from public.inventory_transactions where ref_id = ref3), false));

  -- ── waste_undo_not_found: an unknown ref, another shop's waste, a held bill's cancel waste ──
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.stock_waste(tb, ub, jsonb_build_array(jsonb_build_object('material_id', mB, 'qty', 1)), 'ทำหก', ref4);
  exception when others then errs := errs || jsonb_build_object('waste4', sqlerrm);
  end;
  reset role;
  insert into public.held_bills (tenant_id, queue_number, business_date, items, created_by)
  values (ta, 1, bkk, '[]'::jsonb, us) returning id into hb;
  select current_stock into s2 from public.raw_materials where id = mA2;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.stock_waste(ta, us, jsonb_build_array(jsonb_build_object('material_id', mA2, 'qty', 1)),
                               'ยกเลิกบิลพักหลังชง', hb);
  exception when others then errs := errs || jsonb_build_object('waste_hb', sqlerrm);
  end;
  err := null; err2 := null; err3 := null; err4 := null;
  begin perform public.stock_waste_undo(ta, us, gen_random_uuid()); exception when others then err  := sqlerrm; end;
  begin perform public.stock_waste_undo(ta, ua, ref4);              exception when others then err2 := sqlerrm; end;
  begin perform public.stock_waste_undo(ta, us, hb);                exception when others then err3 := sqlerrm; end;
  begin perform public.stock_waste_undo(ta, ua, hb);                exception when others then err4 := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('waste_undo_not_found', coalesce(
    err = 'not_found' and err2 = 'not_found' and err3 = 'not_found' and err4 = 'not_found'
    and (select current_stock = 99 from public.raw_materials where id = mB)
    and (select count(*) = 1 from public.inventory_transactions where ref_id = ref4)
    and (select current_stock = s2 - 1 from public.raw_materials where id = mA2)
    and (select count(*) = 1 from public.inventory_transactions where ref_id = hb), false));

  -- ═══ stock flags ═══════════════════════════════════════════════════════

  -- ── flag_dedup_per_material_per_day ──
  insert into public.stock_flags (tenant_id, kind, raw_material_id, product_id, business_date, created_by)
  values (ta, 'sold_while_out', mA3, pa, bkk - 1, us);  -- yesterday's flag does not stop today's
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  n := null; n2 := null; n3 := null; n4 := null;
  begin
    n  := public.stock_flag_sold_while_out(ta, us, array[mA1, mA2, mA1], pa);
    n2 := public.stock_flag_sold_while_out(ta, us2, array[mA1], pa2);
    n3 := public.stock_flag_sold_while_out(ta, us, array[mA1, mA3], pa);
    n4 := public.stock_flag_sold_while_out(ta, us, '{}'::uuid[], pa)
        + public.stock_flag_sold_while_out(ta, us, null, pa);
  exception when others then errs := errs || jsonb_build_object('flags', sqlerrm);
  end;
  reset role;
  select id into f1 from public.stock_flags where tenant_id = ta and raw_material_id = mA1;
  r := r || jsonb_build_object('flag_dedup_per_material_per_day', coalesce(n = 2 and n2 = 0 and n3 = 1 and n4 = 0
    and (select count(*) = 3 from public.stock_flags where tenant_id = ta and business_date = bkk)
    and (select count(*) = 1 from public.stock_flags where tenant_id = ta and raw_material_id = mA1)
    and (select count(*) = 2 from public.stock_flags where tenant_id = ta and raw_material_id = mA3)
    and (select kind = 'sold_while_out' and product_id = pa and created_by = us and business_date = bkk
                and resolved_at is null and resolved_by is null and detail is null and order_id is null
           from public.stock_flags where id = f1), false));

  -- ── flag_foreign_material_ignored (and another shop's menu is dropped from the flag) ──
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  n := null; n2 := null;
  begin
    n  := public.stock_flag_sold_while_out(ta, us, array[mB, gen_random_uuid()], pa);
    n2 := public.stock_flag_sold_while_out(ta, us, array[mA4, mB], pb);
  exception when others then errs := errs || jsonb_build_object('flags_foreign', sqlerrm);
  end;
  reset role;
  r := r || jsonb_build_object('flag_foreign_material_ignored', coalesce(n = 0 and n2 = 1
    and not exists (select 1 from public.stock_flags where raw_material_id = mB)
    and (select count(*) = 1 from public.stock_flags where tenant_id = tb)
    and (select count(*) = 4 from public.stock_flags where tenant_id = ta and business_date = bkk)
    and (select product_id is null and tenant_id = ta from public.stock_flags where raw_material_id = mA4), false));

  -- ── resolve_by_staff_refused, then the manager resolves ──
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  err := null; err2 := null; err3 := null; err4 := null;
  begin perform public.stock_flag_resolve(ta, us, f1); exception when others then err := sqlerrm; end;
  ok := (select resolved_at is null and resolved_by is null from public.stock_flags where id = f1);
  begin perform public.stock_flag_resolve(ta, um, f1); exception when others then err2 := sqlerrm; end;
  begin perform public.stock_flag_resolve(ta, ua, f1); exception when others then err3 := sqlerrm; end;  -- already resolved: kept
  begin perform public.stock_flag_resolve(ta, ua, fB); exception when others then err4 := sqlerrm; end;  -- another shop's flag
  reset role;
  r := r || jsonb_build_object('resolve_by_staff_refused', coalesce(err = 'forbidden' and ok, false));
  r := r || jsonb_build_object('resolve_by_manager_ok', coalesce(err2 is null and err3 is null
    and (select resolved_at = now() and resolved_by = um from public.stock_flags where id = f1)
    and err4 = 'not_found'
    and (select resolved_at is null from public.stock_flags where id = fB)
    and (select count(*) = 1 from public.stock_flags where tenant_id = ta and resolved_at is not null), false));

  -- ═══ grants and shape ══════════════════════════════════════════════════

  -- ── anon_and_authenticated_cannot_execute_service_fns ──
  ok := false;
  begin
    ok := true;
    for p in select * from (values
      ('public.set_menu_paused(uuid,uuid,uuid,boolean)'),
      ('public.stock_waste_undo(uuid,uuid,uuid)'),
      ('public.stock_flag_sold_while_out(uuid,uuid,uuid[],uuid)'),
      ('public.stock_flag_resolve(uuid,uuid,uuid)')
    ) v(fn) loop
      ok := ok and not has_function_privilege('anon', p.fn, 'execute')
               and not has_function_privilege('authenticated', p.fn, 'execute')
               and not has_function_privilege('public', p.fn, 'execute')
               and has_function_privilege('service_role', p.fn, 'execute');
    end loop;
  exception when others then ok := false; errs := errs || jsonb_build_object('privs', sqlerrm);
  end;
  -- and a real call through the user client (the owner) and anon is refused with 42501
  st := null; st2 := null; st3 := null; st4 := null; st5 := null; st6 := null; st7 := null; st8 := null;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  begin perform public.set_menu_paused(ta, ua, pa, true);                 exception when others then st  := sqlstate; end;
  begin perform public.stock_waste_undo(ta, ua, ref2);                    exception when others then st2 := sqlstate; end;
  begin perform public.stock_flag_sold_while_out(ta, ua, array[mA4], pa); exception when others then st3 := sqlstate; end;
  begin perform public.stock_flag_resolve(ta, ua, f1);                    exception when others then st4 := sqlstate; end;
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin perform public.set_menu_paused(ta, ua, pa, true);                 exception when others then st5 := sqlstate; end;
  begin perform public.stock_waste_undo(ta, ua, ref2);                    exception when others then st6 := sqlstate; end;
  begin perform public.stock_flag_sold_while_out(ta, ua, array[mA4], pa); exception when others then st7 := sqlstate; end;
  begin perform public.stock_flag_resolve(ta, ua, f1);                    exception when others then st8 := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := r || jsonb_build_object('anon_and_authenticated_cannot_execute_service_fns', coalesce(ok
    and st = '42501' and st2 = '42501' and st3 = '42501' and st4 = '42501'
    and st5 = '42501' and st6 = '42501' and st7 = '42501' and st8 = '42501'
    and (select paused_at is null from public.products where id = pa), false));

  -- ── the packaging-set functions: the user client may call them, anon never ──
  ok := false;
  begin
    ok := has_function_privilege('authenticated', 'public.save_packaging_set(uuid,text,jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.archive_packaging_set(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.save_packaging_set(uuid,text,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.archive_packaging_set(uuid)', 'execute')
      and not has_function_privilege('public', 'public.save_packaging_set(uuid,text,jsonb)', 'execute')
      and not has_function_privilege('public', 'public.archive_packaging_set(uuid)', 'execute');
  exception when others then ok := false; errs := errs || jsonb_build_object('set_privs', sqlerrm);
  end;
  r := r || jsonb_build_object('set_fns_user_client_only', coalesce(ok, false));

  -- ── every new function: SECURITY INVOKER, search_path = public, one signature (no overloads) ──
  r := r || jsonb_build_object('functions_invoker_no_overloads', coalesce(
    (select count(*) = 6 and bool_and(not prosecdef) and bool_and(proconfig = array['search_path=public'])
       from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('set_menu_paused', 'save_packaging_set', 'archive_packaging_set', 'stock_waste_undo',
                        'stock_flag_sold_while_out', 'stock_flag_resolve')), false));

  r := r || jsonb_build_object('_md5', (select jsonb_object_agg(proname, md5(prosrc)) from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('set_menu_paused', 'save_packaging_set', 'archive_packaging_set', 'stock_waste_undo',
                        'stock_flag_sold_while_out', 'stock_flag_resolve')));
  r := r || jsonb_build_object('_errs', errs);
  raise exception 'RESULT %', r;
end;
$$;
