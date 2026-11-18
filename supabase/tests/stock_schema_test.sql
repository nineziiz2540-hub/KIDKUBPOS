-- Round D1 migration A (stock schema, ledger, frozen old costs) — DB test.
-- Run the whole file through execute_sql AFTER the migration. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back. Every key must be true.
-- The migration's two data steps (opening rows, frozen costs) only touch rows that exist when it
-- runs, so the test replays the same two statements (verbatim) over the rows it builds itself.
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();  -- owner, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A
  ta uuid;
  pa uuid; pb uuid;
  oa uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid;
  g1 uuid; g2 uuid;
  cgm1 uuid; cgm2 uuid;
  lv1 uuid;
  opt uuid; modf uuid;
  item1 uuid;
  sa uuid;
  tx1 uuid;
  n int;
  v numeric;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-ss-a-' || ua || '@example.test', 'x', now(), now()),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-ss-s-' || us || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA SS A', true);
  select tenant_id into ta from public.profiles where id = ua;
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us, ta, 'QA Staff', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';

  sa := public.shift_open(ta, ua, array[0]::numeric[], null);
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'ลาเต้', 55, true) returning id into pa;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'น้ำเปล่า', 10, true) returning id into pb;

  -- materials: m1 has stock 12 (opening row expected), m2 stock 0 (none), m3 recipe material
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, min_stock_alert)
  values (ta, 'เมล็ด A', 'g', 0.5, 12, 0) returning id into m1;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, min_stock_alert)
  values (ta, 'เมล็ด B', 'g', 0.7, 0, 0) returning id into m2;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, min_stock_alert)
  values (ta, 'เมล็ด C', 'g', 0.9, 5, 0) returning id into m3;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, min_stock_alert)
  values (ta, 'นมผง', 'g', 0.1, 0, 0) returning id into m4;

  -- old-style ledger row, as the deployed app wrote it (legacy by definition)
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, legacy)
  values (ta, m3, 'deduct', -2, true);

  -- ── new columns have their defaults ─────────────────────────────────────
  r := r || jsonb_build_object('material_defaults',
    (select category = 'วัตถุดิบทั่วไป' and track_stock and archived_at is null
            and purchase_unit is null and purchase_size is null
     from public.raw_materials where id = m1));

  -- ── opening rows: replay of the migration statement ─────────────────────
  insert into public.inventory_transactions
    (tenant_id, raw_material_id, type, quantity, unit_cost, note, occurred_at)
  select rm.tenant_id, rm.id, 'opening', rm.current_stock, rm.cost_per_unit, 'ยอดตั้งต้นรอบ D', now()
  from public.raw_materials rm
  where rm.current_stock > 0
    and not exists (select 1 from public.inventory_transactions t
                    where t.raw_material_id = rm.id and t.type = 'opening' and not t.legacy);
  r := r || jsonb_build_object('opening_rows',
    (select count(*) = 1 and bool_and(quantity = 12 and unit_cost = 0.5 and not legacy)
     from public.inventory_transactions where raw_material_id = m1 and type = 'opening')
    and (select count(*) = 0 from public.inventory_transactions where raw_material_id = m2)
    and (select current_stock = (select coalesce(sum(quantity), 0) from public.inventory_transactions
                                 where raw_material_id = m1 and not legacy)
         from public.raw_materials where id = m1));

  -- ── old rows are legacy; the new check accepts old types only for legacy rows ──
  ok := false;
  begin
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity)
    values (ta, m3, 'deduct', -1);
  exception when check_violation then ok := true; end;
  r := r || jsonb_build_object('old_rows_legacy',
    ok
    and (select legacy from public.inventory_transactions where raw_material_id = m3 and type = 'deduct')
    and (select count(*) = 0 from public.inventory_transactions where type = 'deduct' and not legacy));

  -- the old type check is gone: opening and sale rows insert fine
  ok := false;
  begin
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity)
    values (ta, m3, 'opening', 5), (ta, m3, 'sale', -1), (ta, m3, 'waste', -1);
    ok := true;
  exception when others then ok := false; end;
  r := r || jsonb_build_object('old_type_check_gone', ok);

  -- the unique sale-per-item index (non-legacy) rejects a repeat
  insert into public.orders (tenant_id, created_by, status, payment_method, total, subtotal, shift_id)
  values (ta, ua, 'completed', 'cash', 110, 110, sa) returning id into oa;
  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (oa, pa, 'ลาเต้', 55, 2, 110) returning id into item1;
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id, order_item_id)
  values (ta, m3, 'sale', -1, oa, item1);
  ok := false;
  begin
    insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, order_id, order_item_id)
    values (ta, m3, 'sale', -1, oa, item1);
  exception when unique_violation then ok := true; end;
  r := r || jsonb_build_object('one_sale_row_per_item', ok);

  -- ── choice groups / members ─────────────────────────────────────────────
  insert into public.choice_groups (tenant_id, name, kind) values (ta, 'เมล็ดกาแฟ', 'bean') returning id into g1;
  insert into public.choice_groups (tenant_id, name, kind) values (ta, 'ผงมัทฉะ', 'matcha') returning id into g2;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, is_default)
  values (ta, g1, m1, 'A', 'house', true) returning id into cgm1;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier)
  values (ta, g1, m2, 'B', 'special') returning id into cgm2;
  ok := false;
  begin
    insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, is_default)
    values (ta, g1, m3, 'C', 'house', true);
  exception when unique_violation then ok := true; end;
  r := r || jsonb_build_object('one_default_member', ok);

  -- ── recipe shape ────────────────────────────────────────────────────────
  ok := false;
  begin
    insert into public.product_recipes (tenant_id, product_id, raw_material_id, quantity_used, line_kind, group_id)
    values (ta, pa, m1, 18, 'slot', g1);
  exception when check_violation then ok := true; end;
  declare ok2 boolean := false; begin
    begin
      insert into public.product_recipes (tenant_id, product_id, raw_material_id, quantity_used, line_kind)
      values (ta, pa, null, 18, 'fixed');
    exception when check_violation then ok2 := true; end;
    r := r || jsonb_build_object('recipe_check', ok and ok2);
  end;

  -- a legal slot line, then a second slot line for the same product+group is rejected
  insert into public.product_recipes (tenant_id, product_id, raw_material_id, quantity_used, line_kind, group_id, default_member_id)
  values (ta, pa, null, 18, 'slot', g1, cgm1);
  ok := false;
  begin
    insert into public.product_recipes (tenant_id, product_id, raw_material_id, quantity_used, line_kind, group_id)
    values (ta, pa, null, 20, 'slot', g1);
  exception when unique_violation then ok := true; end;
  -- but the same group on another product, and another group on the same product, are fine
  insert into public.product_recipes (tenant_id, product_id, raw_material_id, quantity_used, line_kind, group_id)
  values (ta, pb, null, 18, 'slot', g1), (ta, pa, null, 2, 'slot', g2);
  r := r || jsonb_build_object('one_slot_per_group', ok);

  -- ── sweetness ───────────────────────────────────────────────────────────
  insert into public.sweetness_levels (tenant_id, name, is_default) values (ta, 'หวานปกติ', true) returning id into lv1;
  ok := false;
  begin
    insert into public.sweetness_levels (tenant_id, name, is_default) values (ta, 'หวานน้อย', true);
  exception when unique_violation then ok := true; end;
  r := r || jsonb_build_object('one_default_level', ok);

  insert into public.sweetness_amounts (tenant_id, product_id, member_id, level_id, amount)
  values (ta, null, cgm1, lv1, 10);
  ok := false;
  begin
    insert into public.sweetness_amounts (tenant_id, product_id, member_id, level_id, amount)
    values (ta, null, cgm1, lv1, 12);
  exception when unique_violation then ok := true; end;
  r := r || jsonb_build_object('standard_table_unique', ok);

  -- ── modifier effects: kind is required and shape-checked ────────────────
  insert into public.modifiers (tenant_id, name) values (ta, 'เพิ่ม') returning id into modf;
  insert into public.modifier_options (modifier_id, name) values (modf, 'เพิ่มช็อต') returning id into opt;
  insert into public.modifier_option_effects (tenant_id, option_id, kind, group_id, amount)
  values (ta, opt, 'slot_add', g1, 9);
  ok := false;
  begin
    insert into public.modifier_option_effects (tenant_id, option_id, kind, raw_material_id, amount)
    values (ta, opt, null, m4, 9);
  exception when not_null_violation then ok := true; end;
  declare ok2 boolean := false; begin
    begin
      insert into public.modifier_option_effects (tenant_id, option_id, kind, raw_material_id, group_id, amount)
      values (ta, opt, 'material_add', m4, g1, 9);
    exception when check_violation then ok2 := true; end;
    r := r || jsonb_build_object('effects_kind_required', ok and ok2);
  end;

  -- ── RLS: staff reads but cannot write ───────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  select count(*) into n from public.choice_groups;
  ok := false;
  begin
    insert into public.choice_groups (tenant_id, name, kind) values (ta, 'ห้าม', 'other');
  exception when others then ok := true; end;
  reset role;
  r := r || jsonb_build_object('rls_staff_reads_not_writes', n = 2 and ok);

  -- the owner can write
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := false;
  begin
    insert into public.choice_groups (tenant_id, name, kind) values (ta, 'เจ้าของเพิ่ม', 'other');
    ok := true;
  exception when others then ok := false; end;
  reset role;
  r := r || jsonb_build_object('rls_owner_writes', ok);

  -- ── frozen cost: replay of the migration statement ──────────────────────
  -- recipe for pb: 18 g of m1 (0.5/g) → qty 2 → 18. pa has only slot lines → stays null.
  insert into public.product_recipes (tenant_id, product_id, raw_material_id, quantity_used)
  values (ta, pb, m1, 18);
  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (oa, pb, 'น้ำเปล่า', 10, 2, 20);
  update public.order_items oi
  set cost_total = r2.unit_cost * oi.quantity
  from (
    select pr.product_id, sum(pr.quantity_used * rm.cost_per_unit) as unit_cost
    from public.product_recipes pr
    join public.raw_materials rm on rm.id = pr.raw_material_id
    group by pr.product_id
  ) r2
  where r2.product_id = oi.product_id and oi.cost_total is null;
  select cost_total into v from public.order_items where order_id = oa and product_id = pb;
  r := r || jsonb_build_object('frozen_cost',
    v = 18 and (select cost_total is null from public.order_items where id = item1));

  raise exception 'RESULT %', r;
end $$;
