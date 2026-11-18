-- stock_receive / stock_receive_undo / stock_adjust (round D1, Task 6) — DB test.
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back.
-- Every key in the JSON must be true. "As service" = default role, the admin client's path.
-- Dry run before the migration is applied: run the migration text and this block in ONE call.
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();  -- owner, tenant A
  um uuid := gen_random_uuid();  -- manager, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A
  us2 uuid := gen_random_uuid(); -- another staff, tenant A
  ub uuid := gen_random_uuid();  -- owner, tenant B
  ta uuid;
  tb uuid;
  m uuid;                        -- main material (tenant A)
  m2 uuid;                       -- negative-balance material
  m3 uuid;                       -- archived material
  mb uuid;                       -- tenant B material
  l1 uuid; l2 uuid; l3 uuid; l4 uuid;
  v record;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'qa-sr-' || x.id || '@example.test', 'x', now(), now()
  from (values (ua), (um), (us), (us2), (ub)) as x(id);
  perform public.create_tenant_and_owner(ua, 'QA SR A', true);
  perform public.create_tenant_and_owner(ub, 'QA SR B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.profiles (id, tenant_id, full_name, role) values
    (um, ta, 'QA Manager', 'manager'), (us, ta, 'QA Staff', 'staff'), (us2, ta, 'QA Staff 2', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = excluded.role;

  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock)
  values (ta, 'QA เมล็ดกาแฟ', 'g', 0.05, 1000) returning id into m;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock)
  values (ta, 'QA นม', 'ml', 0.05, -20) returning id into m2;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, archived_at)
  values (ta, 'QA เก่า', 'g', 0.05, 0, now()) returning id into m3;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock)
  values (tb, 'QA B', 'g', 0.05, 0) returning id into mb;
  insert into public.inventory_transactions (tenant_id, raw_material_id, type, quantity, unit_cost)
  values (ta, m, 'opening', 1000, 0.05), (ta, m2, 'opening', -20, 0.05);

  -- ── Receive with a price: average blends, row keeps the lot's unit cost ──
  l1 := public.stock_receive(ta, ua, m, 2000, 120);
  select * into v from public.raw_materials where id = m;
  r := r || jsonb_build_object('receive_with_price',
    l1 is not null and v.current_stock = 3000 and v.cost_per_unit = 0.056667
    and (select type = 'receive' and quantity = 2000 and unit_cost = 0.06 and not legacy
                and created_by = ua and tenant_id = ta and raw_material_id = m
         from public.inventory_transactions where id = l1));

  -- ── Receive without a price: average kept, row records it ───────────────
  l2 := public.stock_receive(ta, ua, m, 500, null);
  select * into v from public.raw_materials where id = m;
  r := r || jsonb_build_object('receive_without_price_keeps_avg',
    v.current_stock = 3500 and v.cost_per_unit = 0.056667
    and (select unit_cost = 0.056667 and quantity = 500 from public.inventory_transactions where id = l2));

  -- ── Staff: no price forbidden, no-price receive fine ────────────────────
  begin
    perform public.stock_receive(ta, us, m, 10, 5);
    ok := false;
  exception when others then
    ok := sqlerrm = 'forbidden_price' and (select current_stock = 3500 from public.raw_materials where id = m);
  end;
  r := r || jsonb_build_object('staff_price_forbidden', ok);
  l3 := public.stock_receive(ta, us, m, 100, null);
  r := r || jsonb_build_object('staff_receive_ok',
    (select current_stock = 3600 and cost_per_unit = 0.056667 from public.raw_materials where id = m)
    and (select created_by = us from public.inventory_transactions where id = l3));

  -- ── Balance <= 0: the new lot's unit cost; a free lot (price 0) is a free lot ──
  perform public.stock_receive(ta, ua, m2, 1000, 60);
  r := r || jsonb_build_object('negative_balance_uses_lot_cost',
    (select current_stock = 980 and cost_per_unit = 0.06 from public.raw_materials where id = m2));
  perform public.stock_receive(ta, um, m2, 980, 0);
  r := r || jsonb_build_object('free_receive_dilutes',
    (select current_stock = 1960 and cost_per_unit = 0.03 from public.raw_materials where id = m2)
    and exists (select 1 from public.inventory_transactions
                 where raw_material_id = m2 and type = 'receive' and quantity = 980 and unit_cost = 0));

  -- ── Rejections ──────────────────────────────────────────────────────────
  ok := true;
  begin perform public.stock_receive(ta, ua, m, 0, null); ok := false;
  exception when others then ok := ok and sqlerrm = 'invalid_qty'; end;
  begin perform public.stock_receive(ta, ua, m, 'NaN'::numeric, null); ok := false;
  exception when others then ok := ok and sqlerrm = 'invalid_qty'; end;
  begin perform public.stock_receive(ta, ua, m, 'Infinity'::numeric, null); ok := false;
  exception when others then ok := ok and sqlerrm = 'invalid_qty'; end;
  begin perform public.stock_receive(ta, ua, m, 5, -1); ok := false;
  exception when others then ok := ok and sqlerrm = 'invalid_price'; end;
  begin perform public.stock_receive(ta, ua, mb, 5, null); ok := false;   -- another tenant's material
  exception when others then ok := ok and sqlerrm = 'material_not_found'; end;
  begin perform public.stock_receive(ta, ua, m3, 5, null); ok := false;   -- archived
  exception when others then ok := ok and sqlerrm = 'material_not_found'; end;
  begin perform public.stock_receive(tb, ua, mb, 5, null); ok := false;   -- actor of another tenant
  exception when others then ok := ok and sqlerrm = 'forbidden'; end;
  update public.profiles set deactivated_at = now() where id = us2;
  begin perform public.stock_receive(ta, us2, m, 5, null); ok := false;   -- deactivated actor
  exception when others then ok := ok and sqlerrm = 'forbidden'; end;
  r := r || jsonb_build_object('receive_rejections', ok
    and (select current_stock = 3600 from public.raw_materials where id = m));

  -- ── Adjust ──────────────────────────────────────────────────────────────
  ok := true;
  begin perform public.stock_adjust(ta, ua, m, 3000, '   '); ok := false;
  exception when others then ok := ok and sqlerrm = 'reason_required'; end;
  begin perform public.stock_adjust(ta, ua, m, 3000, repeat('ก', 501)); ok := false;
  exception when others then ok := ok and sqlerrm = 'reason_required'; end;
  begin perform public.stock_adjust(ta, ua, m, 3000, null); ok := false;
  exception when others then ok := ok and sqlerrm = 'reason_required'; end;
  r := r || jsonb_build_object('adjust_needs_reason', ok
    and (select current_stock = 3600 from public.raw_materials where id = m));

  ok := true;
  begin perform public.stock_adjust(ta, us, m, 3000, 'นับใหม่'); ok := false;
  exception when others then ok := ok and sqlerrm = 'forbidden'; end;
  perform public.stock_adjust(ta, um, m, 3000, '  นับใหม่  ');
  r := r || jsonb_build_object('adjust_manager_only', ok
    and (select current_stock = 3000 and cost_per_unit = 0.056667 from public.raw_materials where id = m)
    and (select quantity = -600 and reason = 'นับใหม่' and type = 'adjust' and created_by = um
         from public.inventory_transactions
         where raw_material_id = m and type = 'adjust' and ref_id is null));
  ok := true;
  begin perform public.stock_adjust(ta, ua, mb, 1, 'x'); ok := false;
  exception when others then ok := ok and sqlerrm = 'material_not_found'; end;
  r := r || jsonb_build_object('adjust_other_tenant', ok);

  -- ── Undo ────────────────────────────────────────────────────────────────
  l4 := public.stock_receive(ta, us, m, 400, null);
  ok := true;
  begin perform public.stock_receive_undo(ta, us2, l4); ok := false;     -- a different staff member
  exception when others then ok := ok and sqlerrm = 'forbidden'; end;     -- (us2 is deactivated here)
  update public.profiles set deactivated_at = null where id = us2;
  begin perform public.stock_receive_undo(ta, us2, l4); ok := false;
  exception when others then ok := ok and sqlerrm = 'undo_forbidden'; end;
  r := r || jsonb_build_object('undo_other_staff_forbidden', ok
    and (select current_stock = 3400 from public.raw_materials where id = m));

  perform public.stock_receive_undo(ta, us, l4);                          -- the receiver, in time
  r := r || jsonb_build_object('undo_within_10_min',
    (select current_stock = 3000 and cost_per_unit = 0.056667 from public.raw_materials where id = m)
    and (select type = 'adjust' and quantity = -400 and reason = 'ย้อนกลับการรับของ'
                and ref_id = l4 and unit_cost = 0.056667 and created_by = us
         from public.inventory_transactions where ref_id = l4));
  begin perform public.stock_receive_undo(ta, ua, l4); ok := false;
  exception when others then ok := sqlerrm = 'already_undone'; end;
  r := r || jsonb_build_object('undo_once', ok
    and (select count(*) = 1 from public.inventory_transactions where ref_id = l4)
    and (select current_stock = 3000 from public.raw_materials where id = m));

  -- a manager may undo someone else's receive; too late is refused; not-a-receive is refused
  l4 := public.stock_receive(ta, us, m, 50, null);
  perform public.stock_receive_undo(ta, um, l4);
  ok := (select current_stock = 3000 from public.raw_materials where id = m);
  l4 := public.stock_receive(ta, us, m, 70, null);
  update public.inventory_transactions set created_at = now() - interval '11 minutes' where id = l4;
  begin perform public.stock_receive_undo(ta, us, l4); ok := false;
  exception when others then ok := ok and sqlerrm = 'undo_expired'; end;
  begin perform public.stock_receive_undo(ta, ua, (select id from public.inventory_transactions
                                                    where ref_id = l4 or (type = 'opening' and raw_material_id = m)
                                                    limit 1)); ok := false;
  exception when others then ok := ok and sqlerrm = 'not_a_receive'; end;
  begin perform public.stock_receive_undo(tb, ub, l4); ok := false;       -- another tenant's receive
  exception when others then ok := ok and sqlerrm = 'not_a_receive'; end;
  r := r || jsonb_build_object('undo_manager_expired_not_a_receive', ok
    and (select current_stock = 3070 from public.raw_materials where id = m));

  -- ── Ledger = balance, precision, privileges ─────────────────────────────
  r := r || jsonb_build_object('balance_equals_ledger',
    (select bool_and(rm.current_stock = coalesce(
              (select sum(t.quantity) from public.inventory_transactions t
                where t.raw_material_id = rm.id and not t.legacy), 0))
       from public.raw_materials rm where rm.id in (m, m2)));
  r := r || jsonb_build_object('cost_precision_6',
    (select numeric_scale = 6 from information_schema.columns
      where table_schema = 'public' and table_name = 'raw_materials' and column_name = 'cost_per_unit'));
  r := r || jsonb_build_object('privileges',
    not has_function_privilege('authenticated', 'public.stock_receive(uuid,uuid,uuid,numeric,numeric)', 'execute')
    and not has_function_privilege('anon', 'public.stock_receive(uuid,uuid,uuid,numeric,numeric)', 'execute')
    and has_function_privilege('service_role', 'public.stock_receive(uuid,uuid,uuid,numeric,numeric)', 'execute')
    and not has_function_privilege('authenticated', 'public.stock_adjust(uuid,uuid,uuid,numeric,text)', 'execute')
    and not has_function_privilege('anon', 'public.stock_adjust(uuid,uuid,uuid,numeric,text)', 'execute')
    and has_function_privilege('service_role', 'public.stock_adjust(uuid,uuid,uuid,numeric,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.stock_receive_undo(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.stock_receive_undo(uuid,uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.stock_receive_undo(uuid,uuid,uuid)', 'execute'));

  raise exception 'RESULT %', r;
end $$;
