-- Menu editor saves (round D1, Task 12) — DB test for save_menu / replace_product_recipes with
-- bean/matcha slot lines and the menu's sweetness, and save_option_effects ("ผลต่อสต๊อก").
-- EXPECTS 20261118170000_save_menu_slots.sql TO BE APPLIED.
-- (Dry run: send the migration text + this file in ONE execute_sql call; alone, before the migration,
--  the slot / sweetness keys come back false.)
-- It never commits: it ends with raise exception 'RESULT <json>', so every row it creates is rolled back.
-- Every key must be true. Sessions are simulated with `set local role` + request.jwt.claims, as PostgREST does.
do $$
declare
  r jsonb := '{}';
  ua uuid := gen_random_uuid();  -- owner, tenant A
  us uuid := gen_random_uuid();  -- staff, tenant A
  ub uuid := gen_random_uuid();  -- owner, tenant B
  ta uuid; tb uuid;
  mBean uuid; mSpec uuid; mMatcha uuid; mMilk uuid; mIce uuid; mSyrup uuid; mCond uuid; mMix uuid; mB uuid;
  gBean uuid; gMatcha uuid; gSweet uuid; gB uuid; gSweetB uuid;
  memHouse uuid; memSpec uuid; memMatcha uuid; sSyrup uuid; sCond uuid; sMix uuid; memB uuid; sB uuid;
  lNone uuid; lLow uuid; lNormal uuid; lHigh uuid; lB uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid;
  mArch uuid;
  modA uuid; optA uuid; modB uuid; optB uuid;
  err text;
  ok boolean;
  menu jsonb;
  sweet jsonb;
  grid jsonb;
begin
  -- ── fixtures (as the default role) ──────────────────────────────────────
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-ms-a-' || ua || '@example.test', 'x', now(), now()),
    (us, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-ms-s-' || us || '@example.test', 'x', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-ms-b-' || ub || '@example.test', 'x', now(), now());
  perform public.create_tenant_and_owner(ua, 'QA MS A', true);
  perform public.create_tenant_and_owner(ub, 'QA MS B', true);
  select tenant_id into ta from public.profiles where id = ua;
  select tenant_id into tb from public.profiles where id = ub;
  insert into public.profiles (id, tenant_id, full_name, role)
  values (us, ta, 'QA Staff', 'staff')
  on conflict (id) do update set tenant_id = excluded.tenant_id, role = 'staff';

  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'คั่วกลาง', 'g', 0.6, 0) returning id into mBean;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'เคนยา', 'g', 1.5, 0) returning id into mSpec;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'มัทฉะร้าน', 'g', 3, 0) returning id into mMatcha;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'นมสด', 'ml', 0.05, 0) returning id into mMilk;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'น้ำแข็ง', 'g', 0.01, 0) returning id into mIce;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'ไซรัป', 'ml', 0.1, 0) returning id into mSyrup;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'นมข้น', 'ml', 0.08, 0) returning id into mCond;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (ta, 'นมมิกซ์', 'ml', 0.07, 0) returning id into mMix;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock) values (tb, 'เมล็ด ร้านอื่น', 'g', 0.9, 0) returning id into mB;
  insert into public.raw_materials (tenant_id, name, unit, cost_per_unit, current_stock, archived_at) values (ta, 'วิปเก่า', 'g', 0.3, 0, now()) returning id into mArch;
  insert into public.modifiers (tenant_id, name) values (ta, 'เพิ่ม') returning id into modA;
  insert into public.modifier_options (modifier_id, name) values (modA, 'เพิ่มช็อต') returning id into optA;
  insert into public.modifiers (tenant_id, name) values (tb, 'เพิ่ม B') returning id into modB;
  insert into public.modifier_options (modifier_id, name) values (modB, 'ช็อต B') returning id into optB;

  insert into public.choice_groups (tenant_id, name, kind) values (ta, 'เมล็ด', 'bean') returning id into gBean;
  insert into public.choice_groups (tenant_id, name, kind) values (ta, 'มัทฉะ', 'matcha') returning id into gMatcha;
  insert into public.choice_groups (tenant_id, name, kind) values (ta, 'ความหวาน', 'sweetener') returning id into gSweet;
  insert into public.choice_groups (tenant_id, name, kind) values (tb, 'เมล็ด B', 'bean') returning id into gB;
  insert into public.choice_groups (tenant_id, name, kind) values (tb, 'ความหวาน B', 'sweetener') returning id into gSweetB;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, is_default) values (ta, gBean, mBean, 'คั่วกลาง', 'house', true) returning id into memHouse;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, price_delta) values (ta, gBean, mSpec, 'เคนยา', 'special', 20) returning id into memSpec;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, is_default) values (ta, gMatcha, mMatcha, 'มัทฉะร้าน', 'house', true) returning id into memMatcha;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, is_default, sort_order) values (ta, gSweet, mSyrup, 'ไซรัป', 'house', true, 0) returning id into sSyrup;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, sort_order) values (ta, gSweet, mCond, 'นมข้น', 'house', 1) returning id into sCond;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, sort_order) values (ta, gSweet, mMix, 'นมมิกซ์', 'house', 2) returning id into sMix;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, is_default) values (tb, gB, mB, 'B', 'house', true) returning id into memB;
  insert into public.choice_group_members (tenant_id, group_id, raw_material_id, label, tier, is_default) values (tb, gSweetB, mB, 'B', 'house', true) returning id into sB;
  insert into public.sweetness_levels (tenant_id, name, is_none, sort_order) values (ta, 'ไม่หวาน', true, 0) returning id into lNone;
  insert into public.sweetness_levels (tenant_id, name, sort_order) values (ta, 'หวานน้อย', 1) returning id into lLow;
  insert into public.sweetness_levels (tenant_id, name, is_default, sort_order) values (ta, 'หวานปกติ', true, 2) returning id into lNormal;
  insert into public.sweetness_levels (tenant_id, name, sort_order) values (ta, 'หวานมาก', 3) returning id into lHigh;
  insert into public.sweetness_levels (tenant_id, name) values (tb, 'หวาน B') returning id into lB;
  -- the shop's standard table (product_id null) — must never be touched by a menu save
  insert into public.sweetness_amounts (tenant_id, product_id, member_id, level_id, amount)
  values (ta, null, sSyrup, lNone, 0), (ta, null, sSyrup, lLow, 10), (ta, null, sSyrup, lNormal, 20), (ta, null, sSyrup, lHigh, 35);

  menu := jsonb_build_object('name', 'ลาเต้', 'price', 55, 'is_active', true);
  -- a full custom table for the menu's three sweeteners (12 cells; the ไม่หวาน cell is sent as 5 and must be stored as 0)
  grid := (select jsonb_agg(jsonb_build_object('member_id', m, 'level_id', l, 'amount', a))
             from (values (sSyrup, lNone, 5), (sSyrup, lLow, 12), (sSyrup, lNormal, 22), (sSyrup, lHigh, 32.5),
                          (sCond, lNone, 0),  (sCond, lLow, 15),  (sCond, lNormal, 25),  (sCond, lHigh, 40),
                          (sMix, lNone, 0),   (sMix, lLow, 15),   (sMix, lNormal, 30),   (sMix, lHigh, 45)) v(m, l, a));
  sweet := jsonb_build_object('group_id', gSweet, 'default_member_id', sSyrup,
                              'allowed_member_ids', jsonb_build_array(sCond, sMix),
                              'default_level_id', lLow, 'use_custom', true, 'custom', grid);

  -- ── OWNER session ───────────────────────────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);

  -- slot line saved: ลาเต้ = beans 18 g slot (house default, no specials) + milk 180 + ice 150, with sweetness
  err := null;
  begin
    p1 := public.save_menu(null, menu || jsonb_build_object('sweetness', sweet),
      jsonb_build_array(
        jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18, 'default_member_id', memHouse, 'allow_special', false),
        jsonb_build_object('line_kind', 'fixed', 'raw_material_id', mMilk, 'quantity_used', 180),
        jsonb_build_object('line_kind', 'fixed', 'raw_material_id', mIce, 'quantity_used', 150)),
      '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('slot_line_saved',
    err is null and p1 is not null
    and (select count(*) = 3 from public.product_recipes where product_id = p1)
    and (select count(*) = 1 from public.product_recipes
          where product_id = p1 and line_kind = 'slot' and group_id = gBean and raw_material_id is null
            and quantity_used = 18 and default_member_id = memHouse and allow_special = false and tenant_id = ta)
    and (select count(*) = 1 from public.product_recipes where product_id = p1 and line_kind = 'fixed' and raw_material_id = mMilk and quantity_used = 180)
    and (select count(*) = 1 from public.product_recipes where product_id = p1 and line_kind = 'fixed' and raw_material_id = mIce and quantity_used = 150));
  r := r || jsonb_build_object('_slot_line_err', coalesce(err, 'none'));

  -- the sweetness object was stored: row + 12 menu-scoped amounts (ไม่หวาน forced to 0); shop table untouched
  r := r || jsonb_build_object('sweetness_saved',
    (select count(*) = 1 from public.product_sweetness
      where product_id = p1 and tenant_id = ta and group_id = gSweet and default_member_id = sSyrup
        and allowed_member_ids @> array[sCond, sMix] and cardinality(allowed_member_ids) = 2
        and default_level_id = lLow and use_custom)
    and (select count(*) = 12 from public.sweetness_amounts where product_id = p1 and tenant_id = ta)
    and (select amount = 0 from public.sweetness_amounts where product_id = p1 and member_id = sSyrup and level_id = lNone)
    and (select amount = 32.5 from public.sweetness_amounts where product_id = p1 and member_id = sSyrup and level_id = lHigh)
    and (select count(*) = 4 from public.sweetness_amounts where product_id is null and tenant_id = ta));

  -- the deployed editor's payload: no line_kind, no sweetness key → fixed rows; sweetness left as it is
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_menu(p1, jsonb_build_object('name', 'ลาเต้ (แก้ชื่อ)', 'price', 60, 'is_active', true),
      jsonb_build_array(jsonb_build_object('raw_material_id', mMilk, 'quantity_used', 200)),
      '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('old_payload_still_fixed',
    err is null
    and (select count(*) = 1 from public.product_recipes where product_id = p1)
    and (select count(*) = 1 from public.product_recipes
          where product_id = p1 and line_kind = 'fixed' and raw_material_id = mMilk and quantity_used = 200)
    and (select name = 'ลาเต้ (แก้ชื่อ)' and price = 60 from public.products where id = p1));
  r := r || jsonb_build_object('sweetness_absent_untouched',
    err is null
    and (select count(*) = 1 from public.product_sweetness
          where product_id = p1 and default_member_id = sSyrup and default_level_id = lLow and use_custom
            and cardinality(allowed_member_ids) = 2)
    and (select count(*) = 12 from public.sweetness_amounts where product_id = p1));

  -- sweetness replaced: a new object replaces the row AND the menu's own amounts
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_menu(p1, menu || jsonb_build_object('sweetness', jsonb_build_object(
        'group_id', gSweet, 'default_member_id', sCond, 'allowed_member_ids', '[]'::jsonb,
        'default_level_id', null, 'use_custom', false, 'custom', '[]'::jsonb)),
      jsonb_build_array(jsonb_build_object('line_kind', 'fixed', 'raw_material_id', mMilk, 'quantity_used', 180)),
      '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('sweetness_replaced',
    err is null
    and (select count(*) = 1 from public.product_sweetness
          where product_id = p1 and default_member_id = sCond and default_level_id is null and not use_custom
            and allowed_member_ids = '{}'::uuid[])
    and (select count(*) = 0 from public.sweetness_amounts where product_id = p1)
    and (select count(*) = 4 from public.sweetness_amounts where product_id is null and tenant_id = ta));

  -- sweetness null: the menu has no sweetness any more
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_menu(p1, menu || jsonb_build_object('sweetness', null),
      jsonb_build_array(jsonb_build_object('line_kind', 'fixed', 'raw_material_id', mMilk, 'quantity_used', 180)),
      '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('sweetness_null_removes',
    err is null
    and (select count(*) = 0 from public.product_sweetness where product_id = p1)
    and (select count(*) = 0 from public.sweetness_amounts where product_id = p1));

  -- duplicates: fixed rows still collapse to the last occurrence; slot rows (null material) never collapse
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null;
  begin
    p2 := public.save_menu(null, jsonb_build_object('name', 'เดอร์ตี้มัทฉะ', 'price', 75, 'is_active', true),
      jsonb_build_array(
        jsonb_build_object('line_kind', 'fixed', 'raw_material_id', mMilk, 'quantity_used', 100),
        jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18, 'default_member_id', null, 'allow_special', true),
        jsonb_build_object('line_kind', 'slot', 'group_id', gMatcha, 'quantity_used', 3),
        jsonb_build_object('raw_material_id', mMilk, 'quantity_used', 150)),
      '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('fixed_duplicates_still_collapse',
    err is null
    and (select count(*) = 1 from public.product_recipes where product_id = p2 and line_kind = 'fixed')
    and (select quantity_used = 150 from public.product_recipes where product_id = p2 and raw_material_id = mMilk));
  r := r || jsonb_build_object('slot_rows_not_collapsed',
    err is null
    and (select count(*) = 2 from public.product_recipes where product_id = p2 and line_kind = 'slot' and raw_material_id is null)
    and (select count(*) = 1 from public.product_recipes
          where product_id = p2 and group_id = gBean and default_member_id is null and allow_special and quantity_used = 18)
    -- allow_special left out = allowed (the column default)
    and (select count(*) = 1 from public.product_recipes
          where product_id = p2 and group_id = gMatcha and default_member_id is null and allow_special and quantity_used = 3));
  r := r || jsonb_build_object('_dup_err', coalesce(err, 'none'));

  -- two slot lines for the same group: refused, nothing changes
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_menu(p2, jsonb_build_object('name', 'เปลี่ยนชื่อไม่ควรติด', 'price', 75, 'is_active', true),
      jsonb_build_array(
        jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18),
        jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 9)),
      '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('duplicate_slot_group_rejected',
    err = 'duplicate_slot_group'
    and (select name = 'เดอร์ตี้มัทฉะ' from public.products where id = p2)
    and (select count(*) = 3 from public.product_recipes where product_id = p2));

  -- another shop's group (and another shop's / another group's default member) are refused
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  err := null;
  begin
    perform public.save_menu(p2, jsonb_build_object('name', 'x', 'price', 75, 'is_active', true),
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gB, 'quantity_used', 18)), '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_group';
  err := null;
  begin
    perform public.replace_product_recipes(p2,
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gB, 'quantity_used', 18)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_group';
  err := null;
  begin
    perform public.save_menu(p2, jsonb_build_object('name', 'x', 'price', 75, 'is_active', true),
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18, 'default_member_id', memB)), '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_group_member';
  err := null;
  begin
    perform public.save_menu(p2, jsonb_build_object('name', 'x', 'price', 75, 'is_active', true),
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18, 'default_member_id', memMatcha)), '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_group_member';
  err := null;
  begin
    perform public.save_menu(p2, jsonb_build_object('name', 'x', 'price', 75, 'is_active', true),
      jsonb_build_array(jsonb_build_object('line_kind', 'fixed', 'raw_material_id', mB, 'quantity_used', 18)), '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_material';
  reset role;
  r := r || jsonb_build_object('foreign_group_rejected',
    ok
    and (select name = 'เดอร์ตี้มัทฉะ' from public.products where id = p2)
    and (select count(*) = 3 from public.product_recipes where product_id = p2));

  -- slot quantities follow the same rules as fixed ones; an unknown line kind is refused
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  err := null;
  begin
    perform public.replace_product_recipes(p2, jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 0)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_quantity';
  err := null;
  begin
    perform public.replace_product_recipes(p2, jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 100001)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_quantity';
  err := null;
  begin
    perform public.replace_product_recipes(p2, jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 1.2345)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_quantity';
  err := null;
  begin
    perform public.replace_product_recipes(p2, jsonb_build_array(jsonb_build_object('line_kind', 'sweet', 'group_id', gBean, 'quantity_used', 1)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_recipe_line';
  err := null;
  begin
    perform public.replace_product_recipes(p2, jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 1, 'allow_special', 'yes')));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_recipe_line';
  reset role;
  r := r || jsonb_build_object('slot_rules_checked',
    ok and (select count(*) = 3 from public.product_recipes where product_id = p2));

  -- sweetness must be this shop's sweetener group, its members, this shop's levels, valid amounts
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  -- wrong kind (a bean group)
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('group_id', gBean)), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  -- another shop's sweetener group + member
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', jsonb_build_object(
      'group_id', gSweetB, 'default_member_id', sB, 'allowed_member_ids', '[]'::jsonb, 'use_custom', false)), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  -- default member from another group
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('default_member_id', memHouse)), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  -- an allowed member that is not in the group
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('allowed_member_ids', jsonb_build_array(sCond, memHouse))), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  -- another shop's level as the default level
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('default_level_id', lB)), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  -- an amount over 10,000
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('custom',
      grid || jsonb_build_array(jsonb_build_object('member_id', sSyrup, 'level_id', lHigh, 'amount', 10001)))), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  -- an amount for a sweetener the menu does not use
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('allowed_member_ids', jsonb_build_array(sCond))), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  -- the same (sweetener, level) twice
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('custom',
      grid || jsonb_build_array(jsonb_build_object('member_id', sSyrup, 'level_id', lLow, 'amount', 12)))), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  -- not an object / not an array
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', 'yes'), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('allowed_member_ids', 'x')), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_sweetness';
  reset role;
  r := r || jsonb_build_object('sweetness_refs_checked',
    ok
    and (select count(*) = 0 from public.product_sweetness where product_id = p2)
    and (select name = 'เดอร์ตี้มัทฉะ' from public.products where id = p2)
    and (select count(*) = 3 from public.product_recipes where product_id = p2));

  -- "ใช้ปริมาณเฉพาะเมนูนี้" with a table that misses a level of one sweetener is refused
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_menu(p2, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('custom',
      (select jsonb_agg(c) from jsonb_array_elements(grid) c
        where not ((c->>'member_id')::uuid = sMix and (c->>'level_id')::uuid = lHigh)))), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := err = 'sweetness_table_incomplete';
  -- but a table without the ไม่หวาน cells is complete (ไม่หวาน is always 0)
  err := null;
  begin
    p3 := public.save_menu(null, menu || jsonb_build_object('sweetness', sweet || jsonb_build_object('custom',
      (select jsonb_agg(c) from jsonb_array_elements(grid) c where (c->>'level_id')::uuid <> lNone))), '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err is null and p3 is not null;
  reset role;
  r := r || jsonb_build_object('sweetness_incomplete_rejected',
    ok and (select count(*) = 9 from public.sweetness_amounts where product_id = p3));

  -- ── STAFF session: forbidden, nothing changes ────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  ok := true;
  err := null;
  begin
    p4 := public.save_menu(null, menu || jsonb_build_object('sweetness', sweet),
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18)), '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'forbidden' and p4 is null;
  err := null;
  begin
    perform public.save_menu(p2, menu, '[]'::jsonb, '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'forbidden';
  err := null;
  begin
    perform public.replace_product_recipes(p2, jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'forbidden';
  reset role;
  r := r || jsonb_build_object('staff_forbidden',
    ok
    and (select name = 'เดอร์ตี้มัทฉะ' from public.products where id = p2)
    and (select count(*) = 3 from public.product_recipes where product_id = p2)
    and (select count(*) = 0 from public.products where tenant_id = ta and name = 'ลาเต้' and id not in (p1, p3)));

  -- ── tenant B owner cannot write into tenant A's menu ─────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_menu(p2, menu, jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gB, 'quantity_used', 18)), '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('other_shop_menu_not_found',
    err = 'product_not_found' and (select count(*) = 3 from public.product_recipes where product_id = p2));

  -- ── a sweetener group is never a recipe line; a special default needs specials allowed ──
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_menu(p2, jsonb_build_object('name', 'x', 'price', 75, 'is_active', true),
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gSweet, 'quantity_used', 20)), '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := err = 'invalid_group';
  err := null;
  begin
    perform public.replace_product_recipes(p2,
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gSweet, 'quantity_used', 20)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_group';
  reset role;
  r := r || jsonb_build_object('sweetener_group_slot_rejected',
    ok and (select count(*) = 3 from public.product_recipes where product_id = p2));

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_menu(p2, jsonb_build_object('name', 'x', 'price', 75, 'is_active', true),
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18,
        'default_member_id', memSpec, 'allow_special', false)), '{}'::uuid[]);
  exception when others then err := sqlerrm; end;
  ok := err = 'special_default_not_allowed';
  -- the same special default with specials allowed, and a house default with specials off, are fine
  err := null;
  begin
    p5 := public.save_menu(null, jsonb_build_object('name', 'Espresso เคนยา', 'price', 80, 'is_active', true),
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18,
        'default_member_id', memSpec, 'allow_special', true)), '{}'::uuid[]);
    perform public.replace_product_recipes(p5,
      jsonb_build_array(jsonb_build_object('line_kind', 'slot', 'group_id', gBean, 'quantity_used', 18,
        'default_member_id', memHouse, 'allow_special', false)));
  exception when others then err := sqlerrm; end;
  ok := ok and err is null;
  reset role;
  r := r || jsonb_build_object('special_default_not_allowed_rejected',
    ok and (select count(*) = 3 from public.product_recipes where product_id = p2)
    and (select count(*) = 1 from public.product_recipes
          where product_id = p5 and default_member_id = memHouse and not allow_special));

  -- ── save_option_effects: the option's set is replaced in one transaction ──
  -- tenant B's own effect on its own option (as the default role) — must stay untouched throughout
  insert into public.modifier_option_effects (tenant_id, option_id, kind, group_id, amount) values (tb, optB, 'slot_add', gB, 7);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(
      jsonb_build_object('kind', 'slot_add', 'group_id', gBean, 'amount', 9),
      jsonb_build_object('kind', 'material_add', 'raw_material_id', mMilk, 'amount', 15)));
  exception when others then err := sqlerrm; end;
  ok := ok and err is null
    and (select count(*) = 2 from public.modifier_option_effects where option_id = optA and tenant_id = ta);
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(
      jsonb_build_object('kind', 'slot_add', 'group_id', gMatcha, 'amount', 3)));
  exception when others then err := sqlerrm; end;
  ok := ok and err is null
    and (select count(*) = 1 from public.modifier_option_effects
          where option_id = optA and tenant_id = ta and kind = 'slot_add' and group_id = gMatcha
            and raw_material_id is null and amount = 3);
  -- a set with one bad entry changes nothing (its first, valid entry is not written either)
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(
      jsonb_build_object('kind', 'material_add', 'raw_material_id', mIce, 'amount', 5),
      jsonb_build_object('kind', 'slot_add', 'group_id', gB, 'amount', 9)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_group'
    and (select count(*) = 1 from public.modifier_option_effects where option_id = optA)
    and (select count(*) = 1 from public.modifier_option_effects where option_id = optA and group_id = gMatcha);
  reset role;
  r := r || jsonb_build_object('effects_replaced_atomically', ok);

  -- another shop's option / group / material are refused; that shop's own effect is untouched
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  err := null;
  begin
    perform public.save_option_effects(optB, '[]'::jsonb);
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'option_not_found';
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(jsonb_build_object('kind', 'slot_add', 'group_id', gB, 'amount', 9)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_group';
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(jsonb_build_object('kind', 'material_add', 'raw_material_id', mB, 'amount', 9)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_material';
  reset role;
  r := r || jsonb_build_object('foreign_option_rejected',
    ok and (select count(*) = 1 from public.modifier_option_effects where option_id = optB and tenant_id = tb and amount = 7)
    and (select count(*) = 1 from public.modifier_option_effects where option_id = optA));

  -- sweetener groups, archived materials, bad amounts, repeats, unknown kinds and bad shapes are refused
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  ok := true;
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(jsonb_build_object('kind', 'slot_add', 'group_id', gSweet, 'amount', 9)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_group';
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(jsonb_build_object('kind', 'material_add', 'raw_material_id', mArch, 'amount', 9)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_material';
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(jsonb_build_object('kind', 'slot_add', 'group_id', gBean, 'amount', 0)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_effect_amount';
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(jsonb_build_object('kind', 'slot_add', 'group_id', gBean, 'amount', 1.2345)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_effect_amount';
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(jsonb_build_object('kind', 'slot_add', 'group_id', gBean, 'amount', 100001)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_effect_amount';
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(
      jsonb_build_object('kind', 'slot_add', 'group_id', gBean, 'amount', 9),
      jsonb_build_object('kind', 'slot_add', 'group_id', gBean, 'amount', 9)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'duplicate_effect';
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_array(jsonb_build_object('kind', 'drop', 'group_id', gBean, 'amount', 9)));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_effect';
  err := null;
  begin
    perform public.save_option_effects(optA, jsonb_build_object('kind', 'slot_add'));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_effect';
  err := null;
  begin
    perform public.save_option_effects(optA,
      (select jsonb_agg(jsonb_build_object('kind', 'material_add', 'raw_material_id', mMilk, 'amount', i)) from generate_series(1, 21) i));
  exception when others then err := sqlerrm; end;
  ok := ok and err = 'invalid_effect';
  reset role;
  r := r || jsonb_build_object('effect_rules_checked',
    ok and (select count(*) = 1 from public.modifier_option_effects where option_id = optA and group_id = gMatcha));

  -- staff cannot save effects; nothing changes
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_option_effects(optA, '[]'::jsonb);
  exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('staff_forbidden_effects',
    err = 'forbidden' and (select count(*) = 1 from public.modifier_option_effects where option_id = optA));

  -- an empty set clears the option's effects (and nobody else's)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  err := null;
  begin
    perform public.save_option_effects(optA, '[]'::jsonb);
  exception when others then err := sqlerrm; end;
  reset role;
  r := r || jsonb_build_object('effects_empty_set_clears',
    err is null and (select count(*) = 0 from public.modifier_option_effects where option_id = optA)
    and (select count(*) = 1 from public.modifier_option_effects where option_id = optB));

  -- ── grants: anon cannot call any of the three functions ─────────────────
  r := r || jsonb_build_object('grants_kept',
    not has_function_privilege('anon', 'public.save_menu(uuid, jsonb, jsonb, uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.replace_product_recipes(uuid, jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.save_menu(uuid, jsonb, jsonb, uuid[])', 'execute')
    and has_function_privilege('authenticated', 'public.replace_product_recipes(uuid, jsonb)', 'execute')
    and (select not prosecdef from pg_proc where oid = 'public.save_menu(uuid, jsonb, jsonb, uuid[])'::regprocedure)
    and (select not prosecdef from pg_proc where oid = 'public.replace_product_recipes(uuid, jsonb)'::regprocedure)
    and (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'save_menu')
    and (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'replace_product_recipes')
    and not has_function_privilege('anon', 'public.save_option_effects(uuid, jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.save_option_effects(uuid, jsonb)', 'execute')
    and (select not prosecdef from pg_proc where oid = 'public.save_option_effects(uuid, jsonb)'::regprocedure)
    and (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'save_option_effects'));

  raise exception 'RESULT %', r;
end $$;
