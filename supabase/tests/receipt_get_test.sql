-- receipt_get + orders_client_ref_idx + tenants.logo_url (QR e-receipt, task 1) — DB test.
-- Run the whole file through execute_sql. It never commits: it ends with
-- raise exception 'RESULT <json>', so every row it creates is rolled back.
-- Every key in the JSON must be true. "As service" = default role (the admin client's path).
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();  -- owner, tenant A
  um uuid := gen_random_uuid();  -- manager, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A
  ub uuid := gen_random_uuid();  -- owner, tenant B
  ta uuid; tb uuid; pa uuid; sh uuid;
  base_keys text[] := array['shop_name','shop_logo_url','order_number','queue_number','created_at','status'];
  full_keys text[] := array['shop_name','shop_logo_url','order_number','queue_number','created_at','status',
    'items','subtotal','discount_amount','total','payment_method','cash_received','change_amount'];
  ref_c uuid := gen_random_uuid(); ref_x uuid := gen_random_uuid(); ref_f uuid := gen_random_uuid();
  ref_u uuid := gen_random_uuid(); ref_e uuid := gen_random_uuid(); ref_t uuid := gen_random_uuid();
  ref_dup uuid := gen_random_uuid();
  oc uuid; ox uuid; of_ uuid; ou uuid; oe uuid; ot uuid;
  res jsonb; res_u jsonb; res_all text := '';
  rc int; ok boolean;
  ts timestamptz := now() - interval '3 minutes';
  logo_ok text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-rg-a-' || ua || '@example.test', 'x', now(), now()),
    (um, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-rg-m-' || um || '@example.test', 'x', now(), now()),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-rg-s-' || us || '@example.test', 'x', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-rg-b-' || ub || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA RG A', true);
  perform public.create_tenant_and_owner(ub, 'QA RG B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.profiles (id, tenant_id, full_name, role) values (um, ta, 'STAFF-MARKER', 'manager')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'manager', full_name = 'STAFF-MARKER';
  insert into public.profiles (id, tenant_id, full_name, role) values (us, ta, 'STAFF-MARKER', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff', full_name = 'STAFF-MARKER';
  update public.profiles set full_name = 'STAFF-MARKER' where id = ua;
  insert into public.products (tenant_id, name, price, is_active) values (ta, 'ลาเต้', 55, true) returning id into pa;

  sh := public.shift_open(ta, ua, array[0]::numeric[], null);  -- cash bills need an open shift

  -- completed(cash, discounted) / completed(transfer, unverified) / cancelled / unpaid / completed(no lines) / refunded
  insert into public.orders (shift_id, tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total,
      discount_amount, cash_received, change_amount, status, note, cancel_reason, refund_reason, unpaid_reason,
      discount_reason, queue_number, order_number, created_at)
  values (sh, ta, ua, ref_c, 'cash', 'dine_in', 155, 140, 15, 200, 60, 'completed', 'NOTE-MARKER', 'REASON-MARKER',
      'REASON-MARKER', 'REASON-MARKER', 'REASON-MARKER', 7, 'RG-0001', ts)
  returning id into oc;
  insert into public.orders (shift_id, tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total,
      cash_received, change_amount, status, note, queue_number, order_number, transfer_verified_at)
  values (sh, ta, ua, ref_x, 'transfer', 'dine_in', 110, 110, null, null, 'completed', 'NOTE-MARKER', 8, 'RG-0002', null)
  returning id into ox;
  insert into public.orders (shift_id, tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total, status, note, order_number)
  values (sh, ta, ua, ref_f, 'cash', 'dine_in', 110, 110, 'cancelled', 'NOTE-MARKER', 'RG-0003') returning id into of_;
  insert into public.orders (shift_id, tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total, status, note, order_number)
  values (sh, ta, ua, ref_u, 'transfer', 'dine_in', 110, 110, 'unpaid', 'NOTE-MARKER', 'RG-0004') returning id into ou;
  insert into public.orders (shift_id, tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total, status, note, order_number)
  values (sh, ta, ua, ref_e, 'cash', 'dine_in', 0, 0, 'completed', 'NOTE-MARKER', 'RG-0005') returning id into oe;
  insert into public.orders (shift_id, tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total, status, note, order_number)
  values (sh, ta, ua, ref_t, 'cash', 'dine_in', 110, 110, 'refunded', 'NOTE-MARKER', 'RG-0006') returning id into ot;
  -- the same client_ref on one order in each of two tenants
  insert into public.orders (shift_id, tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total, status, order_number)
  values (sh, ta, ua, ref_dup, 'cash', 'dine_in', 1, 1, 'completed', 'RG-0007');
  insert into public.orders (shift_id, tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total, status, order_number)
  values (null, tb, ub, ref_dup, 'transfer', 'dine_in', 1, 1, 'completed', 'RG-0008');

  -- two lines with equal created_at (name order decides); cost 987.65 must never show
  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, cost_total,
      note, choices, modifiers_snapshot, created_at)
  values
    (oc, pa, 'ซ', 55, 1, 55, 987.65, 'NOTE-MARKER', '[{"group":"ความหวาน","name":"หวานน้อย"}]'::jsonb, '[{"name":"นมโอ๊ต","price":10}]'::jsonb, ts),
    (oc, pa, 'ก', 55, 1, 55, 987.65, 'NOTE-MARKER', null, null, ts);
  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
  values (ox, pa, 'ลาเต้', 55, 2, 110);

  -- ── Shape of a completed bill ────────────────────────────────────────────
  res := public.receipt_get(ref_c);
  res_all := res_all || res::text;
  r := r || jsonb_build_object('completed_full_shape',
    (select array_agg(k order by k) from jsonb_object_keys(res) k) = (select array_agg(k order by k) from unnest(full_keys) k));
  r := r || jsonb_build_object('item_fields_only',
    (select bool_and((select array_agg(k order by k) from jsonb_object_keys(i) k)
                     = array['choices','name','options','quantity','subtotal'])
       from jsonb_array_elements(res -> 'items') i)
    and jsonb_array_length(res -> 'items') = 2);
  r := r || jsonb_build_object('items_order_stable',
    res #>> '{items,0,name}' = 'ก' and res #>> '{items,1,name}' = 'ซ'
    and public.receipt_get(ref_c) -> 'items' = res -> 'items'
    and res #> '{items,1,choices}' = '[{"group":"ความหวาน","name":"หวานน้อย"}]'::jsonb
    and res #> '{items,1,options}' = '[{"name":"นมโอ๊ต","price":10}]'::jsonb);
  res := public.receipt_get(ref_e);
  res_all := res_all || res::text;
  r := r || jsonb_build_object('empty_items_array', res -> 'items' = '[]'::jsonb);

  -- ── Statuses ─────────────────────────────────────────────────────────────
  res := public.receipt_get(ref_f);
  res_all := res_all || res::text;
  r := r || jsonb_build_object('cancelled_minimal_keys',
    (select array_agg(k order by k) from jsonb_object_keys(res) k) = (select array_agg(k order by k) from unnest(base_keys) k));
  res := public.receipt_get(ref_t);
  res_all := res_all || res::text;
  r := r || jsonb_build_object('refunded_minimal_keys',
    (select array_agg(k order by k) from jsonb_object_keys(res) k) = (select array_agg(k order by k) from unnest(base_keys) k));
  res_u := public.receipt_get(ref_u);
  res_all := res_all || res_u::text;
  r := r || jsonb_build_object('unpaid_minimal_keys',
    (select array_agg(k order by k) from jsonb_object_keys(res_u) k) = (select array_agg(k order by k) from unnest(base_keys) k));
  update public.orders set status = 'completed', transfer_verified_at = now() where id = ou;
  res := public.receipt_get(ref_u);
  res_all := res_all || res::text;
  r := r || jsonb_build_object('restored_paid_full',
    (select array_agg(k order by k) from jsonb_object_keys(res_u) k) = (select array_agg(k order by k) from unnest(base_keys) k)
    and (select array_agg(k order by k) from jsonb_object_keys(res) k) = (select array_agg(k order by k) from unnest(full_keys) k));
  res := public.receipt_get(ref_x);
  res_all := res_all || res::text;
  r := r || jsonb_build_object('transfer_unverified_full',
    (select array_agg(k order by k) from jsonb_object_keys(res) k) = (select array_agg(k order by k) from unnest(full_keys) k));

  -- ── Money ────────────────────────────────────────────────────────────────
  r := r || jsonb_build_object('cash_fields_only_for_cash',
    res -> 'cash_received' = 'null'::jsonb and res -> 'change_amount' = 'null'::jsonb
    and (public.receipt_get(ref_c) ->> 'cash_received')::numeric = 200
    and (public.receipt_get(ref_c) ->> 'change_amount')::numeric = 60);
  -- a transfer bill can never store cash fields: the table constraint refuses it
  begin
    insert into public.orders (shift_id, tenant_id, created_by, client_ref, payment_method, order_type, subtotal, total,
        cash_received, change_amount, status, order_number)
    values (sh, ta, ua, gen_random_uuid(), 'transfer', 'dine_in', 110, 110, 200, 60, 'completed', 'RG-0009');
    r := r || jsonb_build_object('transfer_with_cash_refused_by_constraint', false);
  exception when check_violation then
    r := r || jsonb_build_object('transfer_with_cash_refused_by_constraint', true);
  end;
  r := r || jsonb_build_object('discount_amount_present',
    (public.receipt_get(ref_c) ->> 'discount_amount')::numeric = 15
    and (public.receipt_get(ref_c) ->> 'total')::numeric = 140);

  -- ── Logo ─────────────────────────────────────────────────────────────────
  r := r || jsonb_build_object('logo_null_when_unset', public.receipt_get(ref_c) -> 'shop_logo_url' = 'null'::jsonb);
  logo_ok := 'https://x.supabase.co/storage/v1/object/public/product-images/' || ta || '/logo-1.png';
  update public.tenants set logo_url = logo_ok where id = ta;
  r := r || jsonb_build_object('logo_url_returned', public.receipt_get(ref_c) ->> 'shop_logo_url' = logo_ok);
  update public.tenants set logo_url = null where id = ta;

  -- ── No leaks ─────────────────────────────────────────────────────────────
  r := r || jsonb_build_object('no_forbidden_text',
    res_all <> ''
    and res_all not like '%NOTE-MARKER%' and res_all not like '%REASON-MARKER%'
    and res_all not like '%CUSTOMER-MARKER%' and res_all not like '%STAFF-MARKER%'
    and res_all not like '%987.65%' and res_all not like '%' || oc::text || '%'
    and res_all not like '%' || ta::text || '%' and res_all not like '%' || ref_c::text || '%');

  -- ── Misses ───────────────────────────────────────────────────────────────
  r := r || jsonb_build_object('not_found_null', public.receipt_get(gen_random_uuid()) is null);
  r := r || jsonb_build_object('null_token_null', public.receipt_get(null) is null);
  r := r || jsonb_build_object('same_ref_two_tenants_null', public.receipt_get(ref_dup) is null);

  -- ── Who may call it ──────────────────────────────────────────────────────
  r := r || jsonb_build_object('anon_cannot_execute', not has_function_privilege('anon', 'public.receipt_get(uuid)', 'execute'));
  r := r || jsonb_build_object('authenticated_cannot_execute', not has_function_privilege('authenticated', 'public.receipt_get(uuid)', 'execute'));
  r := r || jsonb_build_object('service_role_can_execute', has_function_privilege('service_role', 'public.receipt_get(uuid)', 'execute'));
  r := r || jsonb_build_object('definer_with_search_path',
    (select prosecdef and coalesce(proconfig, '{}') @> array['search_path=public'] from pg_proc where oid = 'public.receipt_get(uuid)'::regprocedure));

  -- ── Index ────────────────────────────────────────────────────────────────
  r := r || jsonb_build_object('index_exists_partial',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'orders_client_ref_idx'
              and indexdef like '%(client_ref)%WHERE (client_ref IS NOT NULL)%'));

  -- ── Who may set the logo ─────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.tenants set logo_url = logo_ok where id = ta;
  get diagnostics rc = row_count;
  reset role;
  r := r || jsonb_build_object('owner_sets_logo_own_folder', rc = 1
    and (select logo_url = logo_ok from public.tenants where id = ta));

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.tenants set logo_url = 'https://x.supabase.co/storage/v1/object/public/product-images/' || tb || '/logo-1.png' where id = ta;
    ok := false;
  exception when check_violation then ok := true;
  end;
  begin
    update public.tenants set logo_url = 'https://evil.example/logo.png' where id = ta;
    r := r || jsonb_build_object('logo_external_url_refused', false);
  exception when check_violation then r := r || jsonb_build_object('logo_external_url_refused', true);
  end;
  reset role;
  r := r || jsonb_build_object('logo_other_folder_refused', ok);

  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.tenants set logo_url = null where id = ta;
  get diagnostics rc = row_count;
  reset role;
  r := r || jsonb_build_object('manager_cannot_set_logo', rc = 0 and (select logo_url = logo_ok from public.tenants where id = ta));

  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.tenants set logo_url = null where id = ta;
  get diagnostics rc = row_count;
  reset role;
  r := r || jsonb_build_object('staff_cannot_set_logo', rc = 0 and (select logo_url = logo_ok from public.tenants where id = ta));

  raise exception 'RESULT %', r;
end $$;
