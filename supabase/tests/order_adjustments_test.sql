-- Order adjustments (round A) — DB test.
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back.
-- Every key in the JSON must be true. "As service" = default role (auth.uid() is null),
-- the same path the app's admin client uses.
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();  -- owner, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A
  ub uuid := gen_random_uuid();  -- owner, tenant B
  um uuid := gen_random_uuid();  -- deactivated manager, tenant A
  ta uuid; tb uuid;
  s1 uuid; s0 uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; c1 uuid; c0 uuid; c2 uuid; x1 uuid;
  rm uuid;
  inv_before int; stock_before numeric;
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-adj-a-' || ua || '@example.test', 'x', now(), now()),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-adj-s-' || us || '@example.test', 'x', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-adj-b-' || ub || '@example.test', 'x', now(), now()),
    (um, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-adj-m-' || um || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA ADJ A', true);
  perform public.create_tenant_and_owner(ub, 'QA ADJ B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us, ta, 'QA Staff', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';
  insert into public.profiles (id, tenant_id, full_name, role, deactivated_at)
  values (um, ta, 'QA ex-manager', 'manager', now())
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'manager', deactivated_at = now();

  -- s0's bills are sold while it is open, then it is closed (round B's guard_order_drawer
  -- rejects inserting a bill into an already-closed shift). One open shift per tenant, so s1
  -- opens after s0 closes.
  insert into public.shifts (tenant_id, opened_by, status, opening_cash)
  values (ta, ua, 'open', 0) returning id into s0;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'transfer', 60, 60, s0) returning id into t2;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'cash', 50, 50, s0) returning id into c0;
  update public.shifts set status = 'closed', closed_by = ua, closed_at = now() where id = s0;
  insert into public.shifts (tenant_id, opened_by, status, opening_cash)
  values (ta, ua, 'open', 0) returning id into s1;

  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'transfer', 85, 85, s1) returning id into t1;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'transfer', 70, 70, s1) returning id into t3;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'transfer', 90, 90, s1) returning id into t4;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'cash', 100, 100, s1) returning id into c1;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id, cash_received, change_amount)
  values (ta, us, 'completed', 'cash', 65, 65, s1, 100, 35) returning id into c2;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id, cancelled_at, cancelled_by, cancel_reason)
  values (ta, us, 'cancelled', 'cash', 40, 40, s1, now(), us, 'qa') returning id into x1;

  insert into public.raw_materials (tenant_id, name, unit, current_stock)
  values (ta, 'QA milk', 'ml', 100) returning id into rm;
  select count(*) into inv_before from public.inventory_transactions where tenant_id = ta;
  stock_before := 100;

  -- ── service path ──────────────────────────────────────────────────────────
  begin
    perform public.order_mark_unpaid(ta, t1, ua, ua, 'ลูกค้าไม่ได้โอน');
    r := r || jsonb_build_object('mark_ok',
      (select status = 'unpaid' and unpaid_at is not null and unpaid_by = ua
              and unpaid_approved_by = ua and unpaid_reason = 'ลูกค้าไม่ได้โอน'
       from public.orders where id = t1)
      and (select count(*) = 1 from public.order_adjustments
           where order_id = t1 and kind = 'mark_unpaid'
             and from_value = 'completed' and to_value = 'unpaid'));
  exception when others then r := r || jsonb_build_object('mark_ok', false, 'mark_ok_err', sqlerrm);
  end;

  begin
    perform public.order_mark_unpaid(ta, t2, ua, ua, 'ไม่เจอยอด');
    r := r || jsonb_build_object('mark_after_shift_closed_ok',
      (select status = 'unpaid' from public.orders where id = t2));
  exception when others then r := r || jsonb_build_object('mark_after_shift_closed_ok', false, 'mark_after_shift_closed_err', sqlerrm);
  end;

  begin
    perform public.order_mark_unpaid(ta, t1, ua, ua, 'ซ้ำ');
    r := r || jsonb_build_object('mark_twice_rejected', false);
  exception when others then
    r := r || jsonb_build_object('mark_twice_rejected', sqlerrm like '%invalid_state%');
  end;
  begin
    r := r || jsonb_build_object('mark_twice_rejected',
      (r->>'mark_twice_rejected')::boolean
      and (select count(*) = 1 from public.order_adjustments where order_id = t1));
  exception when others then r := r || jsonb_build_object('mark_twice_rejected', false);
  end;

  begin
    perform public.order_mark_unpaid(ta, c0, ua, ua, 'เงินสด');
    r := r || jsonb_build_object('mark_cash_rejected', false);
  exception when others then r := r || jsonb_build_object('mark_cash_rejected', sqlerrm like '%invalid_state%');
  end;

  begin
    perform public.order_mark_unpaid(ta, x1, ua, ua, 'ยกเลิกแล้ว');
    r := r || jsonb_build_object('mark_cancelled_rejected', false);
  exception when others then r := r || jsonb_build_object('mark_cancelled_rejected', sqlerrm like '%invalid_state%');
  end;

  begin
    perform public.order_restore_paid(ta, t1, ua, ua, 'ลูกค้าโอนมาแล้ว');
    r := r || jsonb_build_object('restore_ok',
      (select status = 'completed' and payment_method = 'transfer'
              and unpaid_at is null and unpaid_by is null and unpaid_approved_by is null
              and unpaid_reason is null and transfer_verified_at is null
       from public.orders where id = t1)
      and (select array_agg(kind order by created_at, id) = array['mark_unpaid', 'restore_paid']
           from public.order_adjustments where order_id = t1));
  exception when others then r := r || jsonb_build_object('restore_ok', false, 'restore_ok_err', sqlerrm);
  end;

  r := r || jsonb_build_object('no_restock',
    (select current_stock = stock_before from public.raw_materials where id = rm)
    and (select count(*) = inv_before from public.inventory_transactions where tenant_id = ta));

  begin
    perform public.order_change_payment_method(ta, c1, 'transfer', ua, ua, 'ลูกค้าโอน กดผิด');
    r := r || jsonb_build_object('method_change_ok',
      (select payment_method = 'transfer' and cash_received is not distinct from null
       from public.orders where id = c1)
      and (select count(*) = 1 from public.order_adjustments
           where order_id = c1 and kind = 'payment_method_change'
             and from_value = 'cash' and to_value = 'transfer'));
  exception when others then r := r || jsonb_build_object('method_change_ok', false, 'method_change_err', sqlerrm);
  end;

  -- Found live: a cash bill with cash tendered recorded hit orders_cash_tendered_check.
  begin
    perform public.order_change_payment_method(ta, c2, 'transfer', ua, ua, 'ลูกค้าโอน กดผิด');
    r := r || jsonb_build_object('method_change_clears_tendered',
      (select payment_method = 'transfer' and cash_received is null and change_amount is null
       from public.orders where id = c2));
  exception when others then r := r || jsonb_build_object('method_change_clears_tendered', false, 'tendered_err', sqlerrm);
  end;

  begin
    perform public.order_change_payment_method(ta, c1, 'transfer', ua, ua, 'ซ้ำ');
    r := r || jsonb_build_object('method_same_rejected', false);
  exception when others then r := r || jsonb_build_object('method_same_rejected', sqlerrm like '%same_method%');
  end;

  begin
    perform public.order_change_payment_method(ta, c0, 'transfer', ua, ua, 'กะปิดแล้ว');
    r := r || jsonb_build_object('method_closed_shift_rejected', false);
  exception when others then
    r := r || jsonb_build_object('method_closed_shift_rejected',
      sqlerrm like '%shift_closed%'
      and (select payment_method = 'cash' from public.orders where id = c0));
  end;

  begin
    perform public.order_change_payment_method(ta, c1, 'card', ua, ua, 'บัตร');
    r := r || jsonb_build_object('method_bad_value_rejected', false);
  exception when others then r := r || jsonb_build_object('method_bad_value_rejected', sqlerrm like '%invalid_method%');
  end;

  begin
    perform public.order_set_transfer_verified(ta, t3, ua, true);
    r := r || jsonb_build_object('tick_set',
      (select transfer_verified_at is not null and transfer_verified_by = ua from public.orders where id = t3));
    perform public.order_change_payment_method(ta, t3, 'cash', ua, ua, 'จ่ายเงินสดจริง');
    r := r || jsonb_build_object('tick_cleared_on_cash',
      (select payment_method = 'cash' and transfer_verified_at is null and transfer_verified_by is null
       from public.orders where id = t3));
  exception when others then r := r || jsonb_build_object('tick_cleared_on_cash', false, 'tick_err', sqlerrm);
  end;

  -- Final review: approvers must be active owners/managers.
  begin
    perform public.order_mark_unpaid(ta, t4, ua, us, 'staff as approver');
    r := r || jsonb_build_object('staff_approver_forbidden', false);
  exception when others then r := r || jsonb_build_object('staff_approver_forbidden', sqlerrm like '%forbidden%');
  end;
  begin
    perform public.order_mark_unpaid(ta, t4, ua, um, 'deactivated approver');
    r := r || jsonb_build_object('deactivated_approver_forbidden', false);
  exception when others then r := r || jsonb_build_object('deactivated_approver_forbidden', sqlerrm like '%forbidden%');
  end;
  begin
    perform public.order_set_transfer_verified(ta, t4, um, true);
    r := r || jsonb_build_object('deactivated_ticker_forbidden', false);
  exception when others then
    r := r || jsonb_build_object('deactivated_ticker_forbidden',
      sqlerrm like '%forbidden%'
      and (select transfer_verified_at is null and status = 'completed' from public.orders where id = t4));
  end;

  begin
    perform public.order_mark_unpaid(ta, t4, ua, ua, '   ');
    r := r || jsonb_build_object('blank_reason_rejected', false);
  exception when others then r := r || jsonb_build_object('blank_reason_rejected', sqlerrm like '%reason_required%');
  end;

  begin
    perform public.order_mark_unpaid(tb, t4, ub, ub, 'ข้ามร้าน');
    r := r || jsonb_build_object('foreign_tenant_rejected', false);
  exception when others then
    r := r || jsonb_build_object('foreign_tenant_rejected',
      sqlerrm like '%order_not_found%'
      and (select status = 'completed' from public.orders where id = t4));
  end;

  -- ── staff, straight through the Data API ──────────────────────────────────
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', us, 'role', 'authenticated')::text, true);

  begin
    update public.orders set status = 'unpaid' where id = t4;
    get diagnostics n = row_count;
    r := r || jsonb_build_object('staff_direct_status_blocked', false, 'staff_status_rows', n);
  exception when others then
    r := r || jsonb_build_object('staff_direct_status_blocked', sqlerrm like '%requires PIN approval%');
  end;

  begin
    update public.orders set transfer_verified_at = now(), transfer_verified_by = us where id = t4;
    get diagnostics n = row_count;
    r := r || jsonb_build_object('staff_direct_tick_blocked', false, 'staff_tick_rows', n);
  exception when others then
    r := r || jsonb_build_object('staff_direct_tick_blocked', sqlerrm like '%requires PIN approval%');
  end;

  begin
    insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total)
    values (ta, us, 'unpaid', 'transfer', 10, 10);
    r := r || jsonb_build_object('staff_insert_unpaid_blocked', false);
  exception when others then
    r := r || jsonb_build_object('staff_insert_unpaid_blocked', sqlerrm like '%requires PIN approval%');
  end;

  begin
    perform public.order_mark_unpaid(ta, t4, us, us, 'แอบทำ');
    r := r || jsonb_build_object('staff_rpc_denied', false);
  exception when others then r := r || jsonb_build_object('staff_rpc_denied', sqlstate = '42501');
  end;

  begin
    insert into public.order_adjustments (tenant_id, order_id, kind, from_value, to_value, reason, actor_id)
    values (ta, t4, 'mark_unpaid', 'completed', 'unpaid', 'แอบ', us);
    r := r || jsonb_build_object('staff_adjustment_insert_denied', false);
  exception when others then r := r || jsonb_build_object('staff_adjustment_insert_denied', sqlstate = '42501');
  end;

  begin
    r := r || jsonb_build_object('staff_can_read_own_adjustments',
      (select count(*) >= 1 from public.order_adjustments where order_id = c1));
  exception when others then r := r || jsonb_build_object('staff_can_read_own_adjustments', false, 'staff_read_err', sqlerrm);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  begin
    r := r || jsonb_build_object('other_tenant_reads_nothing',
      (select count(*) = 0 from public.order_adjustments where order_id = c1));
  exception when others then r := r || jsonb_build_object('other_tenant_reads_nothing', false);
  end;

  raise exception 'RESULT %', r;
end $$;
