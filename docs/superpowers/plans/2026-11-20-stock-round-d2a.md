# Round D2a — Front-of-shop essentials (งานหน้าร้านก่อนเปิดใช้จริง) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the 30 Dec 2569 cut-over, every cup also deducts its packaging, and the shop can do these from the POS in a few taps:
- record waste
- receive goods
- pause or resume a menu

The POS tells staff what is running out ("เหลือ ~N แก้ว" / "หมด?") without ever blocking a sale. The owner gets a list of "ยอดน่าจะผิด" flags.

**Architecture:** The same shape as D1.
- **Pure TS stock core:** `stock-core.ts` resolves a cart line, now including its packaging set or "แก้วร้าน". A new pure module (`availability.ts`) turns live stock levels into per-menu and per-chip states.
- **SQL:** `order_record` / `order_void` stay one transaction per bill and gain bill-level stock lines (bags). New service-role functions cover:
  - pause / resume
  - waste undo
  - flags
  - saving a packaging set

  Every stock write still goes through service-role functions.
- **Live levels:** the POS gets them through the existing 30 s `/api/heartbeat` answer and the offline device snapshot.

**Tech Stack:** Next.js 16.2.9 (App Router, server actions — read `node_modules/next/dist/docs/` before writing Next code), React 19.2, Supabase Postgres 17 (plpgsql), node:test (`npm test`), Tailwind tokens in `src/app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-11-17-stock-round-d-design.md` (owner-approved; extra-shot rule updated 2026-11-19).

This plan covers the D2 items the owner wants before cut-over:
- §6.7 packaging
- §7.4 waste
- §7.6 close/open sale, incl. "เหลือ ~N แก้ว"
- §8.1 "งานสต๊อกของน้องบน POS", the waste / receive / close-open buttons

It also takes these D1 carries:
- R28 "stock skipped" surfaced to the owner
- R38 guarded "นำออกจากกลุ่ม"
- the advisor's unindexed foreign keys

These wait for D2b (Jan 2570, after real use):
- prep items and "เตรียมของ" (§6.6, §7.5)
- counts (§7.7)
- type-A menus built from a bean (§6.5)
- automatic suggestions

The order and dates were agreed with the owner on 2026-11-20:
- D2a builds 23 Nov – 4 Dec
- QR receipt 7–11 Dec
- real-shop setup by ~13 Dec
- rehearsals 19–20 and 26–27 Dec

## Global Constraints

- **Dev and production share ONE Supabase DB** (`khgahdjfkzpgsvbhfrqx`), and production runs D1 since 2026-11-20. Every migration is live the moment it is applied:
  - It must be additive, and the deployed D1 app must keep working.
  - `create or replace` on the same signature only. **No function overloads.**
  - Anything removed is dropped in a phase-two migration after the D2a deploy is READY.
- **SQL process R26/R26a, unchanged from D1:**
  1. Dry run: migration text plus its test in ONE `execute_sql` call. The test ends `raise exception 'RESULT <json>'`, so it always rolls back.
  2. Task review.
  3. Apply the exact committed file.
  4. The controller verifies live `md5(prosrc)` against the committed body.
  5. Regenerate types and hand-merge them into `src/types/database.ts`.
- **Service-role functions:** `language plpgsql security invoker set search_path = public`, then `revoke all … from public, anon, authenticated; grant execute … to service_role`. Called from server actions via `createAdminClient()` after the action has resolved the caller with `getProfile()`. Pattern: `stock_waste` in `supabase/migrations/20261118150000_order_void_stock.sql`.
- **Column grants** (memory "column-grants-new-columns"): `raw_materials`, `inventory_transactions` and `order_items` use column-level SELECT for `authenticated`. This plan adds NO column to those three tables. New tables get explicit grants, with nothing to `anon`.
- **Never refuse a sale because of stock** (spec §4):
  - "หมด?" and "ปิดขาย" are states the cashier can always pass with one tap.
  - The server never rejects a bill for stock or pause state.
- **Staff never see costs** (spec §8). No cost appears on any POS or stock-panel screen. Flags and costs are owner/manager only.
- **Normal orders must not take more taps than today** (spec §5.1-1). The bag counter, "แก้วร้าน" and stock states all default so that a normal cup is still menu → (window) → เพิ่มลงตะกร้า.
- **UI** (spec §8.1):
  - Size, colour and touch:
    - POS chips ≥ 56 px tall with 18 px text.
    - Cart small buttons have a ≥ 48×48 px hit area.
    - Primary buttons are 56–64 px.
    - Colour tokens only: `accent`, `sidebar`, `success`, `warning`, `destructive`, `muted`.
    - Every state carries a word, never colour alone.
    - No long-press-only or swipe-only actions.
  - Copy:
    - Screen words come from the spec §8.1 vocabulary table and the exact strings in this plan.
    - Never show system words (ช่อง, slot, ledger, yield, variance) on staff screens.
  - Feedback and states:
    - Every save shows a green toast in plain Thai. Where undo exists, it carries a 5 s "ย้อนกลับ" (pattern `src/components/inventory/stock-action-form.tsx:68-95`).
    - Offline, the stock-panel buttons are faded and not tappable, with "ใช้ไม่ได้ตอนเน็ตหลุด" (pattern `src/components/pos/disabled-reason.tsx`).
  - The option window stays pinned to the top (392c285). Toasts are the top layer (63736d4).
  - Verify in the Browser pane at 1180×740 and at 375×812.
- **Money maths:** integer satang (`toSatang` in `src/lib/cash.ts`). Packaging and bags change stock and cost only, never the price.
- **Verification commands:** `npm test`, `npx tsc --noEmit`, `npx eslint <changed files>`, `npm run build` (dev output is `.next/dev`, so no clash with the dev server).
- **Live checks** happen only on a disposable QA tenant: `qa-d1-setup.cjs` + `qa-cookie.cjs` in the session scratchpad. The purge loop is guarded by tenant name. Never touch the tenant "The Connect Brew&Bar".
- **Commits and deploys:**
  - Commit per task on `main`. **Push only when the owner says so.**
  - Vercel auto-deploys on push, so never push Sat/Sun.

## Owner-facing decisions in this plan (Claude's calls — listed for the owner to override)

- **D2-1 Bags are bill-level stock.**
  - `order_record` writes them as ledger rows with `order_item_id` null, plus `orders.bags`.
  - A void always puts bags back (made or not), once.
  - Bag cost is counted in reports from the ledger (D3). The Dashboard does not show it in D2a.
- **D2-2 A parked bill keeps each line's "แก้วร้าน"** (inside its items JSON), **but not the bag count.** On resume the bag counter goes back to the shop default.
- **D2-3 "เหลือ ~N แก้ว" shows when N ≤ 10.** "หมด?" shows when fewer than 1 cup is left (spec §7.6 default).
- **D2-4 What makes a menu tile "หมด?":**
  - its fixed recipe materials
  - its packaging set
  - its house beans/matcha, but only when ALL house members of that group are out

  A special, a sweetener or an add-on that is out marks only its own chip "หมด?", never the whole menu (spec decision 17). When the menu's default house member is out, the window starts on the next house member that is not out (spec §7.6).
- **D2-5 Tapping "ยังมีของ ขายต่อ":**
  - It stops asking about that material on that iPad until its level changes, for example after a receive or count.
  - It raises at most one "ยอดน่าจะผิด" flag per material per business day.
- **D2-6 A waste by menu** deducts that cup's packaging too, unless "แก้วร้าน" is ticked in the waste window. That default follows the menu's packaging setting.
- **D2-7 Waste undo** is 10 minutes and once only, by the same person or an owner/manager. The toast offers it for 5 s.
- **D2-8 A paused menu tapped while offline** offers "ขายแก้วนี้" (sells without reopening). Reopening needs the internet.

---

## Task 1: Schema — packaging sets, pause columns, bag settings, flags, FK indexes

**Files:**
- Create: `supabase/migrations/20261123120000_stock_d2a_schema.sql`
- Create: `supabase/tests/stock_d2a_schema_test.sql`
- Modify: `src/types/database.ts` (hand-merge regenerated types)

**Interfaces:**
- Produces, as tables and columns:
  - `packaging_sets(id uuid pk default gen_random_uuid(), tenant_id uuid not null references tenants, name text not null check (char_length(btrim(name)) between 1 and 60), sort_order int not null default 0, archived_at timestamptz, created_at timestamptz not null default now())`
    - unique `(tenant_id, lower(btrim(name))) where archived_at is null`
  - `packaging_set_items(id uuid pk, tenant_id uuid not null, set_id uuid not null references packaging_sets on delete cascade, raw_material_id uuid not null references raw_materials, qty numeric(12,3) not null check (qty > 0 and qty <= 1000))`
    - unique `(set_id, raw_material_id)`
  - `products` gains:
    - `packaging_set_id uuid references packaging_sets` (null = no packaging deduction)
    - `house_glass_default boolean not null default false`
    - `paused_at timestamptz`
    - `paused_by uuid references profiles`
  - `tenants` gains:
    - `bag_material_id uuid references raw_materials`
    - `bags_per_cups int check (bags_per_cups between 1 and 20)` (null = 0 bags by default)
  - `orders` gains `bags int not null default 0 check (bags between 0 and 99)`.
  - `stock_flags(id uuid pk, tenant_id uuid not null, kind text not null check (kind in ('sold_while_out','stock_skipped')), raw_material_id uuid references raw_materials, product_id uuid references products, order_id uuid references orders, business_date date not null, detail text check (char_length(detail) <= 300), created_by uuid references profiles, created_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid references profiles)`
    - unique `(tenant_id, raw_material_id, business_date) where kind = 'sold_while_out'`
  - A partial unique index for bill-level stock:
    - on `inventory_transactions (order_id, raw_material_id, type) where order_item_id is null and type in ('sale','void_restock') and not legacy`
    - The D1 index `inventory_transactions_one_per_item_material_type` can't catch these rows because their `order_item_id` is null.
- **RLS and grants:**
  - `packaging_sets` and `packaging_set_items`:
    - select: same tenant
    - insert/update/delete: same tenant, owner/manager, and `public.config_refs_ok('packaging_set_items', to_jsonb(row))` for items
    - Extend `config_refs_ok` with a `'packaging_set_items'` case (set and material in the caller's tenant) and a `'packaging_sets'` case (`true`). Do this with `create or replace` on the same signature, copying the live body from `supabase/migrations/20261118160000_stock_lockdown.sql` and adding the two cases.
  - `stock_flags`:
    - select: same tenant AND owner/manager
    - no insert/update/delete for `authenticated`; writes go through Task 2 functions
  - `revoke all on <new tables> from anon`.
  - `products`: the pause columns are written only by `set_menu_paused` (Task 2).
- **FK indexes** (advisor): add a btree index on every foreign-key column of the D1 tables that the performance advisor lists as unindexed, plus all FK columns of the new tables. Get the list with `get_advisors(type: performance)` at task start, and paste it into the migration header as a comment.

- [ ] **Step 1: Write `supabase/tests/stock_d2a_schema_test.sql`** in the D1 test style (`supabase/tests/stock_lockdown_test.sql` header). Sessions use `set local role` + `request.jwt.claims`. Keys, all must be true:
  - `owner_creates_set_with_items`
  - `manager_creates_set`
  - `staff_cannot_write_set`
  - `anon_reads_nothing`
  - `set_item_other_tenant_material_refused`
  - `set_name_unique_per_tenant_case_insensitive`
  - `archived_set_name_reusable`
  - `staff_reads_sets` (the POS needs them)
  - `staff_cannot_read_flags`
  - `owner_reads_flags`
  - `nobody_writes_flags_directly`
  - `products_has_pause_columns`
  - `orders_bags_default_0`
  - `bill_level_sale_row_unique` (inserting two bill-level `sale` rows for the same order+material raises 23505)
  - `item_level_index_unchanged`
  - `config_refs_ok_still_fails_closed_for_unknown_table`
- [ ] **Step 2: Dry run** the migration plus the test in one `execute_sql`. Expected: `RESULT` with every key true.
- [ ] **Step 3: Write the migration** with `set local lock_timeout = '5s'` at the top. Header comment:
  - what each object is for
  - the advisor FK list
  - "additive; the deployed D1 app ignores every new column"
- [ ] **Step 4: Re-run the dry run.** Expected: all true. Commit the migration and test, then request review. The controller applies after review (R26a) and verifies the `config_refs_ok` md5.
- [ ] **Step 5: Regenerate types, hand-merge, `npx tsc --noEmit`, commit**
  ```bash
  git commit -m "feat(d2a): packaging sets, pause columns, bag settings, stock flags, FK indexes"
  ```

## Task 2: Service-role functions — pause, packaging save, waste undo, flags

**Files:**
- Create: `supabase/migrations/20261123130000_stock_d2a_functions.sql`
- Create: `supabase/tests/stock_d2a_functions_test.sql`

**Interfaces:**
- Produces (all service-role, actor re-checked against `profiles` in the tenant, `is_active` member):
  - `set_menu_paused(p_tenant_id uuid, p_actor_id uuid, p_product_id uuid, p_paused boolean) returns timestamptz`
    - Any role.
    - Sets `paused_at = now(), paused_by = actor`, or nulls both.
    - Returns the new `paused_at`.
    - Raises `product_not_found` for a foreign or archived product.
  - `save_packaging_set(p_id uuid, p_name text, p_items jsonb) returns uuid`
    - **SECURITY INVOKER called with the user client**, like `save_option_effects` in `20261118170000_save_menu_slots.sql`.
    - Upserts the set and replaces all its items in one transaction.
    - `p_items = [{ "material_id": uuid, "qty": number }]`, 1–20 items, no duplicate material.
    - Errors: `name_required`, `name_taken`, `too_many_items`, `duplicate_material`, `invalid_qty`, `material_not_found`.
  - `archive_packaging_set(p_id uuid) returns void` (INVOKER, user client)
    - Raises `set_in_use` while any non-archived product has `packaging_set_id = p_id`.
  - `stock_waste_undo(p_tenant_id uuid, p_actor_id uuid, p_ref_id uuid) returns int` (rows reversed)
    - Only within 10 minutes of the waste rows' `created_at`.
    - Only by the person who recorded it, or an owner/manager.
    - Once only. A second call raises `already_undone`.
    - Writes one row per original waste row: `type 'waste'`, `quantity = +original`, same `unit_cost`, same `ref_id`, `reason = 'ย้อนกลับ · ' || original reason`.
    - Updates `current_stock`, with the materials locked in id order.
    - Errors: `not_found`, `too_late`, `forbidden`, `already_undone`.
  - `stock_flag_sold_while_out(p_tenant_id uuid, p_actor_id uuid, p_material_ids uuid[], p_product_id uuid) returns int` (flags inserted)
    - Business date = the Bangkok date. Use the same expression the held-bill functions use for `held_bills.business_date`; find it with `grep -rn "business_date" supabase/migrations`.
    - `on conflict do nothing` on the per-day unique index.
    - Ignores ids of other tenants.
  - `stock_flag_resolve(p_tenant_id uuid, p_actor_id uuid, p_flag_id uuid) returns void`
    - Owner/manager only (`forbidden` otherwise).
    - Sets `resolved_at` / `resolved_by`.

- [ ] **Step 1: Write the test** with these keys:
  - `staff_pauses_and_resumes`
  - `pause_records_actor`
  - `pause_foreign_product_refused`
  - `inactive_member_refused`
  - `save_set_replaces_items_atomically` (a bad item leaves the old items untouched)
  - `save_set_errors_are_codes`
  - `archive_set_in_use_refused`
  - `waste_undo_restores_stock`
  - `waste_undo_net_waste_zero` (the sum of `waste` rows for the ref = 0)
  - `waste_undo_twice_refused`
  - `waste_undo_after_10_min_refused` (backdate `created_at` inside the test)
  - `waste_undo_other_staff_refused`
  - `waste_undo_by_manager_ok`
  - `flag_dedup_per_material_per_day`
  - `flag_foreign_material_ignored`
  - `resolve_by_staff_refused`
  - `anon_and_authenticated_cannot_execute_service_fns`
- [ ] **Step 2: Dry run fails** (the functions are missing).
- [ ] **Step 3: Write the migration.** Check whether `type 'waste'` accepts a positive quantity. If any check constraint refuses it, stop and report NEEDS_CONTEXT; do not change constraints.
- [ ] **Step 4: Dry run passes. Commit, then review.** The controller applies and verifies md5.
  ```bash
  git commit -m "feat(d2a): pause/resume, packaging set save, waste undo, stock flags (service functions)"
  ```

## Task 3: `order_record` and `order_void` — bags at bill level, R28 flag

**Files:**
- Create: `supabase/migrations/20261123140000_order_record_bags.sql`
  - `create or replace` of `order_record` and `order_void`, same signatures
  - Copy the live bodies first: `select pg_get_functiondef('public.order_record'::regproc)`
- Modify: `supabase/tests/order_record_test.sql`, `supabase/tests/stock_sale_test.sql`, `supabase/tests/stock_void_test.sql`

**Interfaces:**
- **Consumes:** Task 1 (`orders.bags`, `stock_flags`, the bill-level index).
- **Produces:** `order_record` reads two new optional keys of `p_order`:
  - `"bags"`: int 0..99, default 0. Stored on `orders.bags`.
  - `"stock"`: `[{ "material_id": uuid, "qty": number }]`, bill-level lines.
    - Validated exactly like item lines and skipped silently when invalid.
    - Locked together with the items' materials in ONE id-ordered lock set (D1's `v_locked` array).
    - Written as `type 'sale'` rows with `order_id` set and `order_item_id` null.
    - Untracked materials write no row.
    - Only on the `created = true` path.
- **R28:** inside the existing stock-block exception handler, insert one `stock_flags` row (`kind 'stock_skipped'`, `order_id`, `detail` = SQLSTATE + the first 200 chars of SQLERRM), then continue as today. The flag insert must not itself raise: wrap it in its own `begin … exception when others then null; end;`.
- **`order_void`:** in every outcome (`none`, `all`, partial), bill-level `sale` rows of the order are restocked as `void_restock` rows (`order_item_id` null), once. The partial unique index makes a second void a no-op, as today.

- [ ] **Step 1: Add the failing test keys**
  - `order_record_test`:
    - `bags_stored`
    - `bags_default_zero_when_absent`
    - `bill_stock_rows_written_once`
    - `bill_stock_replay_no_double`
    - `bill_stock_untracked_no_row`
    - `bill_stock_foreign_material_skipped`
    - `bill_and_item_share_material_one_lock_set` (the same material in an item line and a bill line ends `current_stock` exactly right)
  - `stock_sale_test`: `stock_skipped_flag_written` (force the stock block to fail with an over-precision qty, as D1 does)
  - `stock_void_test`:
    - `void_none_restocks_bags`
    - `void_all_made_restocks_bags`
    - `void_partial_restocks_bags`
    - `second_void_no_double_bags`
- [ ] **Step 2: Dry run** the old functions with the new tests. Expected: the new keys are false and the old keys stay true.
- [ ] **Step 3: Write the migration** (full function bodies, same signatures, grants re-issued).
- [ ] **Step 4: Dry run** the migration with all three tests. Expected: everything true, including every pre-existing key. Also run `order_adjustments_test.sql` and `shift_management_test.sql` (they call `order_record`).
- [ ] **Step 5: Commit, then review.** The controller applies, verifies md5, and re-runs the suites live.
  ```bash
  git commit -m "feat(d2a): order_record records bags as bill-level stock; void returns them; stock-skipped flag"
  ```

## Task 4: Stock core — packaging per cup and "แก้วร้าน"

**Files:**
- Modify:
  - `src/lib/stock/stock-core.ts`
  - `src/lib/stock/catalog-build.ts`
  - `src/lib/stock/catalog.ts`
  - `src/lib/stock/pos-catalog.ts`
  - `src/lib/stock/pos-stock.ts`
  - `src/types/app.ts`
  - `src/lib/order-pricing-core.ts`
  - `src/lib/stock/option-window.ts`
  - `src/lib/stock/menu-cost-preview.ts`
- Test:
  - `src/lib/stock/stock-core.test.ts`
  - `src/lib/stock/catalog-build.test.ts`
  - `src/lib/order-pricing-core.test.ts`
  - `src/lib/stock/option-window.test.ts`
  - `src/lib/stock/menu-cost-preview.test.ts`

**Interfaces:**
- **Consumes:** Task 1 columns (read with explicit column lists; `products.packaging_set_id` / `house_glass_default` are staff-readable).
- **Produces:**
  - `StockCatalogRows` gains:
    - `productPackaging: { product_id: string; packaging_set_id: string | null; house_glass_default: boolean }[]`
    - `packagingSets: { id: string; name: string }[]` (non-archived)
    - `packagingItems: { set_id: string; raw_material_id: string; qty: Num }[]`
  - `StockCatalog` gains:
    - `packaging: Map<string, { setId: string | null; houseGlassDefault: boolean }>`
    - `packagingSets: Map<string, { name: string; items: { materialId: string; qty: number }[] }>`
    - Items whose material is archived are dropped, as for members.
  - `LineChoices` gains `houseGlass?: boolean`.
  - `CartItem` gains `houseGlass?: boolean`. Absent means the menu's default; it is written only when the cashier toggled it.
  - `toLineChoices(item: Pick<CartItem, "choices" | "houseGlass">): LineChoices | undefined`. This changes the parameter from `choices` to the item; update both call sites in `order-pricing-core.ts`.
  - `ChoiceSnapshot` gains optional `packaging?: { houseGlass: true } | { setId: string; name: string }`. Absent when the menu has neither a set nor house-glass default.
  - `resolveLine` adds the set's items × quantity unless the effective house glass is true. Effective = `choices.houseGlass ?? menu.houseGlassDefault`.
  - `export function effectiveHouseGlass(productId: string, houseGlass: boolean | undefined, catalog: StockCatalog): boolean`
  - Shape checks for `houseGlass` (a boolean or absent; anything else is refused) live in Task 6, together with `bags`. `isValidCartChoices` is unchanged: `houseGlass` sits on the item, not inside `choices`.

- [ ] **Step 1: Failing tests**, with these assertions:
  - `resolveLine adds the menu's packaging set per cup`: latte with set {cup16 1, lid 1, straw 1}, qty 2 → stock has cup16 2, lid 2, straw 2 + the recipe lines; snapshot.packaging = { setId, name: "แก้วเย็น 16oz" }.
  - `resolveLine with houseGlass true adds no packaging and says so`: no cup16 line; snapshot.packaging = { houseGlass: true }.
  - `a menu whose default is house glass, toggled off, uses its set`: `houseGlassDefault: true` + `houseGlass: false` → set added.
  - `a menu with no set and no house-glass default has no packaging key`: deepEqual to today's snapshot.
  - `an archived packaging material is skipped, the sale still resolves`
  - `packaging never changes the price`: `priceDeltaSatang` is identical with or without the set.
  - `menu cost preview includes packaging cost`: preview of the latte rises by the set's cost.
  - `toLineChoices carries houseGlass only when set`
  - `pricing core: a bill line with houseGlass passes it to resolveLine`
- [ ] **Step 2: Run, and verify they fail.** `npm test`
- [ ] **Step 3: Implement.** Keep `buildLine` (option window) writing `houseGlass` only when the window's toggle differs from the menu default; Task 7 adds the toggle.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`. Expected: green.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): stock core deducts the menu's packaging set; per-line house glass"
  ```

## Task 5: Availability — cups left, "หมด?", default fallback, local decrement

**Files:**
- Create: `src/lib/stock/availability.ts`, `src/lib/stock/availability.test.ts`

**Interfaces:**
- **Consumes:** Task 4's `StockCatalog` and `resolveLine`.
- **Produces:**
  - `export const NEAR_OUT_CUPS = 10;`
  - `export type Levels = Map<string, number>;` (materialId → current level; only tracked, non-archived materials appear)
  - `export type Availability = { state: "ok" | "low" | "out"; cupsLeft: number | null; limitingMaterialId: string | null };`
  - `export function menuAvailability(productId: string, catalog: StockCatalog, levels: Levels): Availability`
    - cupsLeft is the minimum, over the menu's per-cup needs, of `floor(level / perCupQty)` (level ≤ 0 → 0).
    - The needs are the fixed lines, the packaging set at the menu default, and each slot group, where a group counts as its best non-out house member.
    - Materials missing from `levels` are ignored.
    - `out` when cupsLeft < 1, `low` when 1 ≤ cupsLeft ≤ NEAR_OUT_CUPS, else `ok`. `cupsLeft` is null when nothing tracked applies.
  - `export function needsAvailability(needs: { materialId: string; qty: number }[], levels: Levels): Availability`
    - The one rule behind every chip:
      - a member chip uses `[{ member material, slot qty }]`
      - a sweetener chip uses its amount at the chosen level
      - an add-on option chip uses its `material_add` / `slot_add` effects
    - `menuAvailability` uses it too.
  - `export function fallbackDefaults(productId: string, catalog: StockCatalog, levels: Levels, isSuppressed: (materialId: string) => boolean): Record<string, string>`
    - groupId → the house member the window should start on.
    - That is the menu default unless it is out and not suppressed. Then it is the next house member by `sortOrder` that isn't out. If all are out, it stays the menu default.
  - `export function levelsAfter(levels: Levels, pending: { materialId: string; qty: number }[][]): Levels`
    - Subtracts this device's queued, unsynced bills' stock lines.
  - `export function suppressionKey(materialId: string, level: number): string`
    - A suppressed material stops being suppressed when its level changes.

- [ ] **Step 1: Failing tests:**
  - `menu ok when every material covers more than 10 cups`
  - `menu low shows cups left from the scarcest material`: milk 1,000 ml, 180/cup → `low`, cupsLeft 5, limiting milk.
  - `menu out under one cup`: milk 150 → `out`, cupsLeft 0.
  - `negative level counts as zero`
  - `untracked material never limits`
  - `missing level is ignored, never out`
  - `packaging set item can make the menu out`: cups16 0 → `out`, limiting cup16.
  - `house group: menu out only when all house members are out`
  - `special out does not make the menu out`
  - `fallback default skips an out house default to the next house member`
  - `fallback keeps the default when it is suppressed`
  - `fallback keeps the default when every house member is out`
  - `levelsAfter subtracts queued bills`: two queued lattes take milk 1,000 → 640.
  - `suppression ends when the level changes`: `suppressionKey("milk", 150) !== suppressionKey("milk", 2150)`.
- [ ] **Step 2: Run, and verify they fail.**
- [ ] **Step 3: Implement.** Pure, no I/O, no React. Per-cup needs come from `resolveLine(productId, 1, <defaults>, [], catalog)` so the rules can't drift from the sale path.
- [ ] **Step 4: Run** `npm test`. Expected: green.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): availability rules (cups left, out, default fallback, local decrement)"
  ```

## Task 6: Bags and house glass through the sale path (server, drafts, outbox, held bills)

**Files:**
- Modify:
  - `src/types/app.ts` (`CreateOrderInput.bags?: number`)
  - `src/app/actions/orders.ts`
  - `src/lib/order-pricing-core.ts`
  - `src/lib/offline/cart-draft.ts`
  - `src/lib/offline/outbox-rules.ts`
  - `src/lib/payment-attempt.ts`
  - `src/lib/held-bill-items.ts`
  - `src/lib/cart-lines.ts`
- Create: `src/lib/bags.ts`, `src/lib/bags.test.ts`
- Test: the matching `*.test.ts` files

**Interfaces:**
- **Consumes:** Task 3 (`p_order.bags` / `p_order.stock`), Task 4 (`houseGlass`).
- **Produces:**
  - `export function defaultBags(cups: number, bagsPerCups: number | null): number` → `bagsPerCups ? Math.ceil(cups / bagsPerCups) : 0`.
  - `export function billStockLines(bags: number, bagMaterialId: string | null): { materialId: string; qty: number }[]`
  - `createOrder`:
    - Validates `bags`: integer 0..99, absent → 0. Anything else is refused as "ข้อมูลไม่ถูกต้อง".
    - Reads `tenants.bag_material_id` with the admin client in the same tenant read it already does.
    - Sends `p_order.bags` and `p_order.stock`.
  - `createOrder`'s item check, the draft's `validItem` and the outbox checks accept `houseGlass` as a boolean or absent, and refuse any other type.
  - Line identity (`addLine` merge) includes the effective house glass. A cup in "แก้วร้าน" and a paper-cup latte never merge.
  - The money fingerprint (`payment-attempt.ts`) does NOT include `bags` or `houseGlass`: they never change what is charged. Changing them after an uncertain attempt must reuse the same client_ref (no second bill).
  - Draft and outbox keep `bags` and `houseGlass`. Entries saved before D2a (no keys) still restore and sync.
  - Held bills keep `houseGlass` per line (it travels inside `items` JSON) and do NOT keep `bags` (D2-2).

- [ ] **Step 1: Failing tests:**
  - `defaultBags`: (3, null) → 0; (3, 2) → 2; (1, 2) → 1; (0, 2) → 0.
  - `billStockLines`: no material → []; 2 bags → one line qty 2.
  - `createOrder payload carries bags and bill stock` (on the pure payload builder in `order-items-payload.ts`, or wherever `p_order` is built — extract a pure `orderPayload()` if needed).
  - `bags outside 0..99 or non-integer refused`
  - `houseGlass that is not a boolean is refused (createOrder, draft, outbox)`
  - `addLine keeps a house-glass latte separate from a paper-cup latte`
  - `payment fingerprint ignores bags and houseGlass`
  - `draft restores bags and houseGlass; a pre-D2a draft restores with bags 0`
  - `outbox accepts entries with and without bags`
  - `held bill items keep houseGlass after normalizeHeldItems`
- [ ] **Step 2: Run, and verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`. Expected: green.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): bags and house glass travel with the bill (server, draft, outbox, held)"
  ```

## Task 7: Cart and bill words — "แก้วร้าน" toggle, bag counter, bill history

**Files:**
- Modify:
  - `src/components/pos/smart-cart.tsx`
  - `src/components/pos/pos-screen.tsx`
  - `src/components/pos/modifier-modal.tsx`
  - `src/lib/stock/option-window.ts` (`cartLineParts`, `billLineDetail`)
  - `src/app/(shell)/orders/[id]/page.tsx`
- Test: `src/lib/stock/option-window.test.ts`

**Interfaces:**
- **Consumes:** Task 4 (`effectiveHouseGlass`, `snapshot.packaging`) and Task 6 (`defaultBags`, `CartItem.houseGlass`).
- **Produces:**
  - **Cart line row 3** (layout A, 392c285): between the hint and − 1 + sits a toggle button.
    - Text: "แก้วร้าน" when off, "แก้วร้าน ✓" when on, styled solid `accent` when on.
    - Hit area ≥ 48×48. `aria-pressed`.
    - Shown only when the menu has a packaging set or a house-glass default.
    - Toggling writes `houseGlass` (deleted again when back to the menu default) and does not change the price.
  - **Bag counter** above the payment-method row: "ถุง" [−] n [+], 48 px buttons.
    - Shown only when the shop has a bag material.
    - Value = `defaultBags(totalCups, bagsPerCups)` until the cashier taps − or +. From then it keeps the cashier's value for this bill.
    - Resets after a sale, clear, park or resume (D2-2).
  - **Cart and bill words:** append "แก้วร้าน" as a part (`changed: true` when it differs from the menu default) when house glass is used.
  - **`/orders/[id]`:** shows "ถุง n" under the items when `orders.bags > 0`.
  - **Option window:** no toggle. The cart is the one place for it (spec §6.7).
  - **Pages:** `/pos` loads `bag_material_id` and `bags_per_cups` (owner-safe; no cost).

- [ ] **Step 1: Failing tests:**
  - `cart words add แก้วร้าน only when house glass is used`
  - `a menu served in house glass by default shows แก้วร้าน unbolded`
  - `bill words read the snapshot's houseGlass`
- [ ] **Step 2: Run, and verify they fail.**
- [ ] **Step 3: Implement.** Then check in the Browser pane at 1180×740 and 375×812 on the QA tenant. A normal latte still takes the same taps, and the bag counter shows 0 for The Connect's settings.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, eslint. Expected: clean.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): cart house-glass toggle, bag counter, bill shows house glass and bags"
  ```

## Task 8: Owner setup — packaging sets page, menu editor, shop bag settings, cost preview

**Files:**
- Create:
  - `src/app/(shell)/inventory/packaging/page.tsx`
  - `src/components/inventory/packaging-sets-manager.tsx`
  - `src/app/actions/packaging.ts`
- Modify:
  - `src/components/products/menu-editor.tsx`
  - `src/components/products/menu-editor-types.ts`
  - `src/app/actions/products.ts`
  - `supabase/migrations/20261123150000_save_menu_packaging.sql` (`create or replace save_menu`, same signature; reads `p_menu->>'packaging_set_id'` and `p_menu->>'house_glass_default'`; refuses a set of another tenant or an archived one with `packaging_set_not_found`)
  - `supabase/tests/save_menu_slots_test.sql` (new keys)
  - `src/app/(shell)/settings/page.tsx` and its settings action (owner only)
- Test: the pure parsers in `src/lib/stock/packaging-input.ts` (create) and `src/lib/stock/packaging-input.test.ts`

**Interfaces:**
- **Consumes:** Task 1 tables and Task 2 `save_packaging_set` / `archive_packaging_set`.
- **Produces:**
  - **Page "ชุดภาชนะ"** (owner/manager):
    - Lists sets with their items and cost per cup (owner/manager may see costs).
    - Create and edit (name, then items picked from materials, "บรรจุภัณฑ์" category first, each with a qty per cup).
    - "เก็บเข้าคลัง" is refused while menus use the set, naming them: "ใช้อยู่ในเมนู: ลาเต้, อเมริกาโน่".
    - Linked from the inventory page header next to "กลุ่มตัวเลือก".
  - **Menu editor section "ภาชนะ":**
    - A select: none ("ไม่หักภาชนะ") or one set.
    - A checkbox "ปกติเสิร์ฟแก้วร้าน".
    - The cost preview includes the set (Task 4).
  - **Settings section "ถุงหิ้ว"** (owner only):
    - "วัตถุดิบถุง": a material select, or none.
    - "ถุงเริ่มต้นต่อบิล": the radio "ไม่ใส่อัตโนมัติ" or "1 ถุงต่อทุก N แก้ว" with N from 1–20.
  - `parsePackagingSetDraft(draft) → { value } | { error }` returns the Thai errors:
    - "ตั้งชื่อชุดภาชนะ"
    - "ใส่วัตถุดิบอย่างน้อย 1 อย่าง"
    - "วัตถุดิบซ้ำกัน — รวมเป็นบรรทัดเดียว"
    - "จำนวนต่อแก้วต้องมากกว่า 0 ไม่เกิน 1,000"
    - "ตั้งได้ไม่เกิน 20 บรรทัด"

- [ ] **Step 1: Failing tests:** `parsePackagingSetDraft` returns each error above, and the SQL keys `save_menu_writes_packaging`, `save_menu_refuses_foreign_set`, `save_menu_without_packaging_keys_unchanged` (the D1 editor payload still works).
- [ ] **Step 2: Run, and verify they fail.** Run `npm test` and the dry run.
- [ ] **Step 3: Implement.** Then check live on the QA tenant: create "แก้วเย็น 16oz" (แก้ว 16oz 1, ฝาโดม 1, หลอด 1), set it on ลาเต้, and confirm the cost preview rises.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, eslint, and the dry run. Expected: clean. The SQL then goes to review and is applied by the controller.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): packaging sets page, menu packaging, shop bag settings"
  ```

## Task 9: Live levels on the POS — heartbeat, snapshot, local decrement

**Files:**
- Modify:
  - `src/app/api/heartbeat/route.ts`
  - `src/components/pos/use-heartbeat.ts`
  - `src/components/pos/use-device-snapshot.ts`
  - `src/components/pos/pos-screen.tsx`
  - `src/app/(shell)/pos/page.tsx`
- Create: `src/lib/stock/live-stock.ts`, `src/lib/stock/live-stock.test.ts`

**Interfaces:**
- **Consumes:** Task 5 (`Levels`, `levelsAfter`), Task 1 (`products.paused_at`).
- **Produces:**
  - The heartbeat answer gains `stock?: { levels: Record<string, number>; paused: string[] }`.
    - Read with the user client: `raw_materials (id, current_stock)` where `track_stock and archived_at is null`, plus `products (id)` where `paused_at is not null`.
    - Both columns are staff-readable after the lockdown. Omitted when the read fails, like the other fields.
  - `export type LiveStock = { levels: Levels; paused: Set<string>; at: number }`
  - `export function mergeLiveStock(prev: LiveStock, answer: { levels: Record<string, number>; paused: string[] }, at: number): LiveStock`
    - The newer `at` wins.
  - The POS page passes the initial `LiveStock`. The POS calls `checkNow()` right after each successful sale, waste, receive or pause. The device snapshot stores the last `LiveStock` for offline.
  - Offline, effective levels = `levelsAfter(snapshot levels, stock lines of this device's queued outbox bills)`. The lines are computed with `resolveLine` from each queued bill's items.

- [ ] **Step 1: Failing tests:** `mergeLiveStock` (newer wins, older ignored, paused set replaced), `levels from queued outbox bills` (two queued lattes reduce milk by 360).
- [ ] **Step 2: Run, and verify they fail.**
- [ ] **Step 3: Implement.** Check with two Browser-pane tabs on the QA tenant: a sale or pause on tab A shows on tab B within one heartbeat (≤ 30 s), or on refocus.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`. Expected: green.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): POS receives live stock levels and paused menus via the heartbeat"
  ```

## Task 10: POS states — "ปิดขาย", "หมด?", "เหลือ ~N แก้ว", tap-through, flags

**Files:**
- Modify:
  - `src/components/pos/product-grid.tsx`
  - `src/components/pos/modifier-modal.tsx`
  - `src/components/pos/pos-screen.tsx`
  - `src/lib/stock/option-window.ts` (rows carry a per-chip state; the window starts from `fallbackDefaults`)
- Create:
  - `src/components/pos/stock-state-dialog.tsx`
  - `src/app/actions/stock-pos.ts` (`flagSoldWhileOut`, `setMenuPaused`)
- Test: `src/lib/stock/option-window.test.ts`, plus a pure `src/lib/stock/pos-states.ts` and `src/lib/stock/pos-states.test.ts`

**Interfaces:**
- **Consumes:** Task 5 and Task 9 (`LiveStock`), Task 2 (`set_menu_paused`, `stock_flag_sold_while_out`).
- **Produces:**
  - `export type TileState = { kind: "paused" } | { kind: "out"; materialId: string } | { kind: "low"; cupsLeft: number } | { kind: "ok" }`
  - `export function tileState(productId, catalog, live: LiveStock, suppressed: Set<string>): TileState`
    - "paused" wins over out/low.
  - **Tile looks:**
    - paused: grey, label "ปิดขาย"
    - out: faded, dashed border, label "หมด?"
    - low: `warning` label "เหลือ ~N แก้ว"
    - ok: unchanged
    - The tile stays tappable in every state.
  - **Tap on an "out" tile:** `StockStateDialog`
    - Title: "{เมนู}: ระบบคิดว่า{วัตถุดิบ}หมด"
    - Body: "ยังมีของอยู่?"
    - Buttons:
      - [ยังมีของ ขายต่อ] → suppress that material on this iPad (`suppressionKey`), flag once (`flagSoldWhileOut`, best-effort, never blocks), then continue to the option window or cart exactly as a normal tap
      - [ไม่มีแล้ว ปิดขาย] → `setMenuPaused(productId, true)` with toast "ปิดขาย: {เมนู}"
      - [ยกเลิก]
  - **Tap on a "paused" tile:**
    - Online: "{เมนู} ปิดขายอยู่" [เปิดขายแล้วสั่ง] → `setMenuPaused(false)`, then continue as a normal tap, or [ยกเลิก].
    - Offline: body "เปิดขายได้เมื่อต่อเน็ต", buttons [ขายแก้วนี้] (continue without reopening) and [ยกเลิก] (D2-8).
  - **Option-window chips** for members, sweeteners and option-effect materials that are out: faded, dashed, with "หมด?" after the label. The first tap opens the same dialog without the "ปิดขาย" button; "ยังมีของ ขายต่อ" then selects the chip.
  - **The window's starting house member** = `fallbackDefaults(...)` (D2-4). The cart shows the starting member like any choice, bolded when it differs from the menu default, so the barista sees "คั่วเข้ม" in bold when คั่วกลาง ran out.
  - `flagSoldWhileOut(materialIds: string[], productId: string): Promise<void>` and `setMenuPaused(productId: string, paused: boolean): Promise<{ error?: string }>` (server actions; any active member; admin client → Task 2 functions).

- [ ] **Step 1: Failing tests:**
  - `tileState paused beats out`
  - `tileState out names the limiting material`
  - `tileState low gives cups left`
  - `suppressed material no longer makes the tile out`
  - `window starts on the next house member when the default is out`
  - `special chip out keeps the menu ok`
  - `out chip becomes selectable after the cashier confirms` (pure state transition)
- [ ] **Step 2: Run, and verify they fail.**
- [ ] **Step 3: Implement.** Then check live on the QA tenant (1180×740):
  1. Set milk to 150 ml through an adjust → the ลาเต้ tile shows "หมด?".
  2. Tap → "ยังมีของ ขายต่อ" → the window opens and the sale works. One flag row exists. A second sale doesn't ask again. A receive of 2,000 ml clears the suppression.
  3. Pause from the dialog → "ปิดขาย". Tap → "เปิดขายแล้วสั่ง".
  4. Count taps for a normal latte: it must stay the same.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, eslint. Expected: clean.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): POS shows paused/out/low states, never blocks, flags wrong stock"
  ```

## Task 11: "สต๊อก" panel — waste (menu or material) with undo, and close/open list

**Files:**
- Create:
  - `src/components/pos/stock-panel.tsx`
  - `src/components/pos/waste-flow.tsx`
  - `src/components/pos/pause-list.tsx`
  - `src/lib/stock/waste-input.ts`
  - `src/lib/stock/waste-input.test.ts`
- Modify:
  - `src/components/pos/pos-header.tsx` (button "สต๊อก" next to "บิลพัก")
  - `src/components/pos/modifier-modal.tsx` (a `mode: "waste"` prop)
  - `src/app/actions/stock-pos.ts` (`recordWaste`, `undoWaste`)

**Interfaces:**
- **Consumes:**
  - Task 2: `stock_waste_undo`, `set_menu_paused`
  - D1: `stock_waste(p_tenant_id, p_actor_id, p_lines, p_reason, p_ref_id)`
  - Task 4: `resolveLine` with packaging (D2-6)
  - Task 9: `checkNow`
- **Produces:**
  - `export const WASTE_REASONS = ["ทำหก", "ชงใหม่ให้ลูกค้า", "หมดอายุ/เสีย", "พนักงานดื่ม", "ชิม/จูนเครื่อง", "อื่น ๆ"] as const;`
  - `export type WasteInput = { kind: "menu"; productId: string; quantity: number; choices?: CartChoices; optionIds: string[]; houseGlass?: boolean; reason: string; otherText?: string } | { kind: "material"; materialId: string; qty: number; reason: string; otherText?: string };`
  - `export function parseWasteInput(raw: unknown): { value: WasteInput } | { error: string }`
    - quantity is an integer 1..20.
    - Material qty is > 0, ≤ 100,000, with at most 3 decimals.
    - The reason is one of `WASTE_REASONS`. "อื่น ๆ" needs `otherText` of 1–100 chars.
    - Errors (Thai): "เลือกเหตุผล", "พิมพ์เหตุผลสั้น ๆ", "ใส่จำนวนให้ถูกต้อง".
  - `export function wasteLabel(input, names): string`, e.g. "ลาเต้ เคนยา 1 แก้ว" or "นมโอ๊ต 200 ml".
    - Ledger reason = `${reasonOrOther} · ${wasteLabel}`.
  - `recordWaste(input: WasteInput): Promise<{ refId: string; label: string } | { error: string }>`
    - Any active member.
    - Menu lines come from `resolveLine` on the server catalog.
    - The material must be tracked and not archived.
    - Offline is refused by the client before calling.
  - `undoWaste(refId: string): Promise<{ error?: string }>`, with Thai errors:
    - `too_late` → "เลยเวลาย้อนกลับแล้ว (10 นาที)"
    - `forbidden` → "ย้อนกลับได้เฉพาะคนที่บันทึก หรือผู้จัดการ"
    - `already_undone` → "ย้อนกลับไปแล้ว"
- **Panel:** a dialog with three 64 px buttons, "บันทึกของเสีย", "รับของเข้า" (Task 12), and "ปิด/เปิดขายเมนู". Offline, all three are faded with "ใช้ไม่ได้ตอนเน็ตหลุด".
- **Waste flow (≤ 3 steps):**
  1. A segmented "เมนู | วัตถุดิบ" (default เมนู).
  2. Pick the thing:
     - **เมนู:** the same tiles as the POS grid, tap one, and the option window opens in waste mode:
       - title "บันทึกของเสีย: {เมนู}"
       - a quantity stepper
       - a "แก้วร้าน" toggle row
       - footer "ต่อไป · {n} แก้ว"
     - **วัตถุดิบ:** a list grouped by category showing names and units only, then the numeric keypad (`src/components/pos/numeric-keypad.tsx`) with a unit switch:
       - purchase unit, with chips ¼ ½ ¾
       - use unit
  3. Reason chips (56 px). Tapping one saves at once, except "อื่น ๆ", which opens a one-line text field with [บันทึก].
  - Toast: "บันทึกของเสีย: {label} ({reason})" + "ย้อนกลับ" (5 s). After undo, the toast reads "ย้อนกลับแล้ว: {label}".
- **ปิด/เปิดขายเมนู:** every on-sale menu by category, one 56 px row each, with name and switch.
  - Text "ขายอยู่" / "ปิดขาย"; the switch saves at once.
  - Toasts "ปิดขาย: {เมนู}" / "เปิดขาย: {เมนู}".
  - "ปิดขายอยู่" menus are listed first.

- [ ] **Step 1: Failing tests:** `parseWasteInput` accepts both kinds and returns each error above; `wasteLabel` for a menu with choices, a material in ml, and "อื่น ๆ" text; `reason text joins reason and label`.
- [ ] **Step 2: Run, and verify they fail.**
- [ ] **Step 3: Implement.** Then check live on the QA tenant:
  - **Waste a Kenya latte, reason ทำหก:** ledger waste rows match its recipe, packaging included, and the history drawer shows "ทำหก · ลาเต้ เคนยา 1 แก้ว".
  - **Undo within 5 s:** stock is back.
  - **Waste นมสด ½ ขวด** (purchase unit 2,000 ml): the row is −1,000 ml.
  - **Offline (DevTools offline):** the panel buttons are faded with the reason.
  - **Taps:** count them; every flow takes ≤ 3 steps.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, eslint. Expected: clean.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): POS stock panel — waste by menu or material with undo, close/open list"
  ```

## Task 12: "รับของเข้า" from the POS (staff without price)

**Files:**
- Create: `src/components/pos/receive-flow.tsx`
- Modify: `src/components/pos/stock-panel.tsx`, `src/app/(shell)/pos/page.tsx` (load the staff-safe materials list)
- Reuse: `receiveStock` / `undoReceive` in `src/app/actions/inventory.ts`. Staff are already allowed without a price.

**Interfaces:**
- **Consumes:** D1 `receiveStock(prev, formData)` / `undoReceive(ledgerId)`, and Task 9 `checkNow`.
- **Produces:**
  - **POS page:** loads `raw_materials (id, name, unit, category, purchase_unit, purchase_size, track_stock)`, non-archived, with the user client and explicit columns, never `cost_per_unit`.
  - **Flow (≤ 3 steps):**
    1. Pick the material (grouped list, names only).
    2. Enter the amount on the numeric keypad in the purchase unit ("6 ขวด", with chips ¼ ½ ¾). A use-unit switch is available.
    3. [บันทึกรับของ].
    - Manager/owner also see an optional "ราคาที่จ่าย (บาท)" field. Staff never see a price field.
  - Toast and undo exactly as on the inventory page: "รับของเข้า: {ชื่อ} {n} {หน่วย}" + "ย้อนกลับ".

- [ ] **Step 1: Failing test:** a pure `receiveAmountToUseUnits(amount, unit: "purchase" | "use", material)`, e.g. 6 ขวด × 2,000 ml = 12,000 ml, and ½ ขวด = 1,000 ml. Reuse `src/lib/stock/units.ts` if it already does this, and test the reuse.
- [ ] **Step 2: Run, and verify it fails.**
- [ ] **Step 3: Implement.** Then check live as QA Staff: receive 6 ขวด นมสด with no price field visible; the stock rises by 12,000 and the cost is unchanged. As QA Owner, the price field is visible and the average updates.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, eslint. Expected: clean.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): staff receive goods from the POS stock panel"
  ```

## Task 13: Owner view — "ยอดน่าจะผิด" flags and paused menus on the inventory page

**Files:**
- Modify: `src/app/(shell)/inventory/page.tsx`, `src/lib/dal.ts`
- Create: `src/components/inventory/stock-flags.tsx`, plus an action in `src/app/actions/stock-pos.ts` (`resolveStockFlag`)

**Interfaces:**
- **Consumes:** Task 1 `stock_flags` (owner/manager select) and Task 2 `stock_flag_resolve`.
- **Produces:**
  - **Section "ยอดน่าจะผิด"** above the materials list, shown only when unresolved flags exist, newest first, max 50. Each row has text and a [ตรวจแล้ว] button:
    - sold_while_out: "ขาย{เมนู}ตอนระบบคิดว่า{วัตถุดิบ}หมด · {วันที่} · โดย {ชื่อ}" + a hint "รับของเข้าหรือนับใหม่ให้ตรง"
    - stock_skipped: "หักสต๊อกไม่สำเร็จ · บิล {order_number}" + a link to `/orders/{id}`
  - **Section "ปิดขายอยู่":** paused menus, with who and since when, and a [เปิดขาย] button.
  - `getStockFlags(tenantId)` and `getPausedMenus(tenantId)` in `dal.ts`, gated by owner/manager.

- [ ] **Step 1: Failing test:** a pure `flagText(flag, names)` for both kinds, with the exact strings above.
- [ ] **Step 2: Run, and verify it fails.**
- [ ] **Step 3: Implement.** Then check live: a flag from Task 10 appears here; [ตรวจแล้ว] removes it. Staff are still redirected from `/inventory`.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, eslint. Expected: clean.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): owner sees wrong-stock flags and paused menus"
  ```

## Task 14: D1 carry R38 — guarded "นำออกจากกลุ่ม"

**Files:**
- Modify: `src/app/actions/stock-config.ts`, `src/components/inventory/groups-manager.tsx`
- Create: `src/lib/stock/member-removal.ts`, `src/lib/stock/member-removal.test.ts`

**Interfaces:**
- **Produces:**
  - `export function removalCheck(memberId, ctx): { ok: true; warn: string | null } | { ok: false; reason: string }`
  - **Blocked:**
    - when any menu's sweetness uses the member as default or allowed: "ใช้อยู่ในความหวานของเมนู: {รายชื่อ}"
    - when it is the group's only house member: "ต้องมีเมล็ดร้านอย่างน้อย 1 ตัว"
  - **Warns**, then needs a second tap:
    - when it is a slot default of a menu: "เป็นค่าเริ่มต้นของเมนู: {รายชื่อ} — ระบบจะใช้ตัวร้านตัวถัดไปแทน"
  - Removing the group's flagged default moves the default to the first remaining house member.
  - `removeGroupMember(memberId: string): Promise<StockConfigState>` (owner/manager; tenant checks as R37).

- [ ] **Step 1: Failing tests:** each of the three outcomes above, plus `removing the default moves it`.
- [ ] **Step 2: Run, and verify they fail.**
- [ ] **Step 3: Implement.** The button "นำออกจากกลุ่ม" sits on each member row and is 48 px.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, eslint. Expected: clean.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(d2a): guarded remove-member from a choice group (R38)"
  ```

---

## Final checks (controller)

1. **Whole-branch review** on the most capable model over D2a's base..HEAD, including SQL dry runs of the applied state.
2. **Live DB suites:**
   - all D1 suites
   - `stock_d2a_schema_test`
   - `stock_d2a_functions_test`
   - updated `order_record`, `stock_sale` and `stock_void`
   - advisors, security and performance
3. **Live QA on a QA tenant at 1180×740, on the owner's screen:**
   - a normal order takes the same taps as today
   - "แก้วร้าน" and bags
   - waste with undo
   - receive as Staff
   - pause / resume
   - "หมด?" tap-through with its flag
   - two tabs in sync via the heartbeat
   - offline (panel faded; a queued sale with bags syncs once)
   - a parked bill keeps "แก้วร้าน"
   - void returns the bags
   - phone width
4. **Hand-off:** delete the QA tenant. The owner tests on localhost. Push only on the owner's word, never Sat/Sun.

## Review Focus

1. **Real-shop numbers are wrong on day one.** The first count is rough and the owner may forget a receive, so many tiles may show "หมด?" at once.
   - Expected: one tap per material per iPad and then silence until its level changes; one flag per material per day; a normal order is never slowed twice by the same material.
   - Tests: Task 5 `suppression ends when the level changes`, Task 10 `suppressed material no longer makes the tile out`, Task 2 `flag_dedup_per_material_per_day`.
2. **Two iPads.** iPad A sells the last milk or pauses a menu.
   - Expected: iPad B shows it within one heartbeat (≤ 30 s) or on refocus, and never blocks a sale meanwhile.
   - Tests: Task 9 `mergeLiveStock` + the two-tab live check.
3. **Offline sale with bags and "แก้วร้าน", synced later.**
   - Expected: bags and packaging are deducted once at sync time, with the sale time.
   - Tests: Task 3 `bill_stock_replay_no_double`, Task 6 `outbox accepts entries with and without bags`, and the final offline check.
4. **Changing bags or "แก้วร้าน" after a payment attempt got no answer.**
   - Expected: the retry reuses the same client_ref, so no second bill.
   - Test: Task 6 `payment fingerprint ignores bags and houseGlass`.
5. **A packaging material or set retired while menus still point at it.**
   - Expected: sales keep working and the archived material is skipped; a set in use can't be archived.
   - Tests: Task 4 `an archived packaging material is skipped`, Task 2 `archive_set_in_use_refused`.
