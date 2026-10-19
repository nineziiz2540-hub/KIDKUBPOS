# Menu Ordering & One-Page Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners order categories and menus by dragging (back office only), the POS follows that order, menus are created and edited on one iPad-sized page with a single save, and the categories/products pages get POS-standard touch sizing and the user's wording.

**Architecture:** A migration adds `sort_order` to categories and products. Postgres triggers own every "append to end" decision, so the currently deployed code, which shares this DB, keeps working. Three SECURITY INVOKER RPCs do the work:
- `reorder_categories` and `reorder_products` rewrite an exact, complete id list.
- `save_menu` writes product + recipe + modifier links in one transaction.

A shared `SortableList` (dnd-kit) drives both reorder screens. A new `MenuEditor` client component replaces `ProductForm` + `RecipeTab` + `ModifiersTab` + `ImageUploadSection`.

**Tech Stack:** Next.js 16 server actions + client components, Supabase Postgres/RLS, Tailwind v4, `@dnd-kit/core` 6.3.1 / `@dnd-kit/sortable` 10.0.0 / `@dnd-kit/utilities` 3.2.2.

**Spec:** `docs/superpowers/specs/2026-10-19-menu-ordering-and-editor-design.md` (fit evidence: `.superpowers/brainstorm/564-1792420150/content/fit-test-v3.html`)

## Global Constraints

- **Shared DB.** The migration goes live before the code is pushed. The deployed code inserts categories/products without `sort_order` and updates `category_id`. That must keep working, so app code never computes "max + 1".
- **Copy is verbatim from the spec.** User-mandated:
  - เพิ่มเมนู · ชื่อเมนู · section "เมนู" · section "สูตรเมนู"
  - Builder copy: แก้ไขเมนู · ตัวเลือกเพิ่มเติม · เปิดขายในหน้า POS · จัดเรียง / เสร็จสิ้น / ยกเลิก · บันทึกเมนู · บันทึกเมนูแล้ว · ทิ้งการแก้ไขที่ยังไม่บันทึก? · รายการมีการเปลี่ยนแปลง กรุณารีเฟรชหน้าแล้วจัดเรียงใหม่ · บันทึกเมนูแล้ว แต่อัปโหลดรูปไม่สำเร็จ กรุณาลองเพิ่มรูปอีกครั้ง · เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่
- **Touch sizing on the categories page, category form, products page and menu editor only.** Do not change the shared `Input` / `Button` primitives. Sizes:
  - Controls 48–52px tall; primary save 52px.
  - Text 16–18px; titles ~26px.
  - Rows ≥ 56px (categories) / ≥ 64px (products); chips 48px.
  - Chip grid `repeat(auto-fill, minmax(140px, 1fr))`.
  - Editor two columns at ≥ 1024px viewport (`lg:`).
  - Recipe qty input 92px; delete 50px.
- **Reordering is owner/manager only and back-office only.** Nothing changes on the POS screen except the order.
- **Round 1 rules still hold:**
  - Price 0–100,000 with 2 decimals; name 1–100; description ≤ 500.
  - Recipe qty > 0, ≤ 100,000, ≤ 3 decimals, ≤ 50 rows.
  - Tenant checks on materials, modifiers and categories.
  - Archived menus can't be edited.
  - Photos are resized on the device; ≤ 5 MB; JPG/PNG/WebP.
- **Category name:** trimmed, 1–50 chars.
- **Testing:**
  - QA tenant only, created by SQL as in round 1. Never touch "The Connect Brew&Bar".
  - Verify UI at 1180×740 in the Browser pane.
  - No push until the user asks.

## Review Focus

1. **The currently deployed code inserts a product/category with no `sort_order`, or moves a product to another category.** The row must get the end position; nothing may error. → Task 1 test `legacy_insert_gets_end`, `category_change_goes_to_end`.
2. **Reorder from a stale tab** (another device added, archived or recategorized a menu meanwhile). Expect `stale_order` and no partial reorder. → Task 1 `reorder_stale_rejected`; Task 7 live check.
3. **The editor save fails part-way** (e.g. a foreign material on a NEW menu). Nothing may be written: no orphan product. → Task 1 `save_menu_create_atomic`.
4. **A category is deleted while it still has menus.** Those menus land at the end of "ไม่ระบุหมวดหมู่", and the products page shows that tab. → Task 1 `deleted_category_menus_go_last`; Task 7 live.
5. **The photo upload fails right after a new menu was saved.** The menu exists, the user lands on its edit page with the upload message, and nothing is duplicated on retry. → Task 8 step with forced upload failure.

---

### Task 1: Migration, types, DB tests

**Files:**
- Create: `supabase/migrations/20261020120000_menu_ordering.sql`
- Modify: `src/types/database.ts` (`categories.sort_order`, `products.sort_order`; Functions `reorder_categories`, `reorder_products`, `save_menu`)

**Interfaces:**
- **Produces:**
  - `reorder_categories(p_ids uuid[]) returns void`
  - `reorder_products(p_category_id uuid, p_ids uuid[]) returns void` (`p_category_id` null = uncategorized)
  - `save_menu(p_id uuid, p_menu jsonb, p_recipes jsonb, p_modifier_ids uuid[]) returns uuid`. `p_menu` keys: `name, price, description, category_id, drink_type, is_active`. `p_recipes` has the same shape as round 1's `replace_product_recipes`.
- **Raised messages:** `forbidden`, `product_not_found`, `product_archived`, `invalid_category`, `invalid_material`, `invalid_modifier`, `invalid_quantity`, `stale_order`. Constraint violations surface as SQLSTATE 23514.

- [ ] **Step 1: Write the DB test first.**
  - Location: the plan workspace `db-test.sql`, a `DO` block ending in `raise exception 'RESULT %'`. Same actor-switching pattern as round 1.
  - Setup: QA tenants A and B; A owner and A staff; categories A1 and A2 in tenant A; products P1, P2, P3 in A1 (created in that order) and P4 in A2.
  - Every key must be `true`:
    - `backfill_products_by_created`: P1 < P2 < P3 in `sort_order` (run after the migration's backfill; for RED, missing column = false).
    - `legacy_insert_gets_end`: as owner, insert a product into A1 without `sort_order` → it is greater than every other in A1.
    - `legacy_category_insert_gets_end`: insert a category without `sort_order` → it is the max of the tenant.
    - `category_change_goes_to_end`: move P1 to A2 → P1's sort_order is greater than P4's.
    - `restore_goes_to_end`: archive P2 (set `is_active=false, archived_at=now()`), then restore (`archived_at=null`) → it is the max in A1.
    - `deleted_category_menus_go_last`: delete A2 → its products have `category_id` null, and their sort_order is greater than any pre-existing uncategorized product.
    - `reorder_products_ok`: owner `reorder_products(A1, <A1's current non-archived ids, reversed>)` → sort_order follows the array order.
    - `reorder_stale_rejected`: an array missing one id → `stale_order`, with order unchanged; an array with a foreign id → `stale_order`; a duplicate id → `stale_order`.
    - `reorder_categories_ok` and `reorder_categories_stale`: same pattern.
    - `staff_reorder_forbidden`: staff calls either reorder RPC → `forbidden`.
    - `staff_category_write_blocked`: staff inserts, updates or deletes a category → 42501 or 0 rows.
    - `category_name_check`: `'   '` and a 51-char name → 23514.
    - `save_menu_create_ok`: owner creates a menu in A1 with 1 recipe row and 1 modifier → it returns an id; the product is at the end of A1, with 1 recipe and 1 link.
    - `save_menu_create_atomic`: create with a tenant-B material → `invalid_material`, and no product with that name exists.
    - `save_menu_update_ok`: change name, price and category → updated, moved to the end of the new category, and recipes/links replaced.
    - `save_menu_archived_rejected`: `save_menu` on an archived product → `product_archived`.
    - `save_menu_foreign_category`: `category_id` from tenant B → `invalid_category`.
    - `staff_save_menu_forbidden`.
- [ ] **Step 2: Run it before the migration.**
  - Run: paste into `execute_sql`.
  - Expected: RESULT with most keys `false` (missing column or function).
- [ ] **Step 3: Write the migration.**
  - Columns: add both `sort_order int` columns.
  - Backfill:
    - categories: `row_number() over (partition by tenant_id order by name)`
    - products: `row_number() over (partition by tenant_id, category_id order by created_at, id)`
    - Then `set not null`.
  - Index: `products (tenant_id, category_id, sort_order)`.
  - Trigger functions (plpgsql, SECURITY INVOKER is fine; they only read the same table):
    ```sql
    -- products: BEFORE INSERT OR UPDATE
    if tg_op = 'INSERT' then
      if new.sort_order is null then new.sort_order := <max in (tenant, category) excluding new.id> + 1; end if;
    elsif new.category_id is distinct from old.category_id
       or (old.archived_at is not null and new.archived_at is null) then
      new.sort_order := <max in (tenant, new.category_id) where id <> new.id> + 1;
    end if;
    -- "max" = coalesce(max(sort_order), 0)
    ```
    Categories trigger: BEFORE INSERT only, same null-fill rule per tenant.
  - Categories:
    - Drop the four tenant-only policies.
    - Add `categories_select` (tenant).
    - Add `categories_write` (`for all`, tenant + `auth_role() in ('owner','manager')`), the same shape as `product_recipes_write`.
    - Add CHECK `categories_name_length_check (char_length(btrim(name)) between 1 and 50)`. Existing data passes: longest is 12 chars.
  - RPCs (all `security invoker set search_path = public`, revoke from public/anon, grant to authenticated):
    - **Reorder**:
      1. Check role.
      2. `stale_order` unless the array has no duplicates AND `(select array_agg(id order by id) from <current set>) = (select array_agg(x order by x) from unnest(p_ids) x)`.
      3. `update … set sort_order = o.ord from unnest(p_ids) with ordinality o(id, ord) where …`.
    - **`save_menu`**:
      1. Check role.
      2. Validate `category_id` belongs to the tenant (or is null), else `invalid_category`.
      3. If `p_id` is null, insert (`tenant_id = auth_tenant_id()`, no sort_order). Otherwise update `where id = p_id and tenant_id = auth_tenant_id() and archived_at is null`; if no row, raise `product_archived` or `product_not_found`.
      4. `perform replace_product_recipes(id, p_recipes)` and `perform replace_product_modifiers(id, p_modifier_ids)`.
      5. Return the id.
      - Any raise rolls back the whole call, including the insert.
- [ ] **Step 4: Apply and run again.**
  - Run: `apply_migration` with name `menu_ordering`, then rerun `db-test.sql`.
  - Expected: every key `true`. Also run `get_advisors` (security): no new findings for these objects.
- [ ] **Step 5: Update the types.** Patch `src/types/database.ts` by hand (Row: `sort_order: number`; Insert/Update: `sort_order?: number`; three Functions). Run `npx tsc --noEmit`. Expected: 0 errors.
- [ ] **Step 6: Commit.** Message: `feat(menu): sort order columns, append-to-end triggers, reorder and save_menu RPCs, owner-only categories`.

### Task 2: Menu draft validation helper

**Files:**
- Modify: `src/lib/product-input.ts`
- Test: `<workspace>/helpers-test.mts`, run with `node --experimental-strip-types`.

**Interfaces:**
- **Produces:**
  - `type MenuDraft = { name: string; price: string; description: string; categoryId: string | null; drinkType: DrinkType | null; isActive: boolean; recipes: { rawMaterialId: string; quantityUsed: string }[]; modifierIds: string[] }`
  - `parseMenuDraft(d: MenuDraft): { value: { menu: ProductInput; recipes: RecipeRowInput[]; modifierIds: string[] } } | { error: string }`. It applies the same rules and Thai messages as `parseProductInput` and `parseRecipeRows`, de-duplicates `modifierIds`, and rejects an unknown `drinkType`.
  - `parseCategoryName(raw: unknown): { value: string } | { error: string }`. Trims; 1–50 chars. Error: "ชื่อหมวดหมู่ต้องมี 1–50 ตัวอักษร".
  - `parseProductInput` keeps its behaviour. Re-implement it on top of a shared internal field validator so the rules live once.
- [ ] **Step 1: Write the tests first.** Cases:
  - `parseMenuDraft` with a valid draft → value; price `"85"` → 85.
  - Price `"8.555"` → the price error.
  - Name of 101 chars → the name error.
  - Recipe qty `"0"` → `"ปริมาณวัตถุดิบไม่ถูกต้อง"`.
  - `modifierIds` `["a","a","b"]` → `["a","b"]`.
  - drinkType `"cold"` (cast) → `"ประเภทเครื่องดื่มไม่ถูกต้อง"`.
  - `parseCategoryName("  COFFEE ")` → `"COFFEE"`; `""` and 51 chars → error; `5` → error.
  - Round 1's existing assertions still pass.
- [ ] **Step 2: Run them.** Run: `node --experimental-strip-types <workspace>/helpers-test.mts`. Expected: FAIL, export not found.
- [ ] **Step 3: Implement** in `src/lib/product-input.ts`. Keep it import-free.
- [ ] **Step 4: Run again.** Same command. Expected: `all pass`.
- [ ] **Step 5: Commit.** Message: `feat(menu): menu draft and category name validation`.

### Task 3: Server actions

**Files:**
- Modify: `src/app/actions/products.ts`, `src/app/actions/categories.ts`
- Create: `src/app/actions/menu-order.ts`

**Interfaces:**
- **Consumes:** Task 1 RPCs; Task 2 helpers.
- **Produces:**
  - `saveMenu(productId: string | null, draft: MenuDraft): Promise<{ ok: true; id: string; categoryId: string | null } | { error: string }>`, in `products.ts`.
    - Order: role → `parseMenuDraft` → `rpc("save_menu")`.
    - Maps RPC messages with round 1's `RPC_ERRORS`, plus `invalid_category` → "หมวดหมู่ไม่ถูกต้อง".
    - Then `revalidatePath("/products")`, `revalidatePath("/pos")`, and the product's edit path.
  - Remove `createProduct`, `updateProduct`, `updateProductRecipes` and `updateProductModifiers`, plus their now-unused imports. `ProductState` goes too if unused.
  - `reorderCategories(ids: string[])` and `reorderProducts(categoryId: string | null, ids: string[])`, both returning `Promise<{ ok: true } | { error: string }>`, in `menu-order.ts`. `stale_order` → "รายการมีการเปลี่ยนแปลง กรุณารีเฟรชหน้าแล้วจัดเรียงใหม่"; `forbidden` → "ไม่มีสิทธิ์ดำเนินการนี้". Revalidate `/categories`, `/products` and `/pos`.
  - `categories.ts`:
    - `createCategory` and `updateCategory` use `parseCategoryName`.
    - `updateCategory` checks that a row was updated (`.select("id")`).
    - `deleteCategory` keeps its signature but checks the error; on failure `redirect("/categories?error=1")`. The categories page shows "ลบหมวดหมู่ไม่สำเร็จ" when `error=1`.
- [ ] **Step 1: Implement.**
- [ ] **Step 2: Check.** Run `npx tsc --noEmit`. Expected: errors only in files Task 8 replaces (`product-form.tsx`, `recipe-tab.tsx`, `modifiers-tab.tsx`, the products new/edit pages). List them in the ledger. Tasks 3–8 land before the full green check.
- [ ] **Step 3: Commit.** Message: `feat(menu): saveMenu, reorder actions, validated category actions`.

### Task 4: POS follows the order

**Files:**
- Modify: `src/app/(shell)/pos/page.tsx`, `src/types/app.ts` (`PosCategory` gains `sortOrder: number`)

**Interfaces:**
- **Consumes:** the `sort_order` columns.
- **Produces:** `products` passed to `PosScreen` already sorted, and `categories` sorted by category `sort_order`. `ProductGrid` needs no change: it filters in the given order.

- [ ] **Step 1: Implement.**
  - Select `sort_order, categories(id, name, sort_order)`.
  - Sort products by `(category sort_order, or +∞ when uncategorized) → product sort_order → name`.
  - Build the category list from the products (only categories with sellable menus, as today), sorted by category `sort_order`.
- [ ] **Step 2: Check.** Run `npx tsc --noEmit`. Expected: no new errors in these files.
- [ ] **Step 3: Commit.** Message: `feat(pos): categories and menus follow the owner's order`.

### Task 5: SortableList component

**Files:**
- Modify: `package.json` / `package-lock.json`
- Create: `src/components/ui/sortable-list.tsx`

**Interfaces:**
- **Produces:**
  ```ts
  type SortableListProps<T extends { id: string }> = {
    items: T[];                                    // current order
    onReorder: (items: T[]) => void;               // called after each drop
    renderItem: (item: T, handle: React.ReactNode) => React.ReactNode; // handle = the ⠿ element to place
  };
  export function SortableList<T extends { id: string }>(props: SortableListProps<T>): JSX.Element
  ```
  - Built on `DndContext` + `SortableContext` (`verticalListSortingStrategy`) + `useSortable`. The listeners attach only to the handle.
  - The handle is a 48×48 button with `aria-label="ลากเพื่อย้าย"`, class `touch-none`, and the GripVertical icon.
  - Sensors: `PointerSensor` with `activationConstraint: { distance: 6 }` and `KeyboardSensor` with `sortableKeyboardCoordinates`.
  - Only the handle captures touch, so finger-scrolling the rest of the row scrolls the page.
  - The dragged row gets a shadow, a slight lift and an orange border.
  - `restrictToVerticalAxis` is not needed; skip `@dnd-kit/modifiers`.
- [ ] **Step 1: Install exact versions.** Run `npm install @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2 --save-exact`. Expected: added; `npm ls @dnd-kit/core` shows 6.3.1.
- [ ] **Step 2: Implement** `sortable-list.tsx`. Mark it `"use client"` and keep it generic.
- [ ] **Step 3: Check and commit.** Run `npx tsc --noEmit` on this file (no new errors), then commit `feat(ui): touch-friendly sortable list`.

### Task 6: Categories page + form

**Files:**
- Modify: `src/app/(shell)/categories/page.tsx`, `src/components/categories/category-form.tsx`, `src/app/(shell)/categories/new/page.tsx`, `src/app/(shell)/categories/[id]/edit/page.tsx`
- Create: `src/components/categories/category-list.tsx` (client)

**Interfaces:**
- **Consumes:** `SortableList`, `reorderCategories`, `deleteCategory`.
- **Produces:** `CategoryList({ categories, canManage }: { categories: { id: string; name: string }[]; canManage: boolean })`.

- [ ] **Step 1: Implement.**
  - The page selects `id, name` ordered by `sort_order, name`, scoped by `tenant_id`.
  - Header:
    - Title "หมวดหมู่สินค้า" at ~26px.
    - Buttons "จัดเรียง" (outline, 48px) and "เพิ่มหมวดหมู่" (accent, 48px). Owner/manager only.
  - Normal mode:
    - Rows ≥ 56px, names at 17px.
    - "แก้ไข" and "ลบ" buttons are 44px tall; keep the existing confirm.
  - Sort mode:
    - The ⠿ handle on each row; edit and delete hidden.
    - The header swaps to "ยกเลิก" + "เสร็จสิ้น".
    - "เสร็จสิ้น" calls `reorderCategories(ids)`: on success, toast "บันทึกลำดับแล้ว" and `router.refresh()`; on error, toast the error and stay in sort mode.
    - "ยกเลิก" restores the server order.
    - Network failure → "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่".
  - If `?error=1`, show "ลบหมวดหมู่ไม่สำเร็จ".
  - Category form:
    - Input 50px / 17px with `maxLength={50}`, label 16px.
    - Buttons 48px; error 15px.
    - Placeholder "เช่น COFFEE, MATCHA".
- [ ] **Step 2: Check.** Run `npx tsc --noEmit` and `npx eslint` on the changed files. Expected: no new errors here.
- [ ] **Step 3: Commit.** Message: `feat(categories): drag to reorder, iPad sizing`.

### Task 7: Products page — tabs, thumbnails, reorder

**Files:**
- Modify: `src/app/(shell)/products/page.tsx`, `src/components/products/product-row-menu.tsx` (trigger 44px), `src/components/products/saved-toast-trigger.tsx` (accepts `title` prop, default "บันทึกสำเร็จ")
- Create: `src/components/products/product-list.tsx` (client)

**Interfaces:**
- **Consumes:** `SortableList`, `reorderProducts`, `ProductRowMenu`, `ArchivedProductsSection`.
- **Produces:** `ProductList({ groups, initialCategory }: { groups: { key: string; categoryId: string | null; name: string; products: { id: string; name: string; price: number; isActive: boolean; imageUrl: string | null }[] }[]; initialCategory: string | null })`.
  - `key` is the category id, or `"none"`.

- [ ] **Step 1: Implement.**
  - Page:
    - Load categories ordered by `sort_order, name`.
    - Load non-archived products: `id, name, price, is_active, image_url, category_id, sort_order`, ordered by `sort_order, created_at`.
    - Build one group per category, plus a trailing "ไม่ระบุหมวดหมู่" group only if non-empty. Pass `?category=` as `initialCategory`. Keep the archived section.
    - On `saved=1`, show `<SavedToastTrigger title="บันทึกเมนูแล้ว" />`.
  - `ProductList`:
    - Tabs: chips, 48px, horizontally scrollable if many. Each shows its count.
    - Search input: 48px / 17px, filters the current tab by name, client-side state. Don't use `SearchFilter`, because the tab needs controlled filtering.
    - Rows ≥ 64px: 48px rounded thumbnail (`ImageIcon` placeholder), name 17px truncate, `฿{formatPrice}` 16px, เปิด/ปิด badge, `ProductRowMenu`.
    - Header buttons "จัดเรียง" + "เพิ่มเมนู". The latter links to `/products/new?category=<current>`.
    - Sort mode: search and ⋮ hidden; `SortableList`; "เสร็จสิ้น" calls `reorderProducts(group.categoryId, ids)`; same toasts as Task 6. "จัดเรียง" is disabled when the tab has fewer than 2 menus.
    - Empty tab: "ยังไม่มีเมนูในหมวดนี้".
- [ ] **Step 2: Check.** Same as Task 6.
- [ ] **Step 3: Commit.** Message: `feat(products): category tabs, thumbnails, drag to reorder`.

### Task 8: One-page menu editor

**Files:**
- Create: `src/components/products/menu-editor.tsx` (client), `src/components/ui/confirm-dialog.tsx`
- Modify: `src/app/(shell)/products/new/page.tsx`, `src/app/(shell)/products/[id]/edit/page.tsx`
- Delete: `src/components/products/product-form.tsx`, `recipe-tab.tsx`, `modifiers-tab.tsx`, `image-upload-section.tsx`

**Interfaces:**
- **Consumes:** `saveMenu`, `uploadProductImage`, `resizeImageForUpload`, `HIGH_PRICE_CONFIRM`, the round 1 limits, `RestoreProductButton`.
- **Produces:**
  ```ts
  type MenuEditorProps = {
    productId: string | null;               // null = create
    initial: MenuDraft;                     // from Task 2
    imageUrl: string | null;
    categories: { id: string; name: string }[];      // in sort order
    modifiers: ModifierWithOptions[];       // sorted as getModifiers returns
    rawMaterials: { id: string; name: string; unit: string }[];
  };
  export function MenuEditor(props: MenuEditorProps): JSX.Element
  ```
  - `ConfirmDialog({ title, body?, confirmLabel, onConfirm, onCancel, destructive? })`. Same overlay pattern as `RemoveProductDialog`, with 48px buttons.

- [ ] **Step 1: Pages.**
  - Both pages load the categories (sorted), `getModifiers`, `getRawMaterials`, and (edit) product, recipes and links.
  - New: `initial.categoryId` comes from `?category=` if it is a valid category.
  - Edit: archived products keep the round 1 banner and render no editor; `notFound()` for other tenants.
  - Remove the old tabs.
- [ ] **Step 2: The editor.** Layout as in the spec and `fit-test-v3.html`.
  - Sticky bar: title, "ยกเลิก", "บันทึกเมนู".
  - Left card "เมนู":
    - 104px photo tile. Tapping it opens a file picker; show a local preview.
    - ชื่อเมนู; ราคา (บาท) with `inputmode="decimal"`.
    - หมวดหมู่ chip grid; ประเภทเครื่องดื่ม chip grid (ไม่ใช่เครื่องดื่ม / ร้อน / เย็น / ปั่น / Special).
    - รายละเอียด (`maxLength` 500); "เปิดขายในหน้า POS" switch.
  - Right column:
    - "ตัวเลือกเพิ่มเติม": tappable rows ≥ 60px with checkbox, name, บังคับ tag and a one-line options summary. Empty state links to `/modifiers`.
    - "สูตรเมนู": rows of [select flex] [qty 92px, `inputmode="decimal"`] [unit] [delete 50px], plus "+ เพิ่มวัตถุดิบ" and the cost preview. Empty state links to `/inventory`.
  - Save flow:
    1. High-price guard (round 1 rule: a new price ≥ 1,000 that differs from the saved price needs a second tap; inline warning).
    2. `saveMenu(productId, draft)`; on error, toast it and stay.
    3. If a new photo was picked: resize, then `uploadProductImage({ product_id: id, image })`. On failure: for a create, `router.replace("/products/<id>/edit?photo=failed")`; for an edit, stay. Both show "บันทึกเมนูแล้ว แต่อัปโหลดรูปไม่สำเร็จ กรุณาลองเพิ่มรูปอีกครั้ง".
    4. Success: `router.push("/products?category=<categoryId ?? 'none'>&saved=1")`.
    - Wrap the network calls with "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่".
    - Disable the save button while pending.
  - "ยกเลิก": if `JSON.stringify(draft) !== JSON.stringify(initial)` or a photo was picked, `ConfirmDialog` asks "ทิ้งการแก้ไขที่ยังไม่บันทึก?" (confirm label "ทิ้งการแก้ไข"). Otherwise `router.back()` to the products page.
  - The edit page reads `?photo=failed` and shows the same message once.
- [ ] **Step 3: Delete the four replaced components.** Confirm nothing imports them: `grep -rn "product-form\|recipe-tab\|modifiers-tab\|image-upload-section" src` → no matches.
- [ ] **Step 4: Full green.** Run `npx tsc --noEmit`, `npm run lint`, `npm run build`. Expected: all exit 0 (pre-existing CSS warnings only).
- [ ] **Step 5: Commit.** Message: `feat(menu): one-page add/edit menu editor with single save`.

### Task 9: Live verification (QA tenant, Browser pane 1180×740)

**Files:** none (workspace scripts only)

- [ ] **Step 1: Seed a QA tenant.**
  - Owner, staff.
  - Categories COFFEE, MATCHA, NON - COFFEE, BAKERY, OTHER.
  - 6 menus across 3 categories, one of them closed.
  - 2 raw materials; 2 modifiers (one บังคับ).
- [ ] **Step 2: Expected results in the UI (sidebar collapsed AND expanded):**
  - **Categories:** reorder MATCHA above COFFEE → after refresh the order holds, and the POS tabs show MATCHA first.
  - **Products, MATCHA tab:** drag the 3rd menu to 1st → "เสร็จสิ้น" → the POS "MATCHA" tab and "ทั้งหมด" follow. "ยกเลิก" in sort mode reverts.
  - **Scrolling vs dragging:** finger-scroll (wheel or touch drag on a row body) scrolls without moving rows; dragging by ⠿ moves rows.
  - **Stale order:** open the products page in tab 2, add a menu from tab 1, then reorder in tab 2 → the stale-order message, nothing changed.
  - **Add a menu with photo + 2 recipe rows + 1 modifier in one save** → it lands on its category tab, last in order, with the thumbnail shown; the DB has 2 recipes and 1 link; it appears on the POS.
  - **Edit:** change category → it moves to the end of the new category.
  - **Validation:** price `8.555` → error toast, nothing saved; a 0-qty recipe → error, nothing saved, including on create (no orphan menu).
  - **Unsaved changes:** "ยกเลิก" with edits → the confirm dialog.
  - **Forced photo failure on create** (override `fetch` for the upload action only) → the menu exists, the page lands on edit with the message, and saving again doesn't duplicate.
  - **Delete a category with menus** → those menus appear under "ไม่ระบุหมวดหมู่", last.
  - **Overflow:** no horizontal overflow on any of the 4 pages (JS check: `document.documentElement.scrollWidth <= innerWidth`, plus per-card check as in the fit test).
- [ ] **Step 3: Direct server-action attacks as staff** (`reorderCategories`, `reorderProducts`, `saveMenu`) → "ไม่มีสิทธิ์ดำเนินการนี้", DB unchanged. Also a direct Data API category insert as staff → blocked (already covered in the Task 1 SQL; re-check via the action).
- [ ] **Step 4: Legacy compatibility.** Re-run the Task 1 `db-test.sql` after all tasks. Its `legacy_*` keys prove that the deployed code's inserts and updates (no `sort_order`) still work. Never exercise the production site with test data. Expected: all keys `true`.
- [ ] **Step 5: Clean up.** QA tenants 0, test images 0, cookies cleared, viewport reset.
- [ ] **Step 6: Update memory.** Add a feature memory, update `project_inventory_rls_reminder.md` (categories fixed), and update the MEMORY.md index.
