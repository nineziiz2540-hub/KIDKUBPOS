-- Shift management round B, migration B (lock-down) — DB test.
--
-- Safe to run BEFORE migration B is applied: the DO block below first runs migration B's
-- statements (copied verbatim from supabase/migrations/20261022130000_shift_lockdown.sql — change
-- both together), then checks them, then raises 'RESULT <json>'. The exception aborts the whole
-- transaction, so neither the migration nor any test row is committed.
-- After migration B is applied for real, the embedded statements are idempotent and the checks
-- still hold. Every key in the JSON must be true.
do $test$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();  -- owner, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A
  ta uuid;
  s_closed uuid; s_open uuid;
  o_closed_cash uuid; o_open_cash uuid; o_noshift_transfer uuid; o_refund uuid;
  n int;
begin
  -- ── migration B (verbatim) ────────────────────────────────────────────────
  drop policy if exists tenant_isolation on public.shifts;
  drop policy if exists shifts_select on public.shifts;
  create policy shifts_select on public.shifts
    for select to authenticated
    using (tenant_id = public.auth_tenant_id());
  revoke all on public.shifts from anon;
  revoke insert, update, delete, truncate on public.shifts from authenticated;

  create or replace function public.guard_order_drawer()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_status text;
    v_tenant uuid;
  begin
    if tg_op = 'INSERT' then
      if new.shift_id is not null then
        select s.status, s.tenant_id into v_status, v_tenant
        from public.shifts s where s.id = new.shift_id
        for share;
        if not found or v_tenant <> new.tenant_id or v_status <> 'open' then
          raise exception 'shift_closed';
        end if;
      elsif new.payment_method = 'cash' then
        raise exception 'no_open_shift';
      end if;
      return new;
    end if;

    if new.status = 'cancelled' and old.status is distinct from 'cancelled'
       and new.payment_method = 'cash' and new.shift_id is not null then
      select s.status into v_status
      from public.shifts s where s.id = new.shift_id
      for share;
      if v_status is distinct from 'open' then
        raise exception 'shift_closed';
      end if;
    end if;

    if new.status = 'refunded' and old.status is distinct from 'refunded'
       and new.refund_method = 'cash' then
      if new.refund_shift_id is null then
        raise exception 'no_open_shift';
      end if;
      select s.status, s.tenant_id into v_status, v_tenant
      from public.shifts s where s.id = new.refund_shift_id
      for share;
      if not found or v_tenant <> new.tenant_id or v_status <> 'open' then
        raise exception 'shift_closed';
      end if;
    end if;

    return new;
  end;
  $$;

  revoke execute on function public.guard_order_drawer() from public, anon, authenticated;

  drop trigger if exists guard_order_drawer_trigger on public.orders;
  create trigger guard_order_drawer_trigger
  before insert or update on public.orders
  for each row execute function public.guard_order_drawer();

  create or replace function public.order_change_payment_method(
    p_tenant_id uuid, p_order_id uuid, p_to_method text,
    p_actor_id uuid, p_approver_id uuid, p_reason text
  )
  returns void
  language plpgsql
  security invoker
  set search_path = public
  as $$
  declare
    v_order public.orders%rowtype;
    v_shift_status text;
  begin
    if p_to_method is null or p_to_method not in ('cash', 'transfer') then
      raise exception 'invalid_method';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'reason_required';
    end if;
    select * into v_order from public.orders
    where id = p_order_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'order_not_found';
    end if;
    if not exists (select 1 from public.profiles where id = p_actor_id and tenant_id = p_tenant_id and deactivated_at is null)
       or not exists (select 1 from public.profiles
                      where id = p_approver_id and tenant_id = p_tenant_id
                        and role in ('owner', 'manager') and deactivated_at is null)
    then
      raise exception 'forbidden';
    end if;
    if v_order.status <> 'completed' then
      raise exception 'invalid_state';
    end if;
    if v_order.payment_method = p_to_method then
      raise exception 'same_method';
    end if;
    if v_order.shift_id is null then
      if p_to_method = 'cash' then
        raise exception 'no_shift';
      end if;
    else
      select s.status into v_shift_status
      from public.shifts s where s.id = v_order.shift_id
      for share;
      if v_shift_status is distinct from 'open' then
        raise exception 'shift_closed';
      end if;
    end if;

    update public.orders
    set payment_method = p_to_method,
        cash_received = case when p_to_method = 'transfer' then null else cash_received end,
        change_amount = case when p_to_method = 'transfer' then null else change_amount end,
        transfer_verified_at = case when p_to_method = 'cash' then null else transfer_verified_at end,
        transfer_verified_by = case when p_to_method = 'cash' then null else transfer_verified_by end
    where id = p_order_id;

    insert into public.order_adjustments
      (tenant_id, order_id, kind, from_value, to_value, reason, actor_id, approver_id)
    values
      (p_tenant_id, p_order_id, 'payment_method_change', v_order.payment_method, p_to_method,
       btrim(p_reason), p_actor_id, p_approver_id);
  end;
  $$;

  revoke execute on function public.order_change_payment_method(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
  grant execute on function public.order_change_payment_method(uuid, uuid, text, uuid, uuid, text) to service_role;

  -- ── fixtures (as service) ─────────────────────────────────────────────────
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-lock-a-' || ua || '@example.test', 'x', now(), now()),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-lock-s-' || us || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA LOCK A', true);
  select tenant_id into ta from public.profiles where id = ua;
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us, ta, 'QA Staff', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';

  -- A shift that sold cash while open, then closed through the real function.
  s_closed := public.shift_open(ta, ua, array[0]::numeric[], null);
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'cash', 100, 100, s_closed) returning id into o_closed_cash;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'cash', 50, 50, s_closed) returning id into o_refund;
  perform public.shift_record_closing_count(ta, s_closed, ua, 150);
  perform public.shift_close(ta, s_closed, ua, 150, null);
  r := r || jsonb_build_object('service_functions_still_work',
    (select status = 'closed' from public.shifts where id = s_closed));

  -- ── orders guard (as service: it applies to every caller) ────────────────
  begin
    insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total)
    values (ta, us, 'completed', 'cash', 10, 10);
    r := r || jsonb_build_object('cash_without_shift_rejected', false);
  exception when others then
    r := r || jsonb_build_object('cash_without_shift_rejected', sqlerrm like '%no_open_shift%');
  end;
  begin
    insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
    values (ta, us, 'completed', 'transfer', 10, 10, s_closed);
    r := r || jsonb_build_object('insert_into_closed_shift_rejected', false);
  exception when others then
    r := r || jsonb_build_object('insert_into_closed_shift_rejected', sqlerrm like '%shift_closed%');
  end;
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total)
  values (ta, us, 'completed', 'transfer', 85, 85) returning id into o_noshift_transfer;
  r := r || jsonb_build_object('transfer_without_shift_ok', o_noshift_transfer is not null);

  begin
    update public.orders
    set status = 'cancelled', cancelled_at = now(), cancelled_by = us, cancel_reason = 'qa'
    where id = o_closed_cash;
    r := r || jsonb_build_object('cash_void_in_closed_shift_rejected', false);
  exception when others then
    r := r || jsonb_build_object('cash_void_in_closed_shift_rejected',
      sqlerrm like '%shift_closed%'
      and (select status = 'completed' from public.orders where id = o_closed_cash));
  end;

  begin
    update public.orders
    set status = 'refunded', refunded_at = now(), refunded_by = us, refund_reason = 'qa',
        refund_method = 'cash', refund_shift_id = s_closed
    where id = o_refund;
    r := r || jsonb_build_object('cash_refund_into_closed_shift_rejected', false);
  exception when others then
    r := r || jsonb_build_object('cash_refund_into_closed_shift_rejected', sqlerrm like '%shift_closed%');
  end;
  begin
    update public.orders
    set status = 'refunded', refunded_at = now(), refunded_by = us, refund_reason = 'qa',
        refund_method = 'cash', refund_shift_id = null
    where id = o_refund;
    r := r || jsonb_build_object('cash_refund_without_shift_rejected', false);
  exception when others then
    r := r || jsonb_build_object('cash_refund_without_shift_rejected', sqlerrm like '%no_open_shift%');
  end;

  begin
    perform public.order_change_payment_method(ta, o_noshift_transfer, 'cash', ua, ua, 'จ่ายเงินสดจริง');
    r := r || jsonb_build_object('noshift_to_cash_rejected', false);
  exception when others then
    r := r || jsonb_build_object('noshift_to_cash_rejected', sqlerrm like '%no_shift%');
  end;
  begin
    perform public.order_change_payment_method(ta, o_closed_cash, 'transfer', ua, ua, 'กะปิดแล้ว');
    r := r || jsonb_build_object('method_change_closed_shift_rejected', false);
  exception when others then
    r := r || jsonb_build_object('method_change_closed_shift_rejected', sqlerrm like '%shift_closed%');
  end;

  -- An open shift: everything still works.
  s_open := public.shift_open(ta, ua, array[150]::numeric[], null);
  insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
  values (ta, us, 'completed', 'cash', 60, 60, s_open) returning id into o_open_cash;
  perform public.order_change_payment_method(ta, o_open_cash, 'transfer', ua, ua, 'โอนจริง');
  perform public.order_change_payment_method(ta, o_open_cash, 'cash', ua, ua, 'เงินสดจริง');
  r := r || jsonb_build_object('method_change_open_shift_ok',
    (select payment_method = 'cash' from public.orders where id = o_open_cash));
  update public.orders
  set status = 'refunded', refunded_at = now(), refunded_by = us, refund_reason = 'qa',
      refund_method = 'cash', refund_shift_id = s_open
  where id = o_refund;
  r := r || jsonb_build_object('cash_refund_into_open_shift_ok',
    (select status = 'refunded' from public.orders where id = o_refund));
  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancelled_by = us, cancel_reason = 'qa'
  where id = o_open_cash;
  r := r || jsonb_build_object('cash_void_in_open_shift_ok',
    (select status = 'cancelled' from public.orders where id = o_open_cash));

  r := r || jsonb_build_object('grants',
    not has_table_privilege('authenticated', 'public.shifts', 'INSERT')
    and not has_table_privilege('authenticated', 'public.shifts', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.shifts', 'DELETE')
    and has_table_privilege('authenticated', 'public.shifts', 'SELECT')
    and not has_function_privilege('authenticated', 'public.order_change_payment_method(uuid, uuid, text, uuid, uuid, text)', 'EXECUTE'));

  -- ── staff, straight through the Data API ─────────────────────────────────
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', us, 'role', 'authenticated')::text, true);

  select count(*) into n from public.shifts where tenant_id = ta;
  r := r || jsonb_build_object('staff_reads_shifts', n = 2);

  begin
    update public.shifts set opening_cash = 99999 where id = s_open;
    r := r || jsonb_build_object('staff_update_shift_denied', false);
  exception when others then
    r := r || jsonb_build_object('staff_update_shift_denied', sqlstate = '42501');
  end;
  begin
    update public.shifts set status = 'open' where id = s_closed;
    r := r || jsonb_build_object('staff_reopen_denied', false);
  exception when others then
    r := r || jsonb_build_object('staff_reopen_denied', sqlstate = '42501');
  end;
  begin
    insert into public.shifts (tenant_id, opened_by, opening_cash) values (ta, us, 0);
    r := r || jsonb_build_object('staff_insert_shift_denied', false);
  exception when others then
    r := r || jsonb_build_object('staff_insert_shift_denied', sqlstate = '42501');
  end;
  begin
    delete from public.shifts where id = s_closed;
    r := r || jsonb_build_object('staff_delete_shift_denied', false);
  exception when others then
    r := r || jsonb_build_object('staff_delete_shift_denied', sqlstate = '42501');
  end;

  -- The normal sale path (user's own client) still works: the guard's share lock runs as definer.
  begin
    insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total, shift_id)
    values (ta, us, 'completed', 'cash', 45, 45, s_open);
    r := r || jsonb_build_object('staff_cash_sale_in_open_shift_ok', true);
  exception when others then
    r := r || jsonb_build_object('staff_cash_sale_in_open_shift_ok', false, 'staff_sale_err', sqlerrm);
  end;
  begin
    insert into public.orders (tenant_id, created_by, status, payment_method, subtotal, total)
    values (ta, us, 'completed', 'cash', 45, 45);
    r := r || jsonb_build_object('staff_cash_sale_without_shift_rejected', false);
  exception when others then
    r := r || jsonb_build_object('staff_cash_sale_without_shift_rejected', sqlerrm like '%no_open_shift%');
  end;

  raise exception 'RESULT %', r;
end $test$;
