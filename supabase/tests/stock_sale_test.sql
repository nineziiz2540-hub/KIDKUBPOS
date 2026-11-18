-- order_record stock (round D1, Task 4) — DB test.
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back.
-- Every key in the JSON must be true. "As service" = default role (auth.uid() is null).
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();   -- owner, tenant A
  ub uuid := gen_random_uuid();   -- owner, tenant B (foreign materials)
  ta uuid; tb uuid;
  pa uuid; sa uuid;
  kenya uuid; milk uuid; ice uuid; small uuid; archived uuid; foreign_m uuid;
  ref uuid;
  first record; again record; o record;
  cash_order jsonb;
  items jsonb;
  ts timestamptz;
  n_before int;
  bal_before numeric;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-ss-a-' || ua || '@example.test', 'x', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-ss-b-' || ub || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA SS A', true);
  perform public.create_tenant_and_owner(ub, 'QA SS B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'ลาเต้', 55, true) returning id into pa;
  sa := public.shift_open(ta, ua, array[0]::numeric[], null);

  -- materials (each tracked one gets an opening ledger row equal to its balance)
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (ta, 'เมล็ดเคนย่า', 'g', 0.8, 1000, true) returning id into kenya;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (ta, 'นมสด', 'ml', 0.05, 5000, true) returning id into milk;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (ta, 'น้ำแข็ง', 'g', 0.5, 0, false) returning id into ice;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (ta, 'ผงเล็ก', 'g', 1, 5, true) returning id into small;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock, archived_at)
  values (ta, 'เก่า', 'g', 1, 100, true, now()) returning id into archived;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (tb, 'ของร้านอื่น', 'g', 1, 500, true) returning id into foreign_m;
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, unit_cost, note)
  select tenant_id, id, 'opening', current_stock, cost_per_unit, 'test'
    from public.raw_materials where id in (kenya, milk, small, archived, foreign_m);

  cash_order := jsonb_build_object(
    'payment_method', 'cash', 'order_type', 'dine_in', 'subtotal', 55, 'total', 55,
    'cash_received', 100, 'change_amount', 45, 'discount_type', null, 'discount_value', null,
    'discount_amount', 0, 'discount_reason', null, 'discount_approved_by', null,
    'customer_id', null, 'note', null);

  -- ── deducts_once: latte (kenya 27, milk 180) + replay ───────────────────────
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'category_name', null, 'modifiers_snapshot', null, 'note', null,
    'choices', jsonb_build_object('v', 1, 'beans', 'kenya'),
    'stock', jsonb_build_array(
      jsonb_build_object('material_id', kenya, 'qty', 27),
      jsonb_build_object('material_id', milk, 'qty', 180))));
  ref := gen_random_uuid();
  select * into first from public.order_record(ta, ua, ref, cash_order, items, null, null, '[]', null);
  select * into again from public.order_record(ta, ua, ref, cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('deducts_once',
    first.created and not again.created
    and (select current_stock = 973 from public.raw_materials where id = kenya)
    and (select current_stock = 4820 from public.raw_materials where id = milk)
    and (select count(*) = 1 and sum(quantity) = -27 from public.inventory_transactions
          where raw_material_id = kenya and type = 'sale' and order_id = first.order_id)
    and (select count(*) = 1 and sum(quantity) = -180 from public.inventory_transactions
          where raw_material_id = milk and type = 'sale' and order_id = first.order_id));

  -- cost frozen (27*0.8 + 180*0.05 = 30.6), choices stored, ledger fields
  r := r || jsonb_build_object('cost_and_choices_stored',
    (select cost_total = 30.6 and choices = jsonb_build_object('v', 1, 'beans', 'kenya')
       from public.order_items where order_id = first.order_id)
    and (select bool_and(unit_cost = 0.8 and created_by = ua and order_item_id is not null
                         and occurred_at = (select created_at from public.orders where id = first.order_id))
           from public.inventory_transactions
          where raw_material_id = kenya and type = 'sale' and order_id = first.order_id));

  -- ── offline_time ────────────────────────────────────────────────────────────
  ts := now() - interval '40 minutes';
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', ts, 'queue_number', 8, 'shift_id', sa, 'override', null));
  r := r || jsonb_build_object('offline_time',
    o.created
    and (select count(*) = 2 and bool_and(occurred_at = ts) from public.inventory_transactions
          where order_id = o.order_id and type = 'sale'));

  -- ── untracked_cost_only: ice 100 g @0.5 ─────────────────────────────────────
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'stock', jsonb_build_array(jsonb_build_object('material_id', ice, 'qty', 100))));
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('untracked_cost_only',
    o.created
    and not exists (select 1 from public.inventory_transactions where raw_material_id = ice)
    and (select current_stock = 0 from public.raw_materials where id = ice)
    and (select cost_total = 50 from public.order_items where order_id = o.order_id));

  -- ── negative_allowed: 5 g in stock, sale of 18 g ────────────────────────────
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'stock', jsonb_build_array(jsonb_build_object('material_id', small, 'qty', 18))));
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('negative_allowed',
    o.created and (select current_stock = -13 from public.raw_materials where id = small));

  -- ── foreign_material_skipped ────────────────────────────────────────────────
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'stock', jsonb_build_array(jsonb_build_object('material_id', foreign_m, 'qty', 50))));
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('foreign_material_skipped',
    o.created
    and (select current_stock = 500 from public.raw_materials where id = foreign_m)
    and not exists (select 1 from public.inventory_transactions where raw_material_id = foreign_m and type = 'sale')
    and (select cost_total is null from public.order_items where order_id = o.order_id));

  -- ── bad_stock_lines_skipped: archived, qty 0, negative, text, garbage id, nulls ──
  select current_stock into bal_before from public.raw_materials where id = kenya;
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'stock', jsonb_build_array(
      jsonb_build_object('material_id', archived, 'qty', 10),
      jsonb_build_object('material_id', kenya, 'qty', 0),
      jsonb_build_object('material_id', kenya, 'qty', -3),
      jsonb_build_object('material_id', kenya, 'qty', 'abc'),
      jsonb_build_object('material_id', kenya, 'qty', '5'),
      jsonb_build_object('material_id', kenya, 'qty', 0.0001),
      jsonb_build_object('material_id', kenya),
      jsonb_build_object('material_id', 'not-a-uuid', 'qty', 5),
      jsonb_build_object('qty', 5),
      to_jsonb('junk'::text),
      jsonb_build_object('material_id', milk, 'qty', 10))));
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('bad_stock_lines_skipped',
    o.created
    and (select current_stock = 100 from public.raw_materials where id = archived)
    and (select current_stock = bal_before from public.raw_materials where id = kenya)
    and (select count(*) = 1 and sum(quantity) = -10 from public.inventory_transactions
          where order_id = o.order_id and type = 'sale' and raw_material_id = milk)
    and (select count(*) = 1 from public.inventory_transactions where order_id = o.order_id)
    and (select cost_total = 0.5 from public.order_items where order_id = o.order_id));

  -- a stock value that is not an array, and a null choices, are ignored
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'choices', null, 'stock', 'oops'));
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('stock_not_array_ignored',
    o.created and (select choices is null and cost_total is null from public.order_items where order_id = o.order_id));

  -- ── same_material_twice_one_row: kenya 18 + kenya 9 ─────────────────────────
  select current_stock into bal_before from public.raw_materials where id = kenya;
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'stock', jsonb_build_array(
      jsonb_build_object('material_id', kenya, 'qty', 18),
      jsonb_build_object('material_id', kenya, 'qty', 9))));
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('same_material_twice_one_row',
    o.created
    and (select count(*) = 1 and sum(quantity) = -27 from public.inventory_transactions
          where order_id = o.order_id and raw_material_id = kenya and type = 'sale')
    and (select current_stock = bal_before - 27 from public.raw_materials where id = kenya)
    and (select cost_total = 21.6 from public.order_items where order_id = o.order_id));

  -- ── two items in one bill share a material: one row per item ────────────────
  items := jsonb_build_array(
    jsonb_build_object('product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
      'stock', jsonb_build_array(jsonb_build_object('material_id', kenya, 'qty', 10))),
    jsonb_build_object('product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
      'stock', jsonb_build_array(jsonb_build_object('material_id', kenya, 'qty', 20))));
  select current_stock into bal_before from public.raw_materials where id = kenya;
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('two_items_same_material',
    o.created
    and (select count(*) = 2 and sum(quantity) = -30 from public.inventory_transactions
          where order_id = o.order_id and raw_material_id = kenya and type = 'sale')
    and (select current_stock = bal_before - 30 from public.raw_materials where id = kenya));

  -- ── no_stock_key_no_deduction (pre-D1 callers) ──────────────────────────────
  select count(*) into n_before from public.inventory_transactions where tenant_id = ta;
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'category_name', null, 'modifiers_snapshot', null, 'note', null));
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('no_stock_key_no_deduction',
    o.created
    and (select count(*) = n_before from public.inventory_transactions where tenant_id = ta)
    and (select cost_total is null and choices is null from public.order_items where order_id = o.order_id));

  -- ── balance_equals_ledger ───────────────────────────────────────────────────
  r := r || jsonb_build_object('balance_equals_ledger',
    (select bool_and(rm.current_stock = coalesce((
              select sum(t.quantity) from public.inventory_transactions t
               where t.raw_material_id = rm.id and not t.legacy), 0))
       from public.raw_materials rm where rm.id in (kenya, milk, small, ice, archived, foreign_m)));

  raise exception 'RESULT %', r;
end;
$$;
