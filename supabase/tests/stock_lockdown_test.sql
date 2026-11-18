-- Stock lockdown (round D1, Task 9) — DB test. EXPECTS 20261118160000_stock_lockdown.sql TO BE APPLIED.
-- (Evidence run: run this file alone BEFORE the migration to see the holes as false keys, and run the
--  migration text + this file in ONE execute_sql call to dry-run the AFTER state.)
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back. Every key (except _succeeded,
-- which lists the probes that got through) must be true.
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
  pa uuid; pa2 uuid; pa3 uuid; pa4 uuid; pa5 uuid; pb uuid;
  mA uuid; mA2 uuid; mA3 uuid; mS uuid; mB uuid;
  gA uuid; gB uuid;
  memA uuid; memB uuid;
  lA uuid; lB uuid;
  modA uuid; optA uuid; modB uuid; optB uuid;
  sa uuid; oa uuid; item1 uuid; item2 uuid; itemS uuid; tx1 uuid; tx2 uuid; txS uuid;
  actor uuid; actor_name text;
  p record;
  n int;
  ok boolean;
  cnt_write int; cnt_ledger int; cnt_read int; cnt_forge int; cnt_mat int;
  cost numeric; ucost numeric; ctotal numeric;
begin
  -- ── fixtures (as the default role) ──────────────────────────────────────
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-sl-a-' || ua || '@example.test', 'x', now(), now()),
    (um, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-sl-m-' || um || '@example.test', 'x', now(), now()),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-sl-s-' || us || '@example.test', 'x', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-sl-b-' || ub || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA SL A', true);
  perform public.create_tenant_and_owner(ub, 'QA SL B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.profiles (id, tenant_id, full_name, role)
  values (um, ta, 'QA Manager', 'manager')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'manager';
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us, ta, 'QA Staff', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';

  sa := public.shift_open(ta, ua, array[0]::numeric[], null);
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'ลาเต้', 55, true) returning id into pa;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'p2', 55, true) returning id into pa2;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'p3', 55, true) returning id into pa3;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'p4', 55, true) returning id into pa4;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'p5', 55, true) returning id into pa5;
  insert into public.products (tenant_id, name, price, is_active) values (tb, 'สินค้าร้านอื่น', 55, true) returning id into pb;

  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'เมล็ด A', 'g', 0.5, 100) returning id into mA;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'เมล็ด A2', 'g', 0.6, 100) returning id into mA2;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'ลบได้', 'g', 0.6, 100) returning id into mA3;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'ไว้เช็คบริการ', 'g', 0.5, 100) returning id into mS;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (tb, 'เมล็ด ร้านอื่น', 'g', 0.9, 100) returning id into mB;

  insert into public.choice_groups (tenant_id, name, kind) values (ta, 'กลุ่ม A', 'bean') returning id into gA;
  insert into public.choice_groups (tenant_id, name, kind) values (tb, 'กลุ่ม B', 'bean') returning id into gB;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier) values (ta, gA, mA, 'A', 'house') returning id into memA;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier) values (tb, gB, mB, 'B', 'house') returning id into memB;
  insert into public.sweetness_levels (tenant_id, name) values (ta, 'หวาน A') returning id into lA;
  insert into public.sweetness_levels (tenant_id, name) values (tb, 'หวาน B') returning id into lB;
  insert into public.modifiers (tenant_id, name) values (ta, 'ม A') returning id into modA;
  insert into public.modifier_options (modifier_id, name) values (modA, 'ตัวเลือก A') returning id into optA;
  insert into public.modifiers (tenant_id, name) values (tb, 'ม B') returning id into modB;
  insert into public.modifier_options (modifier_id, name) values (modB, 'ตัวเลือก B') returning id into optB;

  insert into public.orders (tenant_id, created_by, status, payment_method, total, subtotal, shift_id)
  values (ta, ua, 'completed', 'cash', 110, 110, sa) returning id into oa;
  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, cost_total)
  values (oa, pa, 'ลาเต้', 55, 2, 110, 7.25) returning id into item1;
  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, cost_total)
  values (oa, pa, 'ลาเต้', 55, 1, 55, 3) returning id into item2;
  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, cost_total)
  values (oa, pa, 'ไว้เช็คบริการ', 55, 1, 55, 7.25) returning id into itemS;
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, unit_cost) values (ta, mA, 'receive', 10, 0.5) returning id into tx1;
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, unit_cost) values (ta, mA, 'receive', 10, 0.5) returning id into tx2;
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, unit_cost) values (ta, mS, 'receive', 10, 0.5) returning id into txS;

  -- ── Staff and Manager sessions (user client): no writes, no cost reads ───
  for actor_name, actor in select * from (values ('staff', us), ('manager', um)) v(a, u) loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
    for p in select * from (values
      ('mat_upd_cost',   'w', format('update public.raw_materials set cost_per_unit = 99 where id = %L', mA)),
      ('mat_upd_stock',  'w', format('update public.raw_materials set current_stock = 999 where id = %L', mA)),
      ('mat_ins',        'w', format('insert into public.raw_materials (tenant_id, name, unit, cost_per_unit) values (%L, ''x'', ''g'', 1)', ta)),
      ('mat_del',        'w', format('delete from public.raw_materials where id = %L', mA3)),
      ('led_ins',        'w', format('insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity) values (%L, %L, ''adjust'', 5)', ta, mA)),
      ('led_upd',        'w', format('update public.inventory_transactions set quantity = 1 where id = %L', tx2)),
      ('led_del',        'w', format('delete from public.inventory_transactions where id = %L', tx1)),
      ('read_cost',      'r', format('select cost_per_unit from public.raw_materials where tenant_id = %L', ta)),
      ('read_mat_star',  'r', format('select * from public.raw_materials where tenant_id = %L', ta)),
      ('read_unit_cost', 'r', format('select unit_cost from public.inventory_transactions where tenant_id = %L', ta)),
      ('read_led_star',  'r', format('select * from public.inventory_transactions where tenant_id = %L', ta)),
      ('read_cost_total','r', format('select cost_total from public.order_items where order_id = %L', oa)),
      ('read_oi_star',   'r', format('select * from public.order_items where order_id = %L', oa)),
      ('oi_ins_forged',  'w', format('insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, cost_total) values (%L, %L, ''forged'', 1, 1, 1, 0)', oa, pa)),
      ('oi_upd_void',    'w', format('update public.order_items set void_made = true where id = %L', item1)),
      ('oi_upd_cost',    'w', format('update public.order_items set cost_total = 0 where id = %L', item1)),
      ('oi_del',         'w', format('delete from public.order_items where id = %L', item2))
    ) v(label, kind, q) loop
      ok := false;
      begin
        execute p.q;
        get diagnostics n = row_count;
        ok := (p.kind = 'r') or n > 0;
      exception when others then ok := false;
      end;
      if ok then hit := hit || (actor_name || ':' || p.label); end if;
    end loop;
    reset role;
  end loop;

  select count(*) into cnt_mat    from unnest(hit) h where h ~ '^staff:mat_';
  select count(*) into cnt_ledger from unnest(hit) h where h ~ '^staff:led_';
  select count(*) into cnt_read   from unnest(hit) h where h ~ '^staff:read_';
  select count(*) into cnt_forge  from unnest(hit) h where h ~ '^staff:oi_';
  r := r || jsonb_build_object('staff_cannot_write_materials', cnt_mat = 0);
  r := r || jsonb_build_object('staff_cannot_write_ledger', cnt_ledger = 0);
  r := r || jsonb_build_object('staff_cannot_read_cost', cnt_read = 0);
  r := r || jsonb_build_object('staff_cannot_forge_order_items', cnt_forge = 0);
  -- a manager's own browser session is no more privileged: stock is written by the admin client only
  r := r || jsonb_build_object('manager_user_client_cannot_write',
    (select count(*) = 0 from unnest(hit) h where h ~ '^manager:(mat_|led_|oi_)'));
  r := r || jsonb_build_object('manager_user_client_cannot_read_cost',
    (select count(*) = 0 from unnest(hit) h where h ~ '^manager:read_'));

  -- column privileges say the same thing
  r := r || jsonb_build_object('cost_columns_not_granted',
    not has_column_privilege('authenticated', 'public.raw_materials', 'cost_per_unit', 'select')
    and not has_column_privilege('authenticated', 'public.inventory_transactions', 'unit_cost', 'select')
    and not has_column_privilege('authenticated', 'public.order_items', 'cost_total', 'select')
    and not has_column_privilege('anon', 'public.raw_materials', 'cost_per_unit', 'select')
    and not has_table_privilege('authenticated', 'public.raw_materials', 'insert')
    and not has_table_privilege('authenticated', 'public.raw_materials', 'update')
    and not has_table_privilege('authenticated', 'public.inventory_transactions', 'insert')
    and not has_table_privilege('authenticated', 'public.order_items', 'insert')
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_items' and cmd = 'INSERT'));

  -- ── Staff still reads everything the POS and the catalog loader need ────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  ok := true;
  begin
    select count(*) into n from public.raw_materials where tenant_id = ta and archived_at is null;
    ok := ok and n >= 2;
    perform id, tenant_id, name, unit, current_stock, min_stock_alert, created_at, updated_at,
            category, purchase_unit, purchase_size, track_stock, archived_at
       from public.raw_materials where tenant_id = ta;
    perform id, tenant_id, raw_material_id, type, quantity, note, created_by, created_at,
            order_id, order_item_id, occurred_at, reason, legacy, ref_id
       from public.inventory_transactions where tenant_id = ta;
    select count(*) into n from public.order_items where order_id = oa;
    ok := ok and n >= 1;
    perform id, order_id, product_id, product_name, unit_price, quantity, subtotal, created_at,
            category_name, modifiers_snapshot, note, choices, void_made
       from public.order_items where order_id = oa;
    perform * from public.product_recipes where tenant_id = ta;
    select count(*) into n from public.choice_groups;            ok := ok and n = 1;
    select count(*) into n from public.choice_group_members;     ok := ok and n = 1;
    select count(*) into n from public.sweetness_levels;         ok := ok and n = 1;
    perform * from public.sweetness_amounts;
    perform * from public.product_sweetness;
    perform * from public.modifier_option_effects;
  exception when others then ok := false;
  end;
  reset role;
  r := r || jsonb_build_object('staff_still_reads_catalog', ok);

  -- ── anon reads nothing: stock, ledger, order_items, the six config tables ─
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  for p in select * from (values
    ('raw_materials'), ('inventory_transactions'), ('order_items'), ('choice_groups'),
    ('choice_group_members'), ('sweetness_levels'), ('sweetness_amounts'), ('product_sweetness'),
    ('modifier_option_effects')
  ) v(t) loop
    begin
      execute format('select 1 from public.%I limit 1', p.t);
      hit := hit || ('anon:' || p.t);   -- not even a permission error
    exception when others then null;
    end;
  end loop;
  reset role;
  r := r || jsonb_build_object('anon_reads_nothing', not exists (select 1 from unnest(hit) h where h like 'anon:%'));

  -- ── cross-tenant references, as the OWNER of tenant A (all of tenant B's ids) ──
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  for p in select * from (values
    ('cgm_group_b',     format('insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier) values (%L, %L, %L, ''x'', ''house'')', ta, gB, mA2)),
    ('cgm_material_b',  format('insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier) values (%L, %L, %L, ''x'', ''house'')', ta, gA, mB)),
    ('cgm_repoint',     format('update public.choice_group_members set group_id = %L where id = %L', gB, memA)),
    ('psw_product_b',   format('insert into public.product_sweetness (product_id, tenant_id, group_id, default_member_id) values (%L, %L, %L, %L)', pb, ta, gA, memA)),
    ('psw_group_b',     format('insert into public.product_sweetness (product_id, tenant_id, group_id, default_member_id) values (%L, %L, %L, %L)', pa2, ta, gB, memA)),
    ('psw_member_b',    format('insert into public.product_sweetness (product_id, tenant_id, group_id, default_member_id) values (%L, %L, %L, %L)', pa3, ta, gA, memB)),
    ('psw_allowed_b',   format('insert into public.product_sweetness (product_id, tenant_id, group_id, default_member_id, allowed_member_ids) values (%L, %L, %L, %L, array[%L]::uuid[])', pa4, ta, gA, memA, memB)),
    ('moe_option_b',    format('insert into public.modifier_option_effects (tenant_id, option_id, kind, group_id, amount) values (%L, %L, ''slot_add'', %L, 1)', ta, optB, gA)),
    ('moe_group_b',     format('insert into public.modifier_option_effects (tenant_id, option_id, kind, group_id, amount) values (%L, %L, ''slot_add'', %L, 1)', ta, optA, gB)),
    ('moe_material_b',  format('insert into public.modifier_option_effects (tenant_id, option_id, kind, raw_material_id, amount) values (%L, %L, ''material_add'', %L, 1)', ta, optA, mB)),
    ('swa_member_b',    format('insert into public.sweetness_amounts (tenant_id, product_id, member_id, level_id, amount) values (%L, %L, %L, %L, 1)', ta, pa, memB, lA)),
    ('swa_level_b',     format('insert into public.sweetness_amounts (tenant_id, product_id, member_id, level_id, amount) values (%L, %L, %L, %L, 1)', ta, pa, memA, lB)),
    ('swa_product_b',   format('insert into public.sweetness_amounts (tenant_id, product_id, member_id, level_id, amount) values (%L, %L, %L, %L, 1)', ta, pb, memA, lA)),
    ('rec_slot_group_b',format('insert into public.product_recipes (tenant_id, product_id, line_kind, group_id, quantity_used) values (%L, %L, ''slot'', %L, 1)', ta, pa, gB)),
    ('rec_slot_member_b',format('insert into public.product_recipes (tenant_id, product_id, line_kind, group_id, default_member_id, quantity_used) values (%L, %L, ''slot'', %L, %L, 1)', ta, pa2, gA, memB)),
    ('rec_fixed_mat_b', format('insert into public.product_recipes (tenant_id, product_id, raw_material_id, quantity_used) values (%L, %L, %L, 1)', ta, pa, mB)),
    ('rec_product_b',   format('insert into public.product_recipes (tenant_id, product_id, raw_material_id, quantity_used) values (%L, %L, %L, 1)', ta, pb, mA))
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

  -- positive controls: the same owner can still write valid rows of her own tenant
  ok := true;
  begin
    insert into public.choice_groups (tenant_id, name, kind) values (ta, 'ใหม่', 'other');
    insert into public.sweetness_levels (tenant_id, name) values (ta, 'ใหม่');
    insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier) values (ta, gA, mA2, 'A2', 'special');
    update public.choice_group_members set label = 'A-renamed' where id = memA;
    get diagnostics n = row_count; ok := ok and n = 1;
    insert into public.sweetness_amounts (tenant_id, product_id, member_id, level_id, amount) values (ta, pa, memA, lA, 2);
    insert into public.product_sweetness (product_id, tenant_id, group_id, default_member_id, allowed_member_ids)
      values (pa5, ta, gA, memA, array[memA]::uuid[]);
    insert into public.modifier_option_effects (tenant_id, option_id, kind, group_id, amount) values (ta, optA, 'slot_add', gA, 1);
    insert into public.modifier_option_effects (tenant_id, option_id, kind, raw_material_id, amount) values (ta, optA, 'material_add', mA, 1);
    insert into public.product_recipes (tenant_id, product_id, raw_material_id, quantity_used) values (ta, pa, mA, 3);
    insert into public.product_recipes (tenant_id, product_id, line_kind, group_id, default_member_id, quantity_used) values (ta, pa, 'slot', gA, memA, 1);
  exception when others then ok := false;
  end;
  reset role;
  r := r || jsonb_build_object('no_cross_tenant_config_refs', not exists (select 1 from unnest(hit) h where h like 'xtenant:%'));
  r := r || jsonb_build_object('owner_still_writes_own_config', ok);

  -- ── service role (the admin client) still reads and writes costs and stock ──
  set local role service_role;
  ok := true;
  begin
    select cost_per_unit into cost from public.raw_materials where id = mS;
    select unit_cost into ucost from public.inventory_transactions where id = txS;
    select cost_total into ctotal from public.order_items where id = itemS;
    ok := ok and cost = 0.5 and ucost = 0.5 and ctotal = 7.25;
    update public.raw_materials set cost_per_unit = 0.75, current_stock = 90 where id = mS;
    get diagnostics n = row_count; ok := ok and n = 1;
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, unit_cost)
      values (ta, mA, 'adjust', -10, 0.75);
  exception when others then ok := false;
  end;
  reset role;
  r := r || jsonb_build_object('manager_reads_costs_via_service', ok);

  r := r || jsonb_build_object('_succeeded', to_jsonb(hit));
  raise exception 'RESULT %', r;
end;
$$;
