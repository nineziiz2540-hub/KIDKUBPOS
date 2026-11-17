# Round D1 — Stock Foundation (ฐานให้ตัวเลขถูก) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sale deducts exactly the materials the customer chose (house roast or specialty bean/matcha, sweetness level × sweetener, extra shot, add-ons) once, inside the same transaction as the bill; cost per cup is frozen at sale; receive/adjust/void/held-cancel move stock atomically through one ledger; staff can no longer write stock or read costs.

**Architecture:** A pure TypeScript "stock core" resolves each cart line (recipe + choices + option effects + sweetness table) into stock lines and specialty price deltas; `createOrder` passes those lines inside the existing `order_record` JSON (same signature), which writes ledger rows and `order_items.cost_total` only when the bill is newly created. All stock writes go through service-role SQL functions; configuration tables (choice groups, sweetness, option effects) are owner/manager-writable under RLS like `categories`.

**Tech Stack:** Next.js 16.2.9 (App Router, server actions — read `node_modules/next/dist/docs/` before writing Next code), React 19.2, Supabase Postgres 17 (plpgsql), node:test (`npm test`), Tailwind tokens in `src/app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-11-17-stock-round-d-design.md` (owner-approved 2026-11-18). This plan covers phase **D1** only (spec §12). Sections referenced as "spec §x".

## Global Constraints

- **Dev and production share ONE Supabase DB** (`khgahdjfkzpgsvbhfrqx`). Every migration is live the moment it is applied: additive only, the deployed app must keep working; anything removed is dropped in a separate phase-two migration applied only after the D1 deploy is READY.
- **No function overloads.** Change a function only with `create or replace` on the same signature, or add a new name.
- **Service-role functions:** `language plpgsql security invoker set search_path = public`, then `revoke all … from public, anon, authenticated; grant execute … to service_role;` (pattern: `supabase/migrations/20261106120000_order_record_override_held.sql`). Called from server code via `createAdminClient()` after the action checks the role.
- **Config tables RLS:** select = same tenant (`tenant_id = public.auth_tenant_id()`); insert/update/delete = same tenant AND `public.auth_role() in ('owner','manager')`.
- **Never refuse a sale because of stock** (spec §4 anti-goals). Stock lines that cannot be applied are skipped, never raised.
- **Staff never see costs** (spec §8): no cost on any Staff screen; cost columns not selectable by `authenticated` (Task 9).
- After every migration: regenerate types (`generate_typescript_types`) and hand-merge into `src/types/database.ts` (the file is hand-merged; never overwrite blindly).
- Live checks only on a disposable QA tenant (`qa-cookie.cjs` flow in memory); delete it afterwards. Never touch tenant "The Connect Brew&Bar".
- UI rules (spec §5.1, §8.1): POS option chips ≥ 56 px tall, 18 px text, ≥ 8 px gaps; primary buttons 56–64 px; selected = solid `accent` + white text + ✓; colour tokens only (`accent`, `sidebar`, `success`, `warning`, `destructive`, `info`, `muted`); every state has a word, never colour alone; no long-press-only actions; screen words exactly from spec §8.1 vocabulary table; verify in the Browser pane at 1180×740.
- Money maths in integer satang (`toSatang` in `src/lib/cash.ts`), as `order-pricing-core.ts` does.
- Verification commands: `npm test`, `npx tsc --noEmit`, `npx eslint <changed files>`, `npm run build` (stop the dev preview first).
- Commit per task on `main`. **Push only when the owner says so.**

## Review Focus

1. **A bill queued on an iPad by the pre-D1 app** (its `CartItem` has no `choices`) syncs after the deploy → priced and deducted with each menu's defaults, never sent to manager review for that reason. Test in Task 2.
2. **A specialty member removed or its material archived between sale and sync** → the bill is still recorded; that line's stock is skipped (no raise); price check follows today's STALE rule only for price-bearing choices. Tests in Tasks 1 and 4.
3. **Two sales at once deducting the same material** → no lost update; afterwards `current_stock` equals the sum of non-legacy ledger rows. Test in Task 4.
4. **One cup draws the same material twice** (bean slot + เพิ่มช็อต) → one aggregated ledger row per (order item, material); the unique index is not hit. Tests in Tasks 1 and 4.
5. **Void of a 3-cup line where 1 cup was made, then a second void attempt** → restock 2 cups once; the second call changes nothing. Test in Task 7.

---

## Task 0: Reconcile with the live database (GATE — needs Supabase ACTIVE_HEALTHY)

The DB was RESTORING when this plan was written. `raw_materials`, `product_recipes`, `inventory_transactions`, `deduct_stock_for_order` and their RLS were created outside `supabase/migrations/`, so their live definitions must be read before any SQL task.

**Files:** Create `docs/superpowers/plans/2026-11-18-stock-round-d1-live-db.md` (findings only).

- [ ] **Step 1:** `get_project` → status must be `ACTIVE_HEALTHY`. If not, stop; only Tasks 1–2 may run.
- [ ] **Step 2:** Record, via `execute_sql` (read-only):
  - columns, constraints, indexes, triggers of `raw_materials`, `product_recipes`, `inventory_transactions`, `order_items`, `modifier_options`
  - all RLS policies on those tables (`pg_policies`) and table/column grants for `authenticated` (`information_schema.role_table_grants`, `column_privileges`)
  - `pg_get_functiondef` of `deduct_stock_for_order`, `restock_for_voided_order`, `replace_product_recipes`, `replace_product_modifiers`, `save_menu`, `auth_role`, `auth_tenant_id`
  - `select type, count(*) from inventory_transactions group by type`
  - per tenant: counts of raw_materials, product_recipes, inventory_transactions; any `current_stock < 0`
- [ ] **Step 3:** Compare with this plan's assumptions (listed at the top of each SQL task). Write every difference into the findings file with the plan task it affects. A difference that changes a task is a controller ruling before that task is dispatched.
- [ ] **Step 4:** Commit the findings file. `git commit -m "docs(d1): live DB findings before stock migrations"`

---

## Task 1: Stock core — resolve a cart line into stock lines (pure TS)

**Files:**
- Create: `src/lib/stock/stock-core.ts`
- Test: `src/lib/stock/stock-core.test.ts`

**Interfaces — Produces** (exported from `stock-core.ts`):

```ts
export type RecipeLine =
  | { kind: "fixed"; materialId: string; qty: number }
  | { kind: "slot"; groupId: string; qty: number; defaultMemberId: string | null; allowSpecial: boolean };

export type GroupMember = {
  id: string; groupId: string; materialId: string; label: string;
  tier: "house" | "special"; priceDelta: number; isDefault: boolean; sortOrder: number;
};
export type ChoiceGroup = { id: string; kind: "bean" | "matcha" | "sweetener" | "other"; name: string; members: GroupMember[] };

export type SweetnessLevel = { id: string; name: string; isNone: boolean; isDefault: boolean; sortOrder: number };
/** key `${memberId}:${levelId}` → amount in the member material's base unit */
export type AmountTable = Map<string, number>;
export type ProductSweetness = {
  groupId: string; defaultMemberId: string; allowedMemberIds: string[];
  defaultLevelId: string | null; custom: AmountTable | null;
};

export type OptionEffect =
  | { kind: "slot_add"; groupId: string; qty: number }
  | { kind: "material_add"; materialId: string; qty: number };

export type StockCatalog = {
  recipes: Map<string, RecipeLine[]>;            // productId → lines
  groups: Map<string, ChoiceGroup>;               // groupId → group
  levels: SweetnessLevel[];
  standardSweetness: AmountTable;
  productSweetness: Map<string, ProductSweetness>; // productId → config (absent = no sweetness rows)
  optionEffects: Map<string, OptionEffect[]>;      // modifier option id → effects
};

/** What the POS sends per line (all optional: a pre-D1 cart has none). */
export type LineChoices = {
  slots?: { groupId: string; memberId: string }[];
  sweetness?: { levelId: string; memberId: string | null } | null;
};

export type StockLine = { materialId: string; qty: number }; // qty for the whole line (× quantity), > 0
export type ChoiceSnapshot = {
  slots: { groupId: string; memberId: string; materialId: string; label: string; tier: "house" | "special" }[];
  sweetness: { levelId: string; levelName: string; memberId: string | null; label: string | null } | null;
};
export type ResolvedLine = {
  stock: StockLine[];               // aggregated per material, sorted by materialId
  priceDeltaSatang: number;         // per ONE cup: specialty members (+ again per slot_add on a special member)
  snapshot: ChoiceSnapshot;
};

export const STOCK_STALE = "รายการเมนูมีการเปลี่ยนแปลง กรุณาเลือกใหม่";
/** Per-cup specialty price: each special slot member once, plus once more per slot_add option on that group. Shared by server pricing and the POS cart. */
export function cupPriceDeltaSatang(
  slotMembers: { groupId: string; tier: "house" | "special"; priceDelta: number }[],
  slotAddGroupIds: string[]
): number;
export function resolveLine(
  productId: string, quantity: number, choices: LineChoices | undefined,
  optionIds: string[], catalog: StockCatalog
): ResolvedLine | { error: typeof STOCK_STALE };
```

Rules `resolveLine` must implement (spec §6.2–6.4, §6.2.1):
- Slot line: member = chosen member for that group (if the chosen id is not a member of the group → `STOCK_STALE`); else the line's `defaultMemberId` (if still a member); else the group member with `isDefault`; else the first `house` member by `sortOrder`; if the group has no members → skip the line (no stock, no error).
- A chosen `special` member on a line with `allowSpecial = false` → `STOCK_STALE`.
- Specialty price: `toSatang(member.priceDelta)` added once per cup for each slot whose member is `special`.
- `slot_add` effect: adds `qty` of the member chosen for that group's slot in this product (the same material); if the product has no slot for that group, the effect is ignored. If that member is `special`, its `priceDelta` is added once more per cup (spec §14 call 6).
- `material_add` effect: adds `qty` of that material.
- Sweetness (only if `productSweetness` has the product): level = chosen level (unknown id → `STOCK_STALE`), else product `defaultLevelId`, else the shop level with `isDefault`. If the level `isNone` → no sweetener stock, snapshot member `null`. Otherwise member = chosen member (must be the default or in `allowedMemberIds`, else `STOCK_STALE`), else `defaultMemberId`. Amount = `custom` table if set else `standardSweetness`; a missing cell = 0 (never an error).
- All stock quantities × `quantity`, aggregated per `materialId`, zero lines dropped.

- [ ] **Step 1: Write the failing tests** — build one fixture catalog: materials `med` (คั่วกลาง), `dark`, `light`, `kenya` (special +20), `milk`, `syrup`, `condensed`, `mix`, `ice`; group `beans` (house: light/med*/dark; special: kenya); sweetener group `sweet` (syrup*, condensed, mix); levels none/less/normal*/more; standard table syrup 0/10/20/35, condensed 0/15/30/45, mix 0/15/30/45; product `latte` = slot beans 18 g (allowSpecial) + fixed milk 180 + fixed ice 150 + sweetness (default syrup, allowed condensed+mix); option `extraShot` = slot_add beans 9; product `espresso_house` = slot beans 18 with `allowSpecial: false`; product `thai_tea` = sweetness custom table condensed 0/20/40/55 default condensed.

```ts
test("plain latte uses every default", () => {
  const r = ok(resolveLine("latte", 1, undefined, [], cat));
  assert.deepEqual(r.stock, sorted([["ice",150],["med",18],["milk",180],["syrup",20]]));
  assert.equal(r.priceDeltaSatang, 0);
});
test("kenya, less sweet, milk mix, extra shot (spec §6.4 example)", () => {
  const r = ok(resolveLine("latte", 1,
    { slots: [{ groupId: "beans", memberId: "m_kenya" }], sweetness: { levelId: "less", memberId: "m_mix" } },
    ["extraShot"], cat));
  assert.deepEqual(r.stock, sorted([["ice",150],["kenya",27],["milk",180],["mix",15]]));
  assert.equal(r.priceDeltaSatang, 4000); // +20 bean, +20 again for the extra shot on a special bean
});
test("no sweetness takes no sweetener", () => { /* levelId none → no syrup line; snapshot.sweetness.memberId === null */ });
test("quantity multiplies and aggregates", () => { /* qty 2 + extraShot → med 54 */ });
test("per-menu sweetness table wins", () => { /* thai_tea less → condensed 20 */ });
test("a special bean where the menu forbids it is stale", () => { /* espresso_house + kenya → STOCK_STALE */ });
test("an unknown member or level is stale", () => { /* both cases */ });
test("a pre-D1 cart line (no choices) resolves with defaults", () => { /* choices undefined → same as plain */ });
test("a missing table cell counts as zero", () => { /* delete syrup:more → no syrup line, no error */ });
test("an empty group is skipped", () => { /* group with no members → no bean line, no error */ });
```

- [ ] **Step 2:** `npm test` → the new file fails (module missing).
- [ ] **Step 3:** Implement `resolveLine` in `src/lib/stock/stock-core.ts` (pure, no I/O, no Next imports).
- [ ] **Step 4:** `npm test` → all pass; `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit `feat(d1): stock core resolves a cart line into stock lines`.

---

## Task 2: Pricing core accepts choices; cart maths includes specialty prices

**Files:**
- Modify: `src/types/app.ts` (CartItem), `src/lib/order-pricing-core.ts`, `src/lib/cart-math.ts`
- Test: `src/lib/order-pricing-core.test.ts`, `src/lib/cart-math.test.ts` (create if absent)

**Interfaces:**
- Consumes: `LineChoices`, `ResolvedLine`, `resolveLine`, `StockCatalog`, `STOCK_STALE` (Task 1).
- Produces:
  - `CartItem.choices?: CartChoices` where `CartChoices = { slots: { groupId: string; memberId: string; label: string; priceDelta: number }[]; sweetness: { levelId: string; levelName: string; memberId: string | null; memberLabel: string | null } | null }` (labels/priceDelta are display-only; the server ignores them).
  - `PricedLine` gains `stock: StockLine[]` and `choicesSnapshot: ChoiceSnapshot`.
  - `PricingCatalog` gains `stock: StockCatalog`.
  - `CartChoices.slots[]` also carries `tier: "house" | "special"`, and `CartChoices.slotAddGroupIds: string[]` (the groups that the line's selected options add to — filled by the POS from the option effects it loaded).
  - `unitPrice(basePrice: number, selectedModifiers: SelectedModifier[], choices?: CartChoices): number` in `cart-math.ts` = today's result + `cupPriceDeltaSatang(choices.slots, choices.slotAddGroupIds) / 100` (Task 1 helper). The server never trusts these fields; it recomputes from the catalog.

- [ ] **Step 1: Failing tests**
```ts
test("a specialty bean is part of the server price", () => { /* latte 65 + kenya 20 → unitPrice 85, client totalPrice 85 accepted */ });
test("a client that leaves out the specialty price is stale", () => { /* client 65 with kenya chosen → STALE */ });
test("a cart line without choices (pre-D1) prices as before", () => { /* unchanged numbers, stock = defaults */ });
test("as charged keeps the device total but still resolves stock", () => { /* priceLinesAsCharged with choices → stock present */ });
test("cart unitPrice adds the specialty price", () => { /* cart-math */ });
```
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3:** In `catalogLine` call `resolveLine(item.productId, item.quantity, toLineChoices(item.choices), optionIds, catalog.stock)` (`toLineChoices` drops the display-only fields); `STOCK_STALE` → `STALE`; add `priceDeltaSatang` (per cup) to `unitSatang`; `PricedLine.stock = resolved.stock` (already × quantity). `resolveLine` uses `cupPriceDeltaSatang` internally. Same in `priceLinesAsCharged` (stock resolved, price as charged).
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit` (fix every `CartItem` construction the compiler flags; `choices` is optional so old outbox entries type-check).
- [ ] **Step 5:** Commit `feat(d1): pricing understands bean/sweetness choices and specialty prices`.

---

## Task 3: Migration A — stock schema, ledger, frozen old costs (additive)

*Assumes (verify in Task 0):* `raw_materials(id, tenant_id, name, unit, cost_per_unit, current_stock, min_stock_alert, created_at, updated_at)`, `inventory_transactions(id, tenant_id, raw_material_id, type, quantity, note, created_by, created_at)`, `product_recipes(id, tenant_id, product_id, raw_material_id NOT NULL, quantity_used)`.

**Files:**
- Create: `supabase/migrations/20261118120000_stock_d1_schema.sql`
- Create: `supabase/tests/stock_schema_test.sql`
- Modify: `src/types/database.ts` (hand-merge regenerated types)

**Schema (exact names — later tasks use them):**
- `raw_materials` + `category text not null default 'วัตถุดิบทั่วไป'`, `purchase_unit text null`, `purchase_size numeric(12,3) null check (purchase_size > 0)`, `track_stock boolean not null default true`, `archived_at timestamptz null`. `cost_per_unit` stays = average cost per base unit; `unit` stays = base unit label.
- `choice_groups(id uuid pk default gen_random_uuid(), tenant_id uuid not null fk tenants, name text not null, kind text not null check (kind in ('bean','matcha','sweetener','other')), sort_order int not null default 0, created_at timestamptz default now())`.
- `choice_group_members(id uuid pk, tenant_id, group_id fk choice_groups on delete cascade, raw_material_id fk raw_materials, label text not null, tier text not null check (tier in ('house','special')), price_delta numeric(10,2) not null default 0 check (price_delta >= 0), is_default boolean not null default false, sort_order int not null default 0, unique (group_id, raw_material_id))` + `create unique index … on choice_group_members(group_id) where is_default`.
- `product_recipes` + `line_kind text not null default 'fixed' check (line_kind in ('fixed','slot'))`, `group_id uuid null fk choice_groups`, `default_member_id uuid null fk choice_group_members on delete set null`, `allow_special boolean not null default true`; `raw_material_id` → nullable; check `(line_kind='fixed' and raw_material_id is not null and group_id is null) or (line_kind='slot' and group_id is not null and raw_material_id is null)`.
- `sweetness_levels(id, tenant_id, name text not null, is_none boolean not null default false, is_default boolean not null default false, sort_order int not null default 0)` + unique default per tenant.
- `sweetness_amounts(id, tenant_id, product_id uuid null fk products on delete cascade, member_id fk choice_group_members on delete cascade, level_id fk sweetness_levels on delete cascade, amount numeric(12,3) not null check (amount >= 0), unique nulls not distinct (tenant_id, product_id, member_id, level_id))` — `product_id null` = the shop's standard table.
- `product_sweetness(product_id uuid pk fk products on delete cascade, tenant_id, group_id fk choice_groups, default_member_id fk choice_group_members, allowed_member_ids uuid[] not null default '{}', default_level_id uuid null fk sweetness_levels on delete set null, use_custom boolean not null default false)`.
- `modifier_option_effects(id, tenant_id, option_id fk modifier_options on delete cascade, kind text check (kind in ('slot_add','material_add')), group_id uuid null, raw_material_id uuid null, amount numeric(12,3) not null check (amount > 0), check (kind='slot_add' and group_id is not null and raw_material_id is null or kind='material_add' and raw_material_id is not null and group_id is null))`.
- `inventory_transactions` + `unit_cost numeric(14,6) null`, `order_id uuid null fk orders`, `order_item_id uuid null fk order_items`, `occurred_at timestamptz not null default now()`, `reason text null`, `legacy boolean not null default false`, `ref_id uuid null` (held bill / future count session). Existing rows → `legacy = true`. Check `legacy or type in ('opening','sale','void_restock','waste','receive','adjust')`. Unique index `(order_item_id, raw_material_id, type) where type in ('sale','void_restock') and not legacy`.
- Opening rows: one `type='opening'` row per material with `quantity = current_stock`, `unit_cost = cost_per_unit`, `note = 'ยอดตั้งต้นรอบ D'` (skip materials whose stock is 0).
- `order_items` + `cost_total numeric(12,4) null`, `choices jsonb null`, `void_made boolean null`.
- Frozen old costs: `update order_items oi set cost_total = (sum over product_recipes of quantity_used × raw_materials.cost_per_unit) × oi.quantity` for every existing row (null when the product has no recipe).
- RLS + policies on the 6 new tables per Global Constraints.

- [ ] **Step 1: Write `supabase/tests/stock_schema_test.sql`** (pattern: `supabase/tests/order_record_test.sql`, ends with `raise exception 'RESULT %'`). Keys, all must be true:
  - `opening_rows`: a material with stock 12 has exactly one non-legacy `opening` row of 12, and `current_stock = sum(quantity) where not legacy`.
  - `old_rows_legacy`: pre-existing transactions are `legacy`.
  - `recipe_check`: a `slot` line with a material is rejected; a `fixed` line without one is rejected.
  - `one_default_member`, `one_default_level`: a second default is rejected.
  - `standard_table_unique`: two standard rows for the same member/level are rejected (nulls not distinct).
  - `rls_staff_reads_not_writes`: as a staff JWT (`set local role authenticated` + `request.jwt.claims`), select on `choice_groups` works, insert raises.
  - `frozen_cost`: an order item of a product with recipe 18 g × 0.5 ฿/g, qty 2 → `cost_total = 18`.
- [ ] **Step 2:** Run the test via `execute_sql` → fails (tables missing).
- [ ] **Step 3:** Write the migration; apply with `apply_migration` (name `stock_d1_schema`).
- [ ] **Step 4:** Re-run the test → every key true. Run `supabase/tests/order_record_test.sql` → still 19/19.
- [ ] **Step 5:** Regenerate + hand-merge types; `npx tsc --noEmit`; commit `feat(d1): stock schema, ledger columns, opening rows, frozen old costs`.

---

## Task 4: `order_record` applies stock (same signature)

*Assumes:* the live `order_record` equals `supabase/migrations/20261106120000_order_record_override_held.sql`.

**Files:**
- Create: `supabase/migrations/20261118130000_order_record_stock.sql`
- Create: `supabase/tests/stock_sale_test.sql`

**Interfaces:**
- Consumes: Task 3 schema.
- Produces: each `p_items[]` element may carry `"stock": [{ "material_id": uuid, "qty": number }]` (whole-line quantity, > 0) and `"choices": <ChoiceSnapshot json>`. Absent → no stock (the deployed pre-D1 app keeps calling `deduct_stock_for_order` itself; no double deduction).

Behaviour (only on the `created = true` path; the replay path is untouched):
1. Insert order items one by one (`jsonb_array_elements … with ordinality`), keeping each new id; store `choices`.
2. Collect all stock lines of the bill; lock their `raw_materials` rows `for update` **in materialId order**, ignoring ids not in `p_tenant_id` or archived (skip, never raise).
3. Per (item, material): `unit_cost = cost_per_unit`; if `track_stock` → insert ledger row `type='sale'`, `quantity = -qty`, `unit_cost`, `order_id`, `order_item_id`, `occurred_at = v_created`, `created_by = p_actor_id`, and `current_stock -= qty`. Untracked materials write no row.
4. `order_items.cost_total = sum(qty × unit_cost)` over that item's lines, tracked or not (null when the item had no stock lines).

- [ ] **Step 1: `supabase/tests/stock_sale_test.sql`** keys:
  - `deducts_once`: a bill with latte (kenya 27, milk 180) → kenya −27, milk −180, one `sale` row each; calling again with the same `client_ref` (replay) changes nothing.
  - `offline_time`: `p_offline.sold_at` 40 min ago → ledger `occurred_at = sold_at`.
  - `untracked_cost_only`: ice (track_stock false) → no ledger row, but `cost_total` includes ice.
  - `negative_allowed`: material at 5 g, sale of 18 g → balance −13, bill created.
  - `foreign_material_skipped`: a stock line naming another tenant's material → skipped, bill created.
  - `balance_equals_ledger`: after the test, every touched material `current_stock = sum(non-legacy quantity)`.
  - `no_stock_key_no_deduction`: an item without `stock` → no rows (pre-D1 callers).
- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** `create or replace function public.order_record(…same 9 params…)` with the steps above; re-issue grants.
- [ ] **Step 4:** run `stock_sale_test.sql` (all true) and `order_record_test.sql` (19/19).
- [ ] **Step 5:** Commit `feat(d1): order_record records stock and cost per item in the bill's transaction`.

---

## Task 5: `createOrder` sends stock; catalog loader; held bills

**Files:**
- Create: `src/lib/stock/catalog.ts` — `loadStockCatalog(supabase: SupabaseClient<Database>, tenantId: string, productIds: string[], optionIds: string[]): Promise<{ catalog: StockCatalog } | { error: string; retry: true }>`
- Modify: `src/lib/order-pricing.ts` (load stock catalog into `PricingCatalog.stock`), `src/app/actions/orders.ts` (`p_items[].stock`, `p_items[].choices`; delete the `deduct_stock_for_order` call), `src/app/actions/held-bills.ts` (`priceCartItems` keeps working with choices)
- Test: `src/lib/stock/catalog.test.ts` for the pure row→catalog mapping helper `buildStockCatalog(rows: StockCatalogRows): StockCatalog` (export it from `catalog.ts`; `loadStockCatalog` = queries + `buildStockCatalog`)

- [ ] **Step 1: Failing tests** for `buildStockCatalog`: archived materials' members are dropped; members sorted by `sort_order`; a fixed recipe line whose material is archived is dropped; standard vs product tables keyed `${memberId}:${levelId}`.
- [ ] **Step 2:** `npm test` → fail. **Step 3:** implement. **Step 4:** `npm test`, tsc.
- [ ] **Step 5:** Wire `createOrder`: each `p_items` element gets `stock: line.stock.map(s => ({ material_id: s.materialId, qty: s.qty }))` and `choices: line.choicesSnapshot`. Remove the post-insert `deduct_stock_for_order` RPC.
- [ ] **Step 6:** Live check on a QA tenant (DB must be up): sell 1 plain latte online → ledger has the expected rows; void not yet changed.
- [ ] **Step 7:** Commit `feat(d1): createOrder deducts through order_record; stock catalog loader`.

---

## Task 6: Receive and adjust (atomic, moving average)

**Files:**
- Create: `supabase/migrations/20261118140000_stock_receive_adjust.sql`, `supabase/tests/stock_receive_test.sql`
- Create: `src/lib/stock/units.ts` — `toBaseQty(purchaseQty: number, purchaseSize: number | null): number` and `movingAverage(balance: number, avgCost: number, qty: number, unitCost: number): number`
- Test: `src/lib/stock/units.test.ts`
- Modify: `src/app/actions/inventory.ts` (`receiveStock`, `adjustStock` call the functions through the admin client; `deleteRawMaterial` → archive, returns an error result)

**SQL interfaces (service-role):**
- `stock_receive(p_tenant_id uuid, p_actor_id uuid, p_material_id uuid, p_qty numeric, p_total_price numeric) returns void` — `p_qty` in base units (> 0); `p_total_price` null = no price. Locks the row; with a price: `cost_per_unit := movingAverage(...)` (balance ≤ 0 → new unit cost = total/qty); ledger `receive` row with `unit_cost`; `current_stock += qty`. Raises `forbidden_price` when a price is given and the actor is not an active owner/manager of the tenant; `material_not_found` for another tenant/archived.
- `stock_adjust(p_tenant_id uuid, p_actor_id uuid, p_material_id uuid, p_new_balance numeric, p_reason text) returns void` — owner/manager only (`forbidden`), reason required (`reason_required`, ≤ 500 chars); ledger `adjust` row of `new − current` with `reason`.

- [ ] **Step 1: Failing TS tests:** `toBaseQty(6, 2000) === 12000`; `toBaseQty(250, null) === 250`; `movingAverage(1000, 0.05, 2000, 0.06) ≈ 0.056667`; `movingAverage(-20, 0.05, 1000, 0.06) === 0.06`.
- [ ] **Step 2: Failing SQL test keys:** `receive_with_price` (avg updated, row unit_cost), `receive_without_price_keeps_avg`, `staff_price_forbidden`, `staff_receive_ok`, `adjust_needs_reason`, `adjust_manager_only`, `balance_equals_ledger`.
- [ ] **Step 3:** implement TS + SQL; apply migration; types.
- [ ] **Step 4:** all tests green.
- [ ] **Step 5:** Commit `feat(d1): atomic receive (moving average) and adjust with reason`.

---

## Task 7: Void and held-bill cancel ask "ชงแล้วหรือยัง?"

**Files:**
- Create: `supabase/migrations/20261118150000_order_void_stock.sql`, `supabase/tests/stock_void_test.sql`
- Modify: `src/app/actions/orders.ts` (`voidOrder` → one RPC), `src/components/orders/void-order-button.tsx`, `src/app/actions/held-bills.ts` (`cancelHeldBill(id, reason, pin, made: "none" | "all")`), the held-bills cancel dialog in `src/components/pos/held-bills-panel.tsx`

**SQL interfaces (service-role):**
- `order_void(p_tenant_id uuid, p_actor_id uuid, p_approver_id uuid, p_order_id uuid, p_reason text, p_made jsonb) returns void` — one transaction: the status update `voidOrder` does today (`completed` → `cancelled`, same columns; raises `not_completed` otherwise), then for each order item: `made = p_made->>item_id` (`"all"`, `"none"`, or an integer count of cups made); restock `(quantity − made)/quantity` of each `sale` row as `void_restock` rows (same `unit_cost`, `occurred_at = now()`); set `order_items.void_made` = true when any cup was made. Second call → `not_completed`, nothing restocked (unique index backs it).
- `stock_waste(p_tenant_id uuid, p_actor_id uuid, p_lines jsonb, p_reason text, p_ref_id uuid) returns void` — `p_lines = [{material_id, qty}]`; ledger `waste` rows with `reason`, `ref_id`; `current_stock -= qty`; skips foreign/archived materials. (Reused by D2's waste button.)

**UI copy (exact):** dialog question **"เครื่องดื่มชงไปแล้วหรือยัง?"**; two large buttons **"ยังไม่ชง"** and **"ชงแล้ว"** (no default; confirm disabled until one is chosen); when the bill has more than one cup a third, smaller button **"ชงแล้วบางแก้ว"** shows each line with a −/+ cup counter. Held bill: same question; **"ชงแล้ว"** records waste with reason **"ยกเลิกบิลพักหลังชง"** using `resolveLine` on the held items.

- [ ] **Step 1: SQL test keys:** `void_not_made_restocks`, `void_made_keeps_stock_and_flags`, `void_partial` (qty 3, made 1 → restock 2/3), `void_twice_noop`, `waste_rows_and_balance`.
- [ ] **Step 2:** implement migration; keep `restock_for_voided_order` in place (phase two drops it).
- [ ] **Step 3:** `voidOrder` keeps every existing check (PIN, open shift, reason) and replaces the update + restock pair with `admin.rpc("order_void", …)`; map `not_completed` to today's messages by re-reading the status.
- [ ] **Step 4:** UI per copy above; Browser-pane check at 1180×740: a 2-line bill, choose "ชงแล้วบางแก้ว", confirm, ledger as expected.
- [ ] **Step 5:** Commit `feat(d1): void and held-bill cancel record made drinks as waste, restock the rest`.

---

## Task 8: Dashboard reads frozen cost

**Files:** Modify `src/lib/dal.ts` (`getCostProfit`, `getMenuProfitBreakdown`; delete `unitCostByProductId` once unused), `src/components/dashboard/*` only if a prop changes.

- [ ] **Step 1:** Extract the summing into a pure helper `sumCost(rows: { cost_total: number | null; quantity: number }[]): { cost: number; missingLines: number }` in `src/lib/stock/cost.ts` with tests (null counts as missing, not zero cost).
- [ ] **Step 2:** Both dal functions read `order_items.cost_total` (through the admin client after the page's owner/manager check — Task 9 hides the column from `authenticated`) instead of recipe × current cost; "missing" keeps today's meaning (lines without a cost).
- [ ] **Step 3:** Live check: the QA tenant's dashboard shows the same cost for a bill before and after changing a material's cost.
- [ ] **Step 4:** Commit `feat(d1): dashboard profit uses cost frozen at sale`.

---

## Task 9: Security lockdown + exploit proof

*Assumes (verify in Task 0):* `authenticated` can insert/update/delete `raw_materials`, `inventory_transactions` via tenant-only RLS.

**Files:** Create `supabase/migrations/20261118160000_stock_lockdown.sql`, `supabase/tests/stock_lockdown_test.sql`; modify every reader/writer the compiler or grep finds.

- [ ] **Step 1: Prove the hole first** on a QA tenant with a Staff session (Data API): PATCH `raw_materials.cost_per_unit`, PATCH `current_stock`, POST `inventory_transactions` → record that each succeeds.
- [ ] **Step 2: Migration:**
  - `revoke insert, update, delete on raw_materials, inventory_transactions from authenticated`
  - `revoke select on raw_materials from authenticated; grant select (id, tenant_id, name, unit, category, purchase_unit, purchase_size, track_stock, archived_at, current_stock, min_stock_alert, created_at, updated_at) on raw_materials to authenticated` (no `cost_per_unit`)
  - `revoke select (unit_cost) on inventory_transactions …` via the same table→column pattern
  - `order_items`: column grants without `cost_total`
- [ ] **Step 3:** Fix every caller: `grep -rn 'from("raw_materials")\|from("inventory_transactions")\|from("order_items")' src` — `select("*")` or cost columns move to explicit columns, or to the admin client behind an owner/manager check. Material create/update/archive actions: `requireManager()` + admin client.
- [ ] **Step 4: SQL test keys:** `staff_cannot_write_materials`, `staff_cannot_write_ledger`, `staff_cannot_read_cost`, `manager_reads_costs_via_service` (service role works).
- [ ] **Step 5:** Re-run Step 1's three requests → each refused. Owner pages (inventory, products editor cost preview, dashboard) still show costs.
- [ ] **Step 6:** `npm run build`; commit `fix(d1): staff can no longer write stock or read costs (proven before/after)`.

---

## Task 10: Materials page (owner/manager)

**Files:** Modify `src/app/(shell)/inventory/page.tsx`, `src/components/inventory/raw-material-form.tsx`, `material-row.tsx`, `stock-action-form.tsx`; create `src/components/inventory/material-history.tsx`.

Requirements (spec §6.1, §7.3, §7.9, §8.1):
- List grouped by **หมวด**; columns: ชื่อ · คงเหลือ (base unit, and "≈ N ขวด" when `purchase_size` set) · ต้นทุน/หน่วย (owner/manager only) · สถานะ (ใกล้หมด = `warning` + text, ติดลบ = `destructive` + "ยอดน่าจะผิด").
- Form fields: ชื่อ, หมวด (existing values + new), "ใช้เป็น" (base unit), "ซื้อเป็น" (purchase unit name + size), ติดตามสต๊อก (switch, explanation "ปิด = คิดแค่ต้นทุน ไม่ต้องนับ เช่น น้ำแข็ง น้ำ RO"), เตือนเมื่อเหลือ.
- **รับของเข้า:** quantity in purchase units with a big number pad + ¼ ½ ¾ buttons; "ราคาที่จ่าย (บาท)" shown only to owner/manager; success toast "รับของเข้า: นมสด 6 ขวด" with **ย้อนกลับ** for 5 s (calls `stock_adjust` back to the previous balance with reason "ย้อนกลับการรับของ").
- **ปรับยอด:** new balance + reason (required).
- **ปิดใช้** instead of delete; archived list collapsible ("ปิดใช้แล้ว (N)") like deactivated staff.
- **ประวัติสต๊อก** drawer: last 50 ledger rows in plain Thai ("ขาย · บิล KK.031 · −18 g").

- [ ] **Step 1:** Build; Browser pane 1180×740: add "นมสด" ซื้อเป็น ขวด 2,000 ml, receive 6 ขวด ราคา 648 → คงเหลือ 12,000 ml, ต้นทุน 0.054; archive; history shows rows.
- [ ] **Step 2:** As Staff the page redirects (unchanged rule).
- [ ] **Step 3:** Commit `feat(d1): materials page — categories, units, receive by bottle, history, archive`.

---

## Task 11: Bean/matcha groups and the sweetness table pages

**Files:** Create `src/app/(shell)/inventory/groups/page.tsx`, `src/app/(shell)/inventory/sweetness/page.tsx`, `src/app/actions/stock-config.ts`, components under `src/components/inventory/`.

- Groups page: list groups (เมล็ด / มัทฉะ / ความหวาน); per group the members with **เมล็ดร้าน/เมล็ดพิเศษ** (or **มัทฉะร้าน/มัทฉะพิเศษ**), ราคาเพิ่ม, ค่าเริ่มต้น (one), order (up/down buttons, not drag-only), add member = pick a material.
- Sweetness page: levels (name, order, one default, one "ไม่หวาน" flag) and the standard table as a grid: rows = sweetener members, columns = levels, cells numeric (base unit shown in the row header, e.g. "ไซรัป (ml)").
- Server actions validate with `requireManager()`; writes go through the user client (RLS from Task 3).
- First-time empty state offers **"สร้างกลุ่มตั้งต้น"**: creates groups เมล็ด (bean), มัทฉะ (matcha), ความหวาน (sweetener) and levels ไม่หวาน / หวานน้อย / หวานปกติ (default) / หวานมาก.

- [ ] **Step 1:** Pure validation helpers in `src/lib/stock/config-validate.ts` with tests: one default per group; price ≥ 0; amounts ≥ 0 and ≤ 10,000; level names unique; exactly one "ไม่หวาน" level at most.
- [ ] **Step 2:** Pages + actions; Browser check: build the owner's example (syrup 0/10/20/35).
- [ ] **Step 3:** Commit `feat(d1): bean/matcha groups and the shop sweetness table`.

---

## Task 12: Menu editor — slot lines, sweetness, option effects

**Files:** Modify `src/components/products/menu-editor.tsx`, `src/app/actions/products.ts` (`parseMenuDraft`/`MenuDraft`), `src/app/(shell)/modifiers/page.tsx` + `src/components/modifiers/modifier-option-form.tsx`; create `supabase/migrations/20261118170000_save_menu_slots.sql` (`create or replace save_menu` same signature; `replace_product_recipes` same signature) and `supabase/tests/save_menu_slots_test.sql`.

**JSON contract (same RPC signatures):**
- `p_recipes[]`: `{ "line_kind": "fixed", "raw_material_id", "quantity_used" }` or `{ "line_kind": "slot", "group_id", "quantity_used", "default_member_id"|null, "allow_special": bool }`; missing `line_kind` = `fixed` (the deployed editor keeps working).
- `p_menu.sweetness`: absent = leave as is (deployed editor); `null` = remove; else `{ "group_id", "default_member_id", "allowed_member_ids": [], "default_level_id"|null, "use_custom": bool, "custom": [{ "member_id", "level_id", "amount" }] }` — replaces the product's `product_sweetness` row and its product-scoped `sweetness_amounts`.
- Option effects are saved by a new server action `saveOptionEffects(optionId, effects)` (RLS writes).

**Editor UI (spec §6.2–6.4, §8.1):** recipe line type picker **"วัตถุดิบ"** / **"เมล็ด/มัทฉะ (ให้ลูกค้าเลือก)"**; slot line shows ค่าเริ่มต้นของเมนูนี้ + switch **"ให้เลือกเมล็ดพิเศษได้"**; section **ความหวาน** with ชนิดเริ่มต้น, เปลี่ยนชนิดได้ (checkboxes), ระดับเริ่มต้น, and **"ใช้ปริมาณเฉพาะเมนูนี้"** revealing the grid; cost preview (owner/manager only) "ต้นทุนต่อแก้ว: ไม่หวาน … · หวานน้อย … · หวานปกติ … · หวานมาก …" computed with `resolveLine` on defaults.
Modifier option form: **"ผลต่อสต๊อก"** — "เพิ่มในช่องเมล็ด/มัทฉะ" + amount, or "เพิ่มวัตถุดิบ" + material + amount.

- [ ] **Step 1:** SQL test keys: `slot_line_saved`, `old_payload_still_fixed`, `sweetness_replaced`, `sweetness_absent_untouched`, `staff_forbidden`, `foreign_group_rejected`.
- [ ] **Step 2:** migration + editor + effects form; `npm test`, tsc.
- [ ] **Step 3:** Browser check: configure ลาเต้ (beans 18 g slot, milk 180, ice 150, sweetness syrup default, condensed+mix allowed) and เพิ่มช็อต (+9 g in bean slot); cost preview shows 4 numbers.
- [ ] **Step 4:** Commit `feat(d1): menu editor — bean/matcha slots, sweetness, option stock effects`.

---

## Task 13: POS option window, cart, POS data

**Files:** Modify `src/components/pos/modifier-modal.tsx` (rename export to `OptionWindow` only if every import is updated), `src/components/pos/smart-cart.tsx`, `src/components/pos/pos-screen.tsx`, `src/app/(shell)/pos/page.tsx` (load groups/members/levels/tables/product sweetness/slot lines/effects for the menus on sale), `src/types/app.ts` (POS display types).

Behaviour (spec §8.1 sketch is the target):
- Sections in order: **เมล็ดร้าน (ระดับคั่ว)** / **เมล็ดพิเศษ** (or **มัทฉะร้าน** / **มัทฉะพิเศษ**) → **ความหวาน** → **หวานด้วย** → other modifiers (**เพิ่ม**) → **+ หมายเหตุ** (collapsed).
- Bean section is one single choice across both rows; specialty chips show "+20"; defaults pre-selected (menu default → group default); "หวานด้วย" chips disabled (not hidden) when the level is "ไม่หวาน".
- Chips 56 px, 18 px text, 4 per row, solid `accent` + ✓ when selected (apply to every existing modifier chip too); window ~720 px wide on iPad, no scrolling for a menu with beans + sweetness + 1 modifier group; footer button "เพิ่มลงตะกร้า · ฿85" always visible.
- Cart line shows every choice; non-default choices bold `accent` (e.g. `ลาเต้ · คั่วกลาง · **หวานน้อย · นมมิกซ์**`); tapping a cart line reopens the window pre-filled and replaces the line on save.
- `CartItem.choices` filled per Task 2; client `unitPrice` includes specialty prices.
- Offline: the device snapshot of the POS page already carries menus; groups/levels ride along in the same page props (cached `/pos` shell). Old queued entries without `choices` are untouched.

- [ ] **Step 1:** Pure helper `defaultChoices(product, posStockConfig): CartChoices` + `isDefaultChoice(...)` in `src/lib/stock/pos-choices.ts` with tests (menu default beats group default; "ไม่หวาน" clears the sweetener).
- [ ] **Step 2:** UI; Browser pane 1180×740 on a QA tenant: run the 5 sweetness orders from spec §6.2.1 / chat (plain; นมมิกซ์; หวานน้อย+นมมิกซ์; หวานมาก+นมข้น; ไม่หวาน) and kenya + เพิ่มช็อต; count taps (plain latte = 2 taps: menu → เพิ่มลงตะกร้า) and record them; ledger after payment matches Task 1's numbers.
- [ ] **Step 3:** Phone width (375) still usable (single column chips, footer visible).
- [ ] **Step 4:** Offline check (production build): sell kenya latte offline → sync → ledger `occurred_at` = sale time.
- [ ] **Step 5:** Commit `feat(d1): POS option window — roast/specialty, sweetness rows, defaults, editable cart lines`.

---

## Task 14: Phase-two migration (commit only; apply after deploy)

**Files:** Create `supabase/migrations/20261118180000_drop_old_stock_functions.sql`:
```sql
-- Round D1, phase two. APPLY ONLY AFTER THE D1 DEPLOY IS READY: until then the deployed app
-- still calls deduct_stock_for_order and restock_for_voided_order.
drop function public.deduct_stock_for_order(uuid);
drop function public.restock_for_voided_order(uuid);
```
(exact signatures from Task 0 findings).
- [ ] Commit `chore(d1): phase-two migration to drop the old stock functions (apply after deploy)`.

---

## Final checks (controller, before reporting to the owner)

- `npm test`, `npx tsc --noEmit`, `npx eslint` on changed files (0 errors), `npm run build`.
- DB suites: `stock_schema_test`, `stock_sale_test`, `stock_receive_test`, `stock_void_test`, `stock_lockdown_test`, `save_menu_slots_test`, `order_record_test` (19/19), `order_adjustments_test`.
- `get_advisors` (security + performance): nothing new.
- Whole-branch review on the most capable model.
- Live run on a QA tenant at 1180×740 covering spec §7.1–7.3 and the tap-count test; delete the QA tenant; real tenant untouched.
- Owner checks on localhost → push on their word → Vercel READY → apply Task 14 → regenerate types → owner refreshes the iPad POS tab → first real-shop setup with the owner (spec §11).
