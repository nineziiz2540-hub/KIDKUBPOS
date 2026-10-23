-- order_create (round C1) — DB test.
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back.
-- Every key in the JSON must be true, except the ones compared with an error code, which must
-- equal that code. "As service" = default role (auth.uid() is null), the admin client's path.
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();  -- owner, tenant A
  ub uuid := gen_random_uuid();  -- owner, tenant B
  ta uuid; tb uuid;
  pa uuid; pb uuid;              -- a product in each tenant
  sa uuid;                       -- tenant A's open shift
  hb uuid;                       -- a held bill in tenant A
  ref_cash uuid := gen_random_uuid();
  ref_held uuid := gen_random_uuid();
  ref_bad uuid := gen_random_uuid();
  first record; again record; o record;
  cash_order jsonb; transfer_order jsonb; items jsonb; items_b jsonb;
  n_before int; n_after int;
  err text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-oc-a-' || ua || '@example.test', 'x', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-oc-b-' || ub || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA OC A', true);
  perform public.create_tenant_and_owner(ub, 'QA OC B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'ลาเต้', 55, true) returning id into pa;
  insert into public.products (tenant_id, name, price, is_active) values (tb, 'ลาเต้', 55, true) returning id into pb;
  sa := public.shift_open(ta, ua, array[0]::numeric[], null);

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
  items_b := jsonb_build_array(items -> 0 || jsonb_build_object('product_id', pb));

  -- ── First call and replay ───────────────────────────────────────────────
  select * into first from public.order_create(ta, ua, ref_cash, cash_order, items, null, null, '[]');
  r := r || jsonb_build_object('first_created', first.created);
  select count(*) into n_before from public.order_items where order_id = first.order_id;
  select * into again from public.order_create(ta, ua, ref_cash, cash_order, items, null, null, '[]');
  r := r || jsonb_build_object('replay_created', again.created);
  r := r || jsonb_build_object('replay_same_number',
    again.order_id = first.order_id and again.order_number = first.order_number
    and again.queue_number = first.queue_number);
  select count(*) into n_after from public.order_items where order_id = first.order_id;
  r := r || jsonb_build_object('replay_items_not_doubled', n_before = 1 and n_after = 1
    and (select count(*) = 1 from public.orders where tenant_id = ta and client_ref = ref_cash));
  r := r || jsonb_build_object('first_linked_to_shift',
    (select shift_id = sa and created_by = ua and cash_received = 200 and change_amount = 90
     from public.orders where id = first.order_id));

  -- ── Held bill: paid, events, queue kept, replay after paid, stale ───────
  insert into public.held_bills (tenant_id, queue_number, business_date, items, created_by)
  values (ta, 77, (now() at time zone 'Asia/Bangkok')::date, '[]', ua) returning id into hb;
  select * into o from public.order_create(ta, ua, ref_held, transfer_order, items, hb, 1,
    jsonb_build_array(jsonb_build_object('name', 'ชาไทย', 'from', 2, 'to', 1)));
  r := r || jsonb_build_object('held_paid',
    (select status = 'paid' and updated_by = ua from public.held_bills where id = hb)
    and (select held_bill_id = hb from public.orders where id = o.order_id));
  r := r || jsonb_build_object('held_events',
    (select string_agg(event_type, ',' order by event_type) from public.held_bill_events where held_bill_id = hb));
  r := r || jsonb_build_object('held_queue_kept', o.queue_number = 77);
  select * into again from public.order_create(ta, ua, ref_held, transfer_order, items, hb, 1, '[]');
  r := r || jsonb_build_object('held_replay_ok', again.order_id = o.order_id and not again.created);
  begin
    perform public.order_create(ta, ua, gen_random_uuid(), transfer_order, items, hb, 1, '[]');
    r := r || jsonb_build_object('held_stale', 'accepted');
  exception when others then
    r := r || jsonb_build_object('held_stale', sqlerrm);
  end;

  -- ── A bad item rolls the whole bill back ────────────────────────────────
  begin
    perform public.order_create(ta, ua, ref_bad, transfer_order,
      jsonb_build_array(items -> 0 || jsonb_build_object('product_id', gen_random_uuid())), null, null, '[]');
    r := r || jsonb_build_object('bad_item_rolls_back', false);
  exception when others then
    r := r || jsonb_build_object('bad_item_rolls_back',
      not exists (select 1 from public.orders where tenant_id = ta and client_ref = ref_bad));
  end;

  -- ── Tenants and actors ──────────────────────────────────────────────────
  select * into o from public.order_create(tb, ub, ref_cash, transfer_order, items_b, null, null, '[]');
  r := r || jsonb_build_object('same_ref_other_tenant_created', o.created and o.order_id <> first.order_id);
  begin
    perform public.order_create(ta, ub, gen_random_uuid(), transfer_order, items, null, null, '[]');
    r := r || jsonb_build_object('actor_other_tenant', 'accepted');
  exception when others then
    r := r || jsonb_build_object('actor_other_tenant', sqlerrm);
  end;
  begin
    perform public.order_create(ta, ua, null, transfer_order, items, null, null, '[]');
    r := r || jsonb_build_object('null_ref', 'accepted');
  exception when others then
    r := r || jsonb_build_object('null_ref', sqlerrm);
  end;

  -- ── Shift closed: replay still returns the bill; a new cash bill is refused ──
  update public.shifts set status = 'closed', closed_at = clock_timestamp() where id = sa;
  select * into again from public.order_create(ta, ua, ref_cash, cash_order, items, null, null, '[]');
  r := r || jsonb_build_object('replay_after_shift_closed', again.order_id = first.order_id and not again.created);
  begin
    perform public.order_create(ta, ua, gen_random_uuid(), cash_order, items, null, null, '[]');
    r := r || jsonb_build_object('cash_no_shift', 'accepted');
  exception when others then
    r := r || jsonb_build_object('cash_no_shift', sqlerrm);
  end;
  select * into o from public.order_create(ta, ua, gen_random_uuid(), transfer_order, items, null, null, '[]');
  r := r || jsonb_build_object('transfer_without_shift_ok', o.created
    and (select shift_id is null from public.orders where id = o.order_id));

  -- ── Privileges ──────────────────────────────────────────────────────────
  r := r || jsonb_build_object('authenticated_cannot_execute',
    not has_function_privilege('authenticated', 'public.order_create(uuid,uuid,uuid,jsonb,jsonb,uuid,int,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.order_create(uuid,uuid,uuid,jsonb,jsonb,uuid,int,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.order_create(uuid,uuid,uuid,jsonb,jsonb,uuid,int,jsonb)', 'execute'));

  raise exception 'RESULT %', r;
end $$;
