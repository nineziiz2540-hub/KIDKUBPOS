-- order_void / stock_waste (round D1, Task 7) — DB test.
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back.
-- Every key in the JSON must be true. "As service" = default role (auth.uid() is null).
-- Dry run before the migration is applied: run the migration text and this block in ONE call.
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();   -- owner, tenant A
  ub uuid := gen_random_uuid();   -- owner, tenant B (foreign material)
  ta uuid; tb uuid;
  pa uuid;
  kenya uuid; milk uuid; ice uuid; archived uuid; foreign_m uuid;
  o1 record; o2 record; o3 record; o4 record; o5 record;
  cash_order jsonb;
  items jsonb;
  i1 uuid; i2 uuid;
  ref uuid := gen_random_uuid();
  n_before int;
  k_before numeric; m_before numeric;
  ok boolean;
  caught text;
  -- bags, bill-level stock (round D2a)
  bag uuid;
  o6 record; o7 record; o8 record; o9 record;
  bill_order jsonb;
  b_before numeric;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-sv-a-' || ua || '@example.test', 'x', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-sv-b-' || ub || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA SV A', true);
  perform public.create_tenant_and_owner(ub, 'QA SV B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'ลาเต้', 55, true) returning id into pa;
  perform public.shift_open(ta, ua, array[0]::numeric[], null);

  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (ta, 'เมล็ดเคนย่า', 'g', 0.8, 10000, true) returning id into kenya;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (ta, 'นมสด', 'ml', 0.05, 50000, true) returning id into milk;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (ta, 'น้ำแข็ง', 'g', 0.5, 0, false) returning id into ice;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock, archived_at)
  values (ta, 'เก่า', 'g', 1, 100, true, now()) returning id into archived;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock)
  values (tb, 'ของร้านอื่น', 'g', 1, 500, true) returning id into foreign_m;
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, unit_cost, note)
  select tenant_id, id, 'opening', current_stock, cost_per_unit, 'test'
    from public.raw_materials where id in (kenya, milk, archived, foreign_m);

  cash_order := jsonb_build_object(
    'payment_method', 'cash', 'order_type', 'dine_in', 'subtotal', 55, 'total', 55,
    'cash_received', 100, 'change_amount', 45, 'discount_type', null, 'discount_value', null,
    'discount_amount', 0, 'discount_reason', null, 'discount_approved_by', null,
    'customer_id', null, 'note', null);

  -- ── void_not_made_restocks: 1 cup, kenya 27 / milk 180, "none", as the real caller ──
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'stock', jsonb_build_array(jsonb_build_object('material_id', kenya, 'qty', 27),
                               jsonb_build_object('material_id', milk, 'qty', 180))));
  select * into o1 from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o1.order_id;
  set local role service_role;
  perform public.order_void(ta, ua, ua, o1.order_id, 'ลูกค้ายกเลิก', jsonb_build_object(i1::text, 'none'));
  reset role;
  r := r || jsonb_build_object('void_not_made_restocks',
    (select status = 'cancelled' and cancelled_by = ua and cancelled_approved_by = ua
            and cancel_reason = 'ลูกค้ายกเลิก' and cancelled_at is not null
       from public.orders where id = o1.order_id)
    and (select current_stock = 10000 from public.raw_materials where id = kenya)
    and (select current_stock = 50000 from public.raw_materials where id = milk)
    and (select count(*) = 1 and sum(quantity) = 27 and bool_and(unit_cost = 0.8 and order_id = o1.order_id
                and order_item_id = i1 and created_by = ua and not legacy)
          from public.inventory_transactions where raw_material_id = kenya and type = 'void_restock')
    and (select count(*) = 1 and sum(quantity) = 180 from public.inventory_transactions
          where raw_material_id = milk and type = 'void_restock')
    and (select void_made is not true from public.order_items where id = i1));

  -- ── void_twice_noop: a second call raises not_completed and changes nothing ──
  select count(*) into n_before from public.inventory_transactions where tenant_id = ta;
  caught := null;
  begin
    perform public.order_void(ta, ua, ua, o1.order_id, 'อีกครั้ง', jsonb_build_object(i1::text, 'none'));
  exception when others then caught := sqlerrm;
  end;
  r := r || jsonb_build_object('void_twice_noop',
    caught = 'not_completed'
    and (select count(*) = n_before from public.inventory_transactions where tenant_id = ta)
    and (select current_stock = 10000 from public.raw_materials where id = kenya)
    and (select cancel_reason = 'ลูกค้ายกเลิก' from public.orders where id = o1.order_id));

  -- ── void_made_keeps_stock_and_flags: "all" → no restock row, void_made = true ──
  select * into o2 from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o2.order_id;
  perform public.order_void(ta, ua, ua, o2.order_id, 'เสียแล้ว', jsonb_build_object(i1::text, 'all'));
  r := r || jsonb_build_object('void_made_keeps_stock_and_flags',
    (select current_stock = 9973 from public.raw_materials where id = kenya)
    and (select current_stock = 49820 from public.raw_materials where id = milk)
    and not exists (select 1 from public.inventory_transactions where order_id = o2.order_id and type = 'void_restock')
    and (select void_made from public.order_items where id = i1)
    and (select status = 'cancelled' from public.orders where id = o2.order_id));

  -- ── void_partial: qty 3 (kenya 81, milk 100 whole line), made 1 → restock 2/3 ──
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 3, 'subtotal', 165,
    'stock', jsonb_build_array(jsonb_build_object('material_id', kenya, 'qty', 81),
                               jsonb_build_object('material_id', milk, 'qty', 100))));
  select * into o3 from public.order_record(ta, ua, gen_random_uuid(),
    cash_order || jsonb_build_object('subtotal', 165, 'total', 165, 'cash_received', 200, 'change_amount', 35),
    items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o3.order_id;
  select current_stock into k_before from public.raw_materials where id = kenya;
  select current_stock into m_before from public.raw_materials where id = milk;
  perform public.order_void(ta, ua, ua, o3.order_id, 'บางแก้ว', jsonb_build_object(i1::text, 1));
  r := r || jsonb_build_object('void_partial',
    (select quantity = 54 from public.inventory_transactions
      where order_id = o3.order_id and raw_material_id = kenya and type = 'void_restock')
    and (select quantity = 66.667 from public.inventory_transactions
          where order_id = o3.order_id and raw_material_id = milk and type = 'void_restock')
    and (select current_stock = k_before + 54 from public.raw_materials where id = kenya)
    and (select current_stock = m_before + 66.667 from public.raw_materials where id = milk)
    and (select void_made from public.order_items where id = i1));

  -- ── void_invalid_made: missing item / count > quantity / fraction / text / not an object ──
  items := jsonb_build_array(
    jsonb_build_object('product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 2, 'subtotal', 110,
      'stock', jsonb_build_array(jsonb_build_object('material_id', kenya, 'qty', 54))),
    jsonb_build_object('product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
      'stock', jsonb_build_array(jsonb_build_object('material_id', milk, 'qty', 10))));
  select * into o4 from public.order_record(ta, ua, gen_random_uuid(),
    cash_order || jsonb_build_object('subtotal', 165, 'total', 165, 'cash_received', 200, 'change_amount', 35),
    items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o4.order_id and quantity = 2;
  select id into i2 from public.order_items where order_id = o4.order_id and quantity = 1;
  select count(*) into n_before from public.inventory_transactions where tenant_id = ta;
  ok := true;
  -- missing item
  caught := null;
  begin
    perform public.order_void(ta, ua, ua, o4.order_id, 'x', jsonb_build_object(i1::text, 'none'));
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'invalid_made';
  -- count above quantity
  caught := null;
  begin
    perform public.order_void(ta, ua, ua, o4.order_id, 'x', jsonb_build_object(i1::text, 3, i2::text, 'none'));
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'invalid_made';
  -- fraction
  caught := null;
  begin
    perform public.order_void(ta, ua, ua, o4.order_id, 'x', jsonb_build_object(i1::text, 1.5, i2::text, 'none'));
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'invalid_made';
  -- text / wrong type
  caught := null;
  begin
    perform public.order_void(ta, ua, ua, o4.order_id, 'x', jsonb_build_object(i1::text, 'abc', i2::text, 'none'));
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'invalid_made';
  -- negative
  caught := null;
  begin
    perform public.order_void(ta, ua, ua, o4.order_id, 'x', jsonb_build_object(i1::text, -1, i2::text, 'none'));
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'invalid_made';
  -- not an object
  caught := null;
  begin
    perform public.order_void(ta, ua, ua, o4.order_id, 'x', '[]'::jsonb);
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'invalid_made';
  r := r || jsonb_build_object('void_invalid_made',
    ok
    and (select status = 'completed' and cancelled_at is null from public.orders where id = o4.order_id)
    and (select count(*) = n_before from public.inventory_transactions where tenant_id = ta));

  -- mixed answers on the same order: line 1 "all", line 2 count 0 → only line 2 is restocked
  perform public.order_void(ta, ua, ua, o4.order_id, 'ผสม', jsonb_build_object(i1::text, 'all', i2::text, 0));
  r := r || jsonb_build_object('void_mixed_items',
    (select void_made from public.order_items where id = i1)
    and (select void_made is not true from public.order_items where id = i2)
    and not exists (select 1 from public.inventory_transactions where order_item_id = i1 and type = 'void_restock')
    and (select count(*) = 1 and sum(quantity) = 10 from public.inventory_transactions
          where order_item_id = i2 and type = 'void_restock'));

  -- ── void_archived_still_restocked: material archived after the sale is put back ──
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'stock', jsonb_build_array(jsonb_build_object('material_id', milk, 'qty', 40))));
  select * into o5 from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o5.order_id;
  update public.raw_materials set archived_at = now() where id = milk;
  select current_stock into m_before from public.raw_materials where id = milk;
  perform public.order_void(ta, ua, ua, o5.order_id, 'เก็บเข้าคลังแล้ว', jsonb_build_object(i1::text, 'none'));
  r := r || jsonb_build_object('void_archived_still_restocked',
    (select current_stock = m_before + 40 from public.raw_materials where id = milk));
  update public.raw_materials set archived_at = null where id = milk;

  -- ── void_guards: reason, approver, actor ──
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55));
  select * into o5 from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o5.order_id;
  ok := true;
  caught := null;
  begin perform public.order_void(ta, ua, ua, o5.order_id, '  ', jsonb_build_object(i1::text, 'none'));
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'reason_required';
  caught := null;
  begin perform public.order_void(ta, ua, ub, o5.order_id, 'x', jsonb_build_object(i1::text, 'none'));
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'forbidden';
  caught := null;
  begin perform public.order_void(tb, ub, ub, o5.order_id, 'x', jsonb_build_object(i1::text, 'none'));
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'not_completed';
  r := r || jsonb_build_object('void_guards',
    ok and (select status = 'completed' from public.orders where id = o5.order_id));
  -- a pre-D1 order (no sale rows) voids with nothing restocked
  select count(*) into n_before from public.inventory_transactions where tenant_id = ta;
  perform public.order_void(ta, ua, ua, o5.order_id, 'ก่อน D1', jsonb_build_object(i1::text, 'none'));
  r := r || jsonb_build_object('void_pre_d1_no_restock',
    (select status = 'cancelled' from public.orders where id = o5.order_id)
    and (select count(*) = n_before from public.inventory_transactions where tenant_id = ta));

  -- ── waste_rows_and_balance ──
  select current_stock into k_before from public.raw_materials where id = kenya;
  select current_stock into m_before from public.raw_materials where id = milk;
  select count(*) into n_before from public.inventory_transactions where tenant_id = ta;
  set local role service_role;
  perform public.stock_waste(ta, ua, jsonb_build_array(
      jsonb_build_object('material_id', kenya, 'qty', 10),
      jsonb_build_object('material_id', kenya, 'qty', 2),
      jsonb_build_object('material_id', milk, 'qty', 5.5),
      jsonb_build_object('material_id', foreign_m, 'qty', 50),
      jsonb_build_object('material_id', archived, 'qty', 50),
      jsonb_build_object('material_id', ice, 'qty', 50),
      jsonb_build_object('material_id', milk, 'qty', 0),
      jsonb_build_object('material_id', milk, 'qty', -3),
      jsonb_build_object('material_id', milk, 'qty', 10000000),
      jsonb_build_object('material_id', milk, 'qty', '7'),
      jsonb_build_object('material_id', 'not-a-uuid', 'qty', 5),
      jsonb_build_object('qty', 5),
      to_jsonb('junk'::text)),
    'ยกเลิกบิลพักหลังชง', ref);
  reset role;
  r := r || jsonb_build_object('waste_rows_and_balance',
    (select current_stock = k_before - 12 from public.raw_materials where id = kenya)
    and (select current_stock = m_before - 5.5 from public.raw_materials where id = milk)
    and (select count(*) = 2 from public.inventory_transactions where tenant_id = ta and type = 'waste')
    and (select quantity = -12 and unit_cost = 0.8 and reason = 'ยกเลิกบิลพักหลังชง' and ref_id = ref
                and created_by = ua and not legacy
          from public.inventory_transactions where raw_material_id = kenya and type = 'waste')
    and (select quantity = -5.5 from public.inventory_transactions where raw_material_id = milk and type = 'waste')
    and (select count(*) = n_before + 2 from public.inventory_transactions where tenant_id = ta)
    and (select current_stock = 500 from public.raw_materials where id = foreign_m)
    and (select current_stock = 100 from public.raw_materials where id = archived));

  ok := true;
  caught := null;
  begin perform public.stock_waste(ta, ua, '[]'::jsonb, '', ref);
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'reason_required';
  caught := null;
  begin perform public.stock_waste(ta, ua, '{}'::jsonb, 'x', ref);
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'invalid_lines';
  caught := null;
  begin perform public.stock_waste(ta, ub, '[]'::jsonb, 'x', ref);
  exception when others then caught := sqlerrm; end;
  ok := ok and caught = 'forbidden';
  r := r || jsonb_build_object('waste_guards', ok);

  -- ── grants: service role only ──
  r := r || jsonb_build_object('service_role_only',
    has_function_privilege('service_role', 'public.order_void(uuid,uuid,uuid,uuid,text,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.stock_waste(uuid,uuid,jsonb,text,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.order_void(uuid,uuid,uuid,uuid,text,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.order_void(uuid,uuid,uuid,uuid,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.stock_waste(uuid,uuid,jsonb,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.stock_waste(uuid,uuid,jsonb,text,uuid)', 'execute'));

  -- ── void_restock_balance_equals_ledger ──
  r := r || jsonb_build_object('void_restock_balance_equals_ledger',
    (select bool_and(rm.current_stock = coalesce((
              select sum(t.quantity) from public.inventory_transactions t
               where t.raw_material_id = rm.id and not t.legacy), 0))
       from public.raw_materials rm where rm.id in (kenya, milk, archived, foreign_m)));

  -- ── Bags (round D2a): bill-level stock goes back on every void, made or not, once ──
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, track_stock, category)
  values (ta, 'ถุงหิ้ว', 'ชิ้น', 1.5, 100, true, 'บรรจุภัณฑ์') returning id into bag;
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, unit_cost, note)
  values (ta, bag, 'opening', 100, 1.5, 'test');
  bill_order := cash_order || jsonb_build_object('bags', 2, 'stock', jsonb_build_array(
    jsonb_build_object('material_id', bag, 'qty', 2)));

  -- void_none_restocks_bags: 1 cup (kenya 27 / milk 180) + 2 bags, "none", as the real caller
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 1, 'subtotal', 55,
    'stock', jsonb_build_array(jsonb_build_object('material_id', kenya, 'qty', 27),
                               jsonb_build_object('material_id', milk, 'qty', 180))));
  select current_stock into k_before from public.raw_materials where id = kenya;
  select * into o6 from public.order_record(ta, ua, gen_random_uuid(), bill_order, items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o6.order_id;
  ok := (select current_stock = 98 from public.raw_materials where id = bag);
  set local role service_role;
  perform public.order_void(ta, ua, ua, o6.order_id, 'ลูกค้ายกเลิก', jsonb_build_object(i1::text, 'none'));
  reset role;
  r := r || jsonb_build_object('void_none_restocks_bags', ok
    and (select current_stock = 100 from public.raw_materials where id = bag)
    and (select count(*) = 1 and sum(quantity) = 2
                and bool_and(order_item_id is null and unit_cost = 1.5 and tenant_id = ta and created_by = ua
                             and not legacy)
           from public.inventory_transactions
          where order_id = o6.order_id and raw_material_id = bag and type = 'void_restock')
    and (select current_stock = k_before from public.raw_materials where id = kenya)
    and (select count(*) = 1 from public.inventory_transactions
          where order_item_id = i1 and raw_material_id = kenya and type = 'void_restock'));

  -- second_void_no_double_bags: a second void raises not_completed and puts nothing back; a second
  -- bill-level void_restock row for the same bill and material is refused by the unique index.
  select count(*) into n_before from public.inventory_transactions where tenant_id = ta;
  caught := null;
  begin
    perform public.order_void(ta, ua, ua, o6.order_id, 'อีกครั้ง', jsonb_build_object(i1::text, 'none'));
  exception when others then caught := sqlerrm;
  end;
  ok := caught = 'not_completed'
    and (select count(*) = n_before from public.inventory_transactions where tenant_id = ta)
    and (select current_stock = 100 from public.raw_materials where id = bag)
    and (select count(*) = 1 from public.inventory_transactions
          where order_id = o6.order_id and raw_material_id = bag and type = 'void_restock');
  caught := null;
  begin
    insert into public.inventory_transactions
      (tenant_id, raw_material_id, type, quantity, unit_cost, order_id, order_item_id, occurred_at, created_by)
    values (ta, bag, 'void_restock', 2, 1.5, o6.order_id, null, now(), ua);
    raise exception 'inserted';  -- the probe row is never kept
  exception
    when unique_violation then caught := 'unique';
    when others then caught := sqlerrm;
  end;
  r := r || jsonb_build_object('second_void_no_double_bags', ok and caught = 'unique');

  -- void_all_made_restocks_bags: "all" keeps the cup's stock out but puts the bags back
  select * into o7 from public.order_record(ta, ua, gen_random_uuid(), bill_order, items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o7.order_id;
  select current_stock into k_before from public.raw_materials where id = kenya;
  select current_stock into b_before from public.raw_materials where id = bag;
  perform public.order_void(ta, ua, ua, o7.order_id, 'ชงแล้ว', jsonb_build_object(i1::text, 'all'));
  r := r || jsonb_build_object('void_all_made_restocks_bags',
    (select current_stock = b_before + 2 from public.raw_materials where id = bag)
    and (select count(*) = 1 and sum(quantity) = 2 and bool_and(order_item_id is null)
           from public.inventory_transactions
          where order_id = o7.order_id and raw_material_id = bag and type = 'void_restock')
    and (select current_stock = k_before from public.raw_materials where id = kenya)
    and not exists (select 1 from public.inventory_transactions
                     where order_item_id = i1 and type = 'void_restock')
    and (select void_made from public.order_items where id = i1));

  -- void_partial_restocks_bags: qty 3 (kenya 81), made 1 → kenya 2/3 back, the bags all back
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 3, 'subtotal', 165,
    'stock', jsonb_build_array(jsonb_build_object('material_id', kenya, 'qty', 81))));
  select * into o8 from public.order_record(ta, ua, gen_random_uuid(),
    bill_order || jsonb_build_object('subtotal', 165, 'total', 165, 'cash_received', 200, 'change_amount', 35),
    items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o8.order_id;
  select current_stock into k_before from public.raw_materials where id = kenya;
  select current_stock into b_before from public.raw_materials where id = bag;
  perform public.order_void(ta, ua, ua, o8.order_id, 'บางแก้ว', jsonb_build_object(i1::text, 1));
  r := r || jsonb_build_object('void_partial_restocks_bags',
    (select current_stock = b_before + 2 from public.raw_materials where id = bag)
    and (select count(*) = 1 and sum(quantity) = 2 and bool_and(order_item_id is null)
           from public.inventory_transactions
          where order_id = o8.order_id and raw_material_id = bag and type = 'void_restock')
    and (select current_stock = k_before + 54 from public.raw_materials where id = kenya)
    and (select quantity = 54 and order_item_id = i1 from public.inventory_transactions
          where order_id = o8.order_id and raw_material_id = kenya and type = 'void_restock'));

  -- void_bags_from_ledger_only (R-D2a-5): a bill with bags = 3 but no bill-level stock rows puts
  -- no bag back; the count on the bill is never stock.
  select * into o9 from public.order_record(ta, ua, gen_random_uuid(),
    cash_order || jsonb_build_object('bags', 3), items, null, null, '[]', null);
  select id into i1 from public.order_items where order_id = o9.order_id;
  select current_stock into b_before from public.raw_materials where id = bag;
  perform public.order_void(ta, ua, ua, o9.order_id, 'ไม่มีแถวถุง', jsonb_build_object(i1::text, 'all'));
  r := r || jsonb_build_object('void_bags_from_ledger_only',
    (select bags = 3 and status = 'cancelled' from public.orders where id = o9.order_id)
    and (select current_stock = b_before from public.raw_materials where id = bag)
    and not exists (select 1 from public.inventory_transactions where order_id = o9.order_id and type = 'void_restock'));

  r := r || jsonb_build_object('bags_balance_equals_ledger',
    (select bool_and(rm.current_stock = coalesce((
              select sum(t.quantity) from public.inventory_transactions t
               where t.raw_material_id = rm.id and not t.legacy), 0))
       from public.raw_materials rm where rm.id in (bag, kenya, milk)));

  raise exception 'RESULT %', r;
end;
$$;
