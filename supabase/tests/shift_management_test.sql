-- Shift management (round B, migration A) — DB test.
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back.
-- Every key in the JSON must be true. "As service" = default role (auth.uid() is null),
-- the same path the app's admin client uses.
-- Written to stay valid after migration B (lock-down): it never inserts an order into a shift
-- that is already closed, and never inserts a cash order without a shift.
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();  -- owner, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A
  um uuid := gen_random_uuid();  -- deactivated manager, tenant A
  ub uuid := gen_random_uuid();  -- owner, tenant B
  ta uuid; tb uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; sb uuid;
  o_ref uuid; mv uuid;
  t record; c record; sh record;
  n int;
  err text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-shift-a-' || ua || '@example.test', 'x', now(), now()),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-shift-s-' || us || '@example.test', 'x', now(), now()),
    (um, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-shift-m-' || um || '@example.test', 'x', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-shift-b-' || ub || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA SHIFT A', true);
  perform public.create_tenant_and_owner(ub, 'QA SHIFT B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us, ta, 'QA Staff', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';
  insert into public.profiles (id, tenant_id, full_name, role, deactivated_at)
  values (um, ta, 'QA ex-manager', 'manager', now())
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'manager', deactivated_at = now();

  r := r || jsonb_build_object('float_default_1000',
    (select cash_float_default = 1000 from public.tenants where id = ta));

  -- ── Opening: first ever shift, nothing to compare with ───────────────────
  s1 := public.shift_open(ta, us, array[0]::numeric[], null);
  select * into sh from public.shifts where id = s1;
  r := r || jsonb_build_object('open_first_no_compare',
    sh.opening_cash = 0 and sh.opening_expected is null and sh.opening_difference is null
    and sh.previous_shift_id is null and sh.opened_by = us and sh.status = 'open');
  r := r || jsonb_build_object('open_first_count_row',
    (select count(*) = 1 from public.shift_cash_counts
     where shift_id = s1 and stage = 'opening' and attempt = 1 and amount = 0 and expected is null));

  begin
    perform public.shift_open(ta, ua, array[0]::numeric[], null);
    r := r || jsonb_build_object('open_twice_rejected', false);
  exception when others then
    r := r || jsonb_build_object('open_twice_rejected', sqlerrm like '%shift_already_open%');
  end;
  begin
    perform public.shift_open(ta, um, array[0]::numeric[], null);
    r := r || jsonb_build_object('open_deactivated_forbidden', false);
  exception when others then
    r := r || jsonb_build_object('open_deactivated_forbidden', sqlerrm like '%forbidden%');
  end;
  begin
    perform public.shift_open(ta, ub, array[0]::numeric[], null);
    r := r || jsonb_build_object('open_other_tenant_forbidden', false);
  exception when others then
    r := r || jsonb_build_object('open_other_tenant_forbidden', sqlerrm like '%forbidden%');
  end;
  begin
    perform public.shift_open(tb, ub, array[-1]::numeric[], null);
    r := r || jsonb_build_object('open_negative_count_rejected', false);
  exception when others then
    r := r || jsonb_build_object('open_negative_count_rejected', sqlerrm like '%invalid_counts%');
  end;
  begin
    perform public.shift_open(tb, ub, array[]::numeric[], null);
    r := r || jsonb_build_object('open_no_count_rejected', false);
  exception when others then
    r := r || jsonb_build_object('open_no_count_rejected', sqlerrm like '%invalid_counts%');
  end;

  -- ── Totals ───────────────────────────────────────────────────────────────
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'cash', 100, 100, s1);
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id, cash_received, change_amount)
  values (ta, us, 'completed', 'cash', 65, 65, s1, 100, 35);
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'transfer', 85, 85, s1);
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id, cancelled_at, cancelled_by, cancel_reason)
  values (ta, us, 'cancelled', 'cash', 40, 40, s1, now(), us, 'qa');
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id,
                             refunded_at, refunded_by, refund_reason, refund_method, refund_shift_id)
  values (ta, us, 'refunded', 'cash', 50, 50, s1, now(), us, 'qa', 'cash', s1) returning id into o_ref;

  perform public.shift_add_cash_movement(ta, s1, us, 'in', 'personal_topup', 500, null);
  perform public.shift_add_cash_movement(ta, s1, us, 'out', 'purchase', 60, 'น้ำแข็ง');

  select * into t from public.shift_totals(ta, s1);
  r := r || jsonb_build_object('totals_expected',
    t.opening_cash = 0 and t.cash_sales = 215 and t.cash_refunds = 50 and t.transfer_sales = 85
    and t.order_count = 4 and t.cash_in = 500 and t.cash_out = 60 and t.expected_cash = 605);
  begin
    perform public.shift_totals(tb, s1);
    r := r || jsonb_build_object('totals_other_tenant_rejected', false);
  exception when others then
    r := r || jsonb_build_object('totals_other_tenant_rejected', sqlerrm like '%shift_not_found%');
  end;

  -- ── Closing s1: count required, expected changes while counting ──────────
  begin
    perform public.shift_close(ta, s1, us, 0, null);
    r := r || jsonb_build_object('close_needs_count', false);
  exception when others then
    r := r || jsonb_build_object('close_needs_count', sqlerrm like '%count_required%');
  end;

  select * into c from public.shift_record_closing_count(ta, s1, us, 605);
  r := r || jsonb_build_object('count1_recorded', c.attempt = 1 and c.expected = 605);

  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'cash', 20, 20, s1);
  begin
    perform public.shift_close(ta, s1, us, 0, null);
    r := r || jsonb_build_object('close_expected_changed', false);
  exception when others then
    r := r || jsonb_build_object('close_expected_changed', sqlerrm like '%expected_changed%');
  end;

  select * into c from public.shift_record_closing_count(ta, s1, us, 625);
  r := r || jsonb_build_object('count2_after_change', c.attempt = 2 and c.expected = 625);

  begin
    perform public.shift_close(ta, s1, us, 1000, null);
    r := r || jsonb_build_object('float_over_count_rejected', false);
  exception when others then
    r := r || jsonb_build_object('float_over_count_rejected', sqlerrm like '%invalid_float%');
  end;
  begin
    perform public.shift_close(ta, s1, us, -1, null);
    r := r || jsonb_build_object('float_negative_rejected', false);
  exception when others then
    r := r || jsonb_build_object('float_negative_rejected', sqlerrm like '%invalid_float%');
  end;
  begin
    perform public.shift_record_closing_count(ta, s1, us, 1000000.01);
    r := r || jsonb_build_object('count_too_large_rejected', false);
  exception when others then
    r := r || jsonb_build_object('count_too_large_rejected', sqlerrm like '%invalid_amount%');
  end;

  select * into c from public.shift_close(ta, s1, ua, 600, '  ปิดปกติ  ');
  select * into sh from public.shifts where id = s1;
  r := r || jsonb_build_object('close_ok_result',
    c.counted = 625 and c.expected = 625 and c.variance = 0 and c.float_left = 600 and c.deposit = 25);
  r := r || jsonb_build_object('close_ok_row',
    sh.status = 'closed' and sh.closed_by = ua and sh.closed_at is not null
    and sh.closing_cash_counted = 625 and sh.expected_cash = 625 and sh.variance = 0
    and sh.float_left = 600 and sh.deposit_amount = 25 and sh.closing_note = 'ปิดปกติ');
  r := r || jsonb_build_object('close_snapshots',
    sh.closing_cash_sales = 235 and sh.closing_cash_refunds = 50 and sh.closing_transfer_sales = 85
    and sh.closing_order_count = 5 and sh.closing_cash_in = 500 and sh.closing_cash_out = 60);

  begin
    perform public.shift_add_cash_movement(ta, s1, us, 'out', 'purchase', 10, null);
    r := r || jsonb_build_object('movement_closed_rejected', false);
  exception when others then
    r := r || jsonb_build_object('movement_closed_rejected', sqlerrm like '%shift_closed%');
  end;
  begin
    perform public.shift_record_closing_count(ta, s1, us, 600);
    r := r || jsonb_build_object('count_closed_rejected', false);
  exception when others then
    r := r || jsonb_build_object('count_closed_rejected', sqlerrm like '%shift_closed%');
  end;
  begin
    perform public.shift_close(ta, s1, us, 600, null);
    r := r || jsonb_build_object('close_twice_rejected', false);
  exception when others then
    r := r || jsonb_build_object('close_twice_rejected', sqlerrm like '%shift_closed%');
  end;

  -- ── s2: opening matches last night's float; closing needs the recount ────
  s2 := public.shift_open(ta, us, array[600]::numeric[], null);
  select * into sh from public.shifts where id = s2;
  r := r || jsonb_build_object('open_match_float',
    sh.opening_cash = 600 and sh.opening_expected = 600 and sh.opening_difference = 0
    and sh.previous_shift_id = s1);

  perform public.shift_record_closing_count(ta, s2, us, 500);
  begin
    perform public.shift_close(ta, s2, us, 500, null);
    r := r || jsonb_build_object('close_needs_recount', false);
  exception when others then
    r := r || jsonb_build_object('close_needs_recount', sqlerrm like '%recount_required%');
  end;
  perform public.shift_record_closing_count(ta, s2, us, 500);
  select * into c from public.shift_close(ta, s2, us, 500, null);
  r := r || jsonb_build_object('close_after_recount', c.counted = 500 and c.expected = 600
    and c.variance = -100 and c.deposit = 0);

  -- ── s3: opening mismatches last night's float (500) ──────────────────────
  begin
    perform public.shift_open(ta, us, array[450]::numeric[], null);
    r := r || jsonb_build_object('open_mismatch_needs_recount', false);
  exception when others then
    r := r || jsonb_build_object('open_mismatch_needs_recount', sqlerrm like '%recount_required%');
  end;
  begin
    perform public.shift_open(ta, us, array[500, 500]::numeric[], null);
    r := r || jsonb_build_object('open_recount_after_match_rejected', false);
  exception when others then
    r := r || jsonb_build_object('open_recount_after_match_rejected', sqlerrm like '%invalid_counts%');
  end;
  s3 := public.shift_open(ta, us, array[450, 450]::numeric[], 'เหรียญหาย');
  select * into sh from public.shifts where id = s3;
  r := r || jsonb_build_object('open_recount_saved',
    sh.opening_cash = 450 and sh.opening_expected = 500 and sh.opening_difference = -50
    and sh.previous_shift_id = s2 and sh.opening_note = 'เหรียญหาย');
  r := r || jsonb_build_object('open_recount_rows',
    (select count(*) = 2 from public.shift_cash_counts
     where shift_id = s3 and stage = 'opening' and expected = 500 and amount = 450));

  -- ── Movement validation ──────────────────────────────────────────────────
  begin
    perform public.shift_add_cash_movement(ta, s3, us, 'in', 'purchase', 60, null);
    r := r || jsonb_build_object('movement_wrong_direction', false);
  exception when others then
    r := r || jsonb_build_object('movement_wrong_direction', sqlerrm like '%invalid_reason%');
  end;
  begin
    perform public.shift_add_cash_movement(ta, s3, us, 'out', 'other_out', 60, '   ');
    r := r || jsonb_build_object('movement_note_required', false);
  exception when others then
    r := r || jsonb_build_object('movement_note_required', sqlerrm like '%note_required%');
  end;
  begin
    perform public.shift_add_cash_movement(ta, s3, us, 'out', 'purchase', 0, null);
    r := r || jsonb_build_object('movement_zero_rejected', false);
  exception when others then
    r := r || jsonb_build_object('movement_zero_rejected', sqlerrm like '%invalid_amount%');
  end;
  begin
    perform public.shift_add_cash_movement(ta, s3, us, 'out', 'purchase', 100000.01, null);
    r := r || jsonb_build_object('movement_too_large_rejected', false);
  exception when others then
    r := r || jsonb_build_object('movement_too_large_rejected', sqlerrm like '%invalid_amount%');
  end;
  begin
    perform public.shift_add_cash_movement(ta, s3, um, 'out', 'purchase', 10, null);
    r := r || jsonb_build_object('movement_deactivated_forbidden', false);
  exception when others then
    r := r || jsonb_build_object('movement_deactivated_forbidden', sqlerrm like '%forbidden%');
  end;
  mv := public.shift_add_cash_movement(ta, s3, us, 'out', 'correction', 100000, 'กดผิด');
  r := r || jsonb_build_object('movement_max_ok', mv is not null);

  -- ── Append-only ──────────────────────────────────────────────────────────
  begin
    update public.cash_movements set amount = 1 where id = mv;
    r := r || jsonb_build_object('movement_update_blocked', false);
  exception when others then
    r := r || jsonb_build_object('movement_update_blocked', sqlerrm like '%append_only%');
  end;
  begin
    delete from public.cash_movements where id = mv;
    r := r || jsonb_build_object('movement_delete_blocked', false);
  exception when others then
    r := r || jsonb_build_object('movement_delete_blocked', sqlerrm like '%append_only%');
  end;
  begin
    update public.shift_cash_counts set amount = 1 where shift_id = s3;
    r := r || jsonb_build_object('count_update_blocked', false);
  exception when others then
    r := r || jsonb_build_object('count_update_blocked', sqlerrm like '%append_only%');
  end;
  begin
    delete from public.shift_cash_counts where shift_id = s3;
    r := r || jsonb_build_object('count_delete_blocked', false);
  exception when others then
    r := r || jsonb_build_object('count_delete_blocked', sqlerrm like '%append_only%');
  end;

  -- ── One open shift per tenant ────────────────────────────────────────────
  begin
    insert into public.shifts (tenant_id, opened_by, opening_cash) values (ta, ua, 0);
    r := r || jsonb_build_object('second_open_insert_blocked', false);
  exception when unique_violation then
    r := r || jsonb_build_object('second_open_insert_blocked', true);
  end;
  begin
    update public.shifts set status = 'paused' where id = s3;
    r := r || jsonb_build_object('status_check', false);
  exception when check_violation then
    r := r || jsonb_build_object('status_check', true);
  end;

  -- ── A shift closed by the old code leaves nothing to compare with ────────
  -- clock_timestamp(), like shift_close: now() is this transaction's start, earlier than s1/s2's.
  update public.shifts
  set status = 'closed', closed_by = ua, closed_at = clock_timestamp(), closing_cash_counted = 450,
      expected_cash = 450, variance = 0
  where id = s3;
  s4 := public.shift_open(ta, us, array[300]::numeric[], null);
  select * into sh from public.shifts where id = s4;
  r := r || jsonb_build_object('old_close_no_compare',
    sh.opening_expected is null and sh.opening_difference is null and sh.previous_shift_id is null);

  begin
    perform public.shift_record_closing_count(tb, s4, ub, 300);
    r := r || jsonb_build_object('count_other_tenant_shift', false);
  exception when others then
    r := r || jsonb_build_object('count_other_tenant_shift', sqlerrm like '%shift_not_found%');
  end;

  -- ── An open shift created by the old code can be closed with the new flow ─
  insert into public.shifts (tenant_id, opened_by, opening_cash) values (tb, ub, 3000) returning id into sb;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (tb, ub, 'completed', 'cash', 70, 70, sb);
  select * into c from public.shift_record_closing_count(tb, sb, ub, 3070);
  select * into c from public.shift_close(tb, sb, ub, 1000, null);
  r := r || jsonb_build_object('old_open_closable',
    c.counted = 3070 and c.expected = 3070 and c.deposit = 2070
    and (select status = 'closed' from public.shifts where id = sb));

  -- ── Grants ───────────────────────────────────────────────────────────────
  r := r || jsonb_build_object('fn_grants_revoked',
    not has_function_privilege('authenticated', 'public.shift_totals(uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.shift_open(uuid, uuid, numeric[], text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.shift_record_closing_count(uuid, uuid, uuid, numeric)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.shift_close(uuid, uuid, uuid, numeric, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.shift_add_cash_movement(uuid, uuid, uuid, text, text, numeric, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.shift_open(uuid, uuid, numeric[], text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.shift_close(uuid, uuid, uuid, numeric, text)', 'EXECUTE'));
  r := r || jsonb_build_object('table_grants_revoked',
    not has_table_privilege('authenticated', 'public.cash_movements', 'INSERT')
    and not has_table_privilege('authenticated', 'public.cash_movements', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.shift_cash_counts', 'INSERT')
    and not has_table_privilege('anon', 'public.cash_movements', 'SELECT')
    and has_table_privilege('authenticated', 'public.cash_movements', 'SELECT'));

  -- ── RLS: a tenant member reads only their own tenant's rows ──────────────
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', us, 'role', 'authenticated')::text, true);
  select count(*) into n from public.cash_movements;
  r := r || jsonb_build_object('rls_own_movements', n = 3);
  select count(*) into n from public.shift_cash_counts where tenant_id = tb;
  r := r || jsonb_build_object('rls_no_other_tenant_counts', n = 0);
  begin
    insert into public.cash_movements (tenant_id, shift_id, direction, reason, amount, created_by)
    values (ta, s4, 'out', 'purchase', 10, us);
    r := r || jsonb_build_object('staff_movement_insert_denied', false);
  exception when others then
    r := r || jsonb_build_object('staff_movement_insert_denied', sqlstate = '42501');
  end;
  begin
    perform public.shift_add_cash_movement(ta, s4, us, 'out', 'purchase', 10, null);
    r := r || jsonb_build_object('staff_rpc_denied', false);
  exception when others then
    r := r || jsonb_build_object('staff_rpc_denied', sqlstate = '42501');
  end;

  raise exception 'RESULT %', r;
end $$;
