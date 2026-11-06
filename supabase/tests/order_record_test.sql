-- order_record + queue_counter_raise (round C2, selling while offline) — DB test.
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back.
-- Every key in the JSON must be true. "As service" = default role (auth.uid() is null), the
-- admin client's path.
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();  -- owner, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A
  um uuid := gen_random_uuid();  -- active manager, tenant A
  udm uuid := gen_random_uuid(); -- deactivated manager, tenant A
  ux uuid := gen_random_uuid();  -- staff, tenant A, deactivated later in the test
  ta uuid;
  pa uuid;
  sa uuid;                       -- first shift (closed half-way through the test)
  s2 uuid;                       -- second shift, open after sa closes
  hb uuid;
  today date := (now() at time zone 'Asia/Bangkok')::date;
  yesterday_2358 timestamptz;
  ref uuid;
  first record; again record; o record;
  cash_order jsonb; transfer_order jsonb; items jsonb;
  ovr jsonb;
  ts timestamptz;
  n int;
  ok boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-or-a-' || ua || '@example.test', 'x', now(), now()),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-or-s-' || us || '@example.test', 'x', now(), now()),
    (um, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-or-m-' || um || '@example.test', 'x', now(), now()),
    (udm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-or-dm-' || udm || '@example.test', 'x', now(), now()),
    (ux, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-or-x-' || ux || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA OR A', true);
  select tenant_id into ta from public.profiles where id = ua;
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us, ta, 'QA Staff', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';
  insert into public.profiles (id, tenant_id, full_name, role)
  values (um, ta, 'QA Manager', 'manager')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'manager';
  insert into public.profiles (id, tenant_id, full_name, role, deactivated_at)
  values (udm, ta, 'QA ex-manager', 'manager', now())
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'manager', deactivated_at = now();
  insert into public.profiles (id, tenant_id, full_name, role)
  values (ux, ta, 'QA Seller', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'ลาเต้', 55, true) returning id into pa;
  sa := public.shift_open(ta, ua, array[0]::numeric[], null);
  yesterday_2358 := ((today - 1)::timestamp + time '23:58') at time zone 'Asia/Bangkok';

  cash_order := jsonb_build_object(
    'payment_method', 'cash', 'order_type', 'dine_in', 'subtotal', 110, 'total', 110,
    'cash_received', 200, 'change_amount', 90, 'discount_type', null, 'discount_value', null,
    'discount_amount', 0, 'discount_reason', null, 'discount_approved_by', null,
    'customer_id', null, 'note', null);
  transfer_order := cash_order || jsonb_build_object(
    'payment_method', 'transfer', 'cash_received', null, 'change_amount', null);
  items := jsonb_build_array(jsonb_build_object(
    'product_id', pa, 'product_name', 'ลาเต้', 'unit_price', 55, 'quantity', 2, 'subtotal', 110,
    'category_name', null, 'modifiers_snapshot', null, 'note', null));

  -- ── Online: same as order_create ────────────────────────────────────────
  ref := gen_random_uuid();
  select * into first from public.order_record(ta, ua, ref, cash_order, items, null, null, '[]', null);
  select * into again from public.order_record(ta, ua, ref, cash_order, items, null, null, '[]', null);
  r := r || jsonb_build_object('online_same_as_create',
    first.created and not again.created and again.order_id = first.order_id
    and again.order_number = first.order_number and again.queue_number = first.queue_number
    and (select count(*) = 1 from public.orders where tenant_id = ta and client_ref = ref)
    and (select not sold_offline and shift_id = sa and created_at = now()
         from public.orders where id = first.order_id));

  -- ── Offline queue numbers ───────────────────────────────────────────────
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 7, 'shift_id', sa, 'override', null));
  r := r || jsonb_build_object('offline_keeps_queue',
    o.created and o.queue_number = 7
    and (select queue_number = 7 and sold_offline from public.orders where id = o.order_id)
    and (select last_number >= 7 from public.tenant_queue_counters where tenant_id = ta and business_date = today));

  update public.tenant_queue_counters set last_number = 9 where tenant_id = ta and business_date = today;
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 4, 'shift_id', sa, 'override', null));
  r := r || jsonb_build_object('offline_counter_not_lowered',
    o.queue_number = 4
    and (select queue_number = 4 from public.orders where id = o.order_id)
    and (select last_number = 9 from public.tenant_queue_counters where tenant_id = ta and business_date = today));

  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', yesterday_2358, 'queue_number', 40, 'shift_id', sa, 'override', null));
  r := r || jsonb_build_object('offline_midnight',
    o.queue_number = 40
    and (select created_at = yesterday_2358 from public.orders where id = o.order_id)
    and (select last_number >= 40 from public.tenant_queue_counters where tenant_id = ta and business_date = today - 1)
    and (select last_number = 9 from public.tenant_queue_counters where tenant_id = ta and business_date = today));

  -- ── Sale time ───────────────────────────────────────────────────────────
  ts := now() - interval '40 minutes';
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', ts, 'queue_number', 2, 'shift_id', sa, 'override', null));
  ok := (select created_at = ts from public.orders where id = o.order_id);
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now() + interval '1 day', 'queue_number', 2, 'shift_id', sa, 'override', null));
  r := r || jsonb_build_object('offline_created_at', ok
    and (select abs(extract(epoch from created_at - now())) < 60 from public.orders where id = o.order_id));

  -- ── Shift of an offline sale ────────────────────────────────────────────
  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 3, 'shift_id', sa, 'override', null));
  r := r || jsonb_build_object('offline_shift_recorded',
    (select shift_id = sa from public.orders where id = o.order_id));

  -- ── Replay offline ──────────────────────────────────────────────────────
  ref := gen_random_uuid();
  select * into first from public.order_record(ta, ua, ref, cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 5, 'shift_id', sa, 'override', null));
  select * into again from public.order_record(ta, ua, ref, cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 6, 'shift_id', sa, 'override', null));
  r := r || jsonb_build_object('replay_offline',
    first.created and not again.created and again.order_id = first.order_id
    and again.order_number = first.order_number and again.queue_number = 5
    and (select count(*) = 1 from public.orders where tenant_id = ta and client_ref = ref));

  -- ── Held bill paid offline ──────────────────────────────────────────────
  insert into public.held_bills (tenant_id, queue_number, business_date, items, created_by)
  values (ta, 77, today, '[]', ua) returning id into hb;
  select * into o from public.order_record(ta, ua, gen_random_uuid(), transfer_order, items, hb, 1, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 12, 'shift_id', sa, 'override', null));
  r := r || jsonb_build_object('held_offline',
    o.queue_number = 77
    and (select status = 'paid' from public.held_bills where id = hb)
    and (select queue_number = 77 and held_bill_id = hb and sold_offline from public.orders where id = o.order_id));

  -- ── Recorded shift closed; another one open ─────────────────────────────
  update public.shifts set status = 'closed', closed_at = clock_timestamp() where id = sa;
  s2 := public.shift_open(ta, ua, array[0]::numeric[], null);

  ref := gen_random_uuid();
  begin
    perform public.order_record(ta, ua, ref, cash_order, items, null, null, '[]',
      jsonb_build_object('sold_at', now(), 'queue_number', 50, 'shift_id', sa, 'override', null));
    r := r || jsonb_build_object('offline_cash_shift_closed', false);
  exception when others then
    r := r || jsonb_build_object('offline_cash_shift_closed', sqlerrm = 'offline_shift_closed'
      and not exists (select 1 from public.orders where tenant_id = ta and client_ref = ref)
      and (select last_number < 50 from public.tenant_queue_counters where tenant_id = ta and business_date = today));
  end;

  select * into o from public.order_record(ta, ua, gen_random_uuid(), transfer_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 8, 'shift_id', sa, 'override', null));
  r := r || jsonb_build_object('offline_transfer_shift_closed',
    o.created and (select shift_id is null and sold_offline from public.orders where id = o.order_id));

  -- ── Record as charged (override) ────────────────────────────────────────
  ovr := jsonb_build_object('approver_id', um, 'reason', 'ลูกค้าจ่ายแล้วตอนเน็ตหลุด',
    'server_total', 100, 'charged_total', 110);
  select * into o from public.order_record(ta, ua, gen_random_uuid(), transfer_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 10, 'shift_id', s2, 'override', ovr));
  r := r || jsonb_build_object('override_logs',
    (select count(*) = 1 from public.order_adjustments where order_id = o.order_id)
    and (select kind = 'offline_override' and approver_id = um and actor_id = ua
                and from_value = '100' and to_value = '110' and reason = 'ลูกค้าจ่ายแล้วตอนเน็ตหลุด'
                and tenant_id = ta
         from public.order_adjustments where order_id = o.order_id));

  select * into o from public.order_record(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 11, 'shift_id', sa, 'override', ovr));
  r := r || jsonb_build_object('override_cash_current_shift',
    o.created and (select shift_id = s2 from public.orders where id = o.order_id));

  -- R24a: a held bill paid offline whose held bill is since paid (stale). createOrder sends an
  -- override WITHOUT the held bill (null id/version/reductions) and the device queue number (the
  -- held bill's own number): it records, keeps that number, leaves the held bill alone, one row.
  insert into public.held_bills (tenant_id, queue_number, business_date, items, created_by, status)
  values (ta, 88, today, '[]', ua, 'paid') returning id into hb;
  ref := gen_random_uuid();
  select * into o from public.order_record(ta, ua, ref, transfer_order, items, null, null, null,
    jsonb_build_object('sold_at', now(), 'queue_number', 88, 'shift_id', s2,
      'override', ovr || jsonb_build_object('reason', 'ลูกค้าจ่ายแล้วตอนเน็ตหลุด · บิลพัก ' || left(hb::text, 8))));
  r := r || jsonb_build_object('override_ignores_stale_held',
    o.created and o.queue_number = 88
    and (select queue_number = 88 and held_bill_id is null and sold_offline and client_ref = ref
         from public.orders where id = o.order_id)
    and (select status = 'paid' and version = 1 from public.held_bills where id = hb)
    and not exists (select 1 from public.held_bill_events where held_bill_id = hb)
    and (select count(*) = 1 from public.order_adjustments
          where order_id = o.order_id and kind = 'offline_override'
            and reason = 'ลูกค้าจ่ายแล้วตอนเน็ตหลุด · บิลพัก ' || left(hb::text, 8)));

  -- ── Sellers and approvers ───────────────────────────────────────────────
  update public.profiles set deactivated_at = now() where id = ux;
  begin
    perform public.order_record(ta, ux, gen_random_uuid(), transfer_order, items, null, null, '[]',
      jsonb_build_object('sold_at', now(), 'queue_number', 13, 'shift_id', s2, 'override', null));
    r := r || jsonb_build_object('seller_inactive', false);
  exception when others then
    r := r || jsonb_build_object('seller_inactive', sqlerrm = 'forbidden');
  end;

  select * into o from public.order_record(ta, ux, gen_random_uuid(), cash_order, items, null, null, '[]',
    jsonb_build_object('sold_at', now(), 'queue_number', 14, 'shift_id', s2, 'override', ovr));
  r := r || jsonb_build_object('override_inactive_seller',
    o.created
    and (select created_by = ux and shift_id = s2 from public.orders where id = o.order_id)
    and (select count(*) = 1 from public.order_adjustments
          where order_id = o.order_id and kind = 'offline_override' and actor_id = ux and approver_id = um));

  ok := true;
  begin
    perform public.order_record(ta, ua, gen_random_uuid(), transfer_order, items, null, null, '[]',
      jsonb_build_object('sold_at', now(), 'queue_number', 15, 'shift_id', s2,
        'override', ovr || jsonb_build_object('approver_id', us)));
    ok := false;
  exception when others then
    ok := ok and sqlerrm = 'forbidden';
  end;
  begin
    perform public.order_record(ta, ua, gen_random_uuid(), transfer_order, items, null, null, '[]',
      jsonb_build_object('sold_at', now(), 'queue_number', 16, 'shift_id', s2,
        'override', ovr || jsonb_build_object('approver_id', udm)));
    ok := false;
  exception when others then
    ok := ok and sqlerrm = 'forbidden';
  end;
  r := r || jsonb_build_object('override_bad_approver', ok);

  -- ── queue_counter_raise ─────────────────────────────────────────────────
  perform public.queue_counter_raise(ta, ua, date '2020-01-01', 15);
  ok := (select last_number = 15 from public.tenant_queue_counters where tenant_id = ta and business_date = date '2020-01-01');
  perform public.queue_counter_raise(ta, ua, date '2020-01-01', 3);
  r := r || jsonb_build_object('raise_counter', ok
    and (select last_number = 15 from public.tenant_queue_counters where tenant_id = ta and business_date = date '2020-01-01'));

  -- ── Privileges ──────────────────────────────────────────────────────────
  r := r || jsonb_build_object('privileges',
    not has_function_privilege('authenticated', 'public.order_record(uuid,uuid,uuid,jsonb,jsonb,uuid,int,jsonb,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.order_record(uuid,uuid,uuid,jsonb,jsonb,uuid,int,jsonb,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.order_record(uuid,uuid,uuid,jsonb,jsonb,uuid,int,jsonb,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.queue_counter_raise(uuid,uuid,date,int)', 'execute')
    and not has_function_privilege('anon', 'public.queue_counter_raise(uuid,uuid,date,int)', 'execute')
    and has_function_privilege('service_role', 'public.queue_counter_raise(uuid,uuid,date,int)', 'execute'));

  raise exception 'RESULT %', r;
end $$;
