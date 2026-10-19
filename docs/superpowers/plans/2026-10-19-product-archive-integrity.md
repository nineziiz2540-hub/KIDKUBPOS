# Product Archive & Data Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Products can always be removed: deleted if never sold, otherwise archived and restorable. Recipe and modifier saves become atomic, product input is bounded, images are type-checked and cleaned up, and storage and recipe writes are locked to the owning shop's owner/manager.

**Architecture:** One migration adds `products.archived_at` plus CHECKs, two SECURITY INVOKER replace-RPCs, tighter `product_recipes` RLS, and tenant-scoped storage policies. `src/app/actions/products.ts` is rewritten around two pure helpers (`src/lib/product-input.ts`, `src/lib/product-images.ts`). The UI gets a remove dialog, a collapsed archived section, and an archived banner on the edit page.

**Tech Stack:** Next.js 16 server actions + client components, Supabase Postgres/RLS/Storage, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-19-product-archive-integrity-design.md`

## Global Constraints

- Thai copy and limits are exactly as in the spec's table and sections. Do not reword them.
- `MAX_PRODUCT_PRICE = 100000`, `HIGH_PRICE_CONFIRM = 1000`, `MAX_PRODUCT_NAME = 100`, `MAX_PRODUCT_DESCRIPTION = 500`, `MAX_RECIPE_QTY = 100000`, `MAX_RECIPE_ROWS = 50`, `MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024`.
- Image types: `image/jpeg → jpg`, `image/png → png`, `image/webp → webp`. Nothing else.
- Archived ⇒ `is_active = false`, always. Restore leaves `is_active = false`.
- Every server action checks `getProfile()`, owner/manager role, and `tenant_id` before any write.
- Test only on a disposable QA tenant (SQL `auth.users` + `create_tenant_and_owner` flow, PIN 246810). Never touch "The Connect Brew&Bar". Delete QA tenants afterwards.
- UI checks run live in the Browser pane at 1180×740 (shop iPad, landscape).
- Do not push. The user asks for the push.

## Review Focus

1. **A product sold between opening the dialog and confirming.** The delete hits 23503, and the product must end up archived, never in an error state. Pinned in Task 5 (remove a product that has an order → "archived").
2. **A product in an open held bill.** Remove is refused, and the refusal lists the queue numbers. Pinned in Task 5.
3. **A stale edit tab or a direct action call on an archived product.** `updateProduct`, `uploadProductImage`, `updateProductRecipes` and `updateProductModifiers` all refuse with "เมนูนี้ถูกเก็บแล้ว กรุณากู้คืนก่อนแก้ไข". Pinned in Task 5 (direct action POST).
4. **Staff, or another shop's owner, going around the UI through the Data API or Storage.** Pinned in Task 1's SQL attack block.
5. **A recipe save that fails halfway** (for example a foreign material id). The old recipe stays intact. Pinned in Task 1 (RPC atomicity).

---

### Task 1: Migration, types, DB attack tests

**Files:**
- Create: `supabase/migrations/20261019120000_product_archive_integrity.sql`
- Modify: `src/types/database.ts` (products Row/Insert/Update `archived_at: string | null`; Functions `replace_product_recipes`, `replace_product_modifiers`)

**Interfaces:**
- Produces: column `products.archived_at`; RPC `replace_product_recipes(p_product_id uuid, p_rows jsonb) returns void`, where `p_rows` is `[{ "raw_material_id": uuid, "quantity_used": number }]`; RPC `replace_product_modifiers(p_product_id uuid, p_modifier_ids uuid[]) returns void`. Both raise exceptions with these exact messages: `forbidden`, `product_not_found`, `product_archived`, `invalid_material`, `invalid_modifier`, `invalid_quantity`.

- [ ] **Step 1: Write the migration.** Contents, in order:
  - `alter table products add column archived_at timestamptz`.
  - CHECKs:
    - `products_archived_inactive_check`: `archived_at is null or is_active = false`.
    - `products_price_range_check`: `price >= 0 and price <= 100000 and price = round(price, 2)`.
    - `products_name_length_check`: `char_length(btrim(name)) between 1 and 100`.
    - `products_description_length_check`: `description is null or char_length(description) <= 500`.
    - `product_recipes_quantity_check`: `quantity_used > 0 and quantity_used <= 100000`.
    - Existing data passes all of them (checked 2026-10-19: max price 90, max name 10 chars, 0 recipes).
  - `product_recipes` policies:
    - Drop `tenant_isolation`.
    - Add `product_recipes_select` (`for select`, `tenant_id = public.auth_tenant_id()`).
    - Add `product_recipes_write` (`for all`, using + with check `tenant_id = public.auth_tenant_id() and public.auth_role() in ('owner','manager')`), the same shape as `product_modifiers_write`.
  - Both RPCs: `language plpgsql security invoker set search_path = public`. Body: raise `forbidden` unless `auth_role()` is owner/manager. Load the product by id and `tenant_id = auth_tenant_id()`; raise `product_not_found` or `product_archived` as fitting. For each element, check that the material or modifier has `tenant_id = auth_tenant_id()`, else raise `invalid_material` / `invalid_modifier`. Check quantity `> 0`, `<= 100000` and `= round(q, 3)`, else raise `invalid_quantity`. Then `delete … where product_id = p_product_id`, then insert, collapsing duplicate ids with `distinct on` (last element wins: order by array position desc).
  - `revoke execute … from public, anon; grant execute … to authenticated` on both RPCs.
  - Storage:
    - Drop `authenticated_upload`, `authenticated_update` and `authenticated_delete` on `storage.objects`.
    - Create `product_images_insert` / `_update` / `_delete` for `authenticated`, with condition `bucket_id = 'product-images' and (storage.foldername(name))[1] = public.auth_tenant_id()::text and public.auth_role() in ('owner','manager')`. Use it in both using and with check where the command allows.
    - `update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'] where id = 'product-images'`.

- [ ] **Step 2: Apply** with `apply_migration` (name `product_archive_integrity`).

- [ ] **Step 3: DB attack test.** Create a QA tenant A with owner, staff and a product P, and a QA tenant B with owner. Run one `DO` block, switching with `set local role authenticated` plus `request.jwt.claims` per actor. It ends with `raise exception 'RESULT %', <json>` so everything rolls back. Expected JSON (every key true):
  - `staff_recipe_insert_blocked`: staff inserting into `product_recipes` gets 42501 or 0 rows.
  - `staff_rpc_forbidden`: staff calling `replace_product_recipes` → `forbidden`.
  - `owner_rpc_ok`: A-owner replaces P's recipe with 1 row of A's material, and 1 row exists.
  - `rpc_atomic`: A-owner calls with `[A material, B material]` → `invalid_material`, and the earlier 1 row is still there.
  - `qty_rejected`: `0`, `100000.001` and `1.2345` each → `invalid_quantity`.
  - `archived_active_rejected`: `update products set archived_at = now()` while `is_active = true` → 23514.
  - `price_rejected`: `100000.01` and `1.234` → 23514.
  - `cross_tenant_storage_blocked`: B-owner inserting into `storage.objects` (bucket `product-images`, name `<A tenant id>/x.jpg`) → 42501.
  - `staff_storage_blocked`: A-staff inserting `<A tenant id>/x.jpg` → 42501.
  - `owner_storage_ok`: A-owner inserting `<A tenant id>/x.jpg` succeeds.
  - Also run `select get_advisors` (security) and confirm no new warnings for these objects.

- [ ] **Step 4: Update `src/types/database.ts` by hand** (same style as the held-bills patch), then run `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 5: Commit** `feat(products): archive column, atomic recipe/modifier RPCs, tenant-scoped image storage`.

### Task 2: Pure helpers

**Files:**
- Create: `src/lib/product-input.ts`, `src/lib/product-images.ts`

**Interfaces:**
- Produces:
  - `product-input.ts`:
    - Constants: `MAX_PRODUCT_PRICE`, `HIGH_PRICE_CONFIRM`, `MAX_PRODUCT_NAME`, `MAX_PRODUCT_DESCRIPTION`, `MAX_RECIPE_QTY`, `MAX_RECIPE_ROWS`.
    - `type ProductInput = { name: string; price: number; description: string | null; categoryId: string | null; drinkType: "hot" | "iced" | "blended" | "special" | null; isActive: boolean }`.
    - `parseProductInput(formData: FormData): { value: ProductInput } | { error: string }`. Covers every rule in the spec table except the category-tenant check, which needs the DB and lives in Task 3. Price must match `/^\d+(\.\d{1,2})?$/` after trim.
    - `type RecipeRowInput = { rawMaterialId: string; quantityUsed: number }`.
    - `parseRecipeRows(rows: { rawMaterialId: string; quantityUsed: string }[]): { value: RecipeRowInput[] } | { error: string }`. Skips rows with an empty material or empty quantity. Enforces > 0, ≤ 100000, ≤ 3 decimals and ≤ 50 rows. Error "ปริมาณวัตถุดิบไม่ถูกต้อง".
  - `product-images.ts`:
    - `PRODUCT_IMAGE_TYPES: Record<string, string>` (mime → ext) and `MAX_PRODUCT_IMAGE_BYTES`.
    - `productImagePath(tenantId: string, productId: string, mime: string, now: number): string`, giving `${tenantId}/${productId}-${now}.${ext}`.
    - `storagePathFromPublicUrl(url: string | null): string | null`. Returns the part after `/storage/v1/object/public/product-images/`, URL-decoded, or null.

- [ ] **Step 1: Write both files.** There is no unit-test runner in this repo. Verify with a throwaway `node --experimental-strip-types` script in the scratchpad that imports both files and asserts:
  - `parseProductInput` with price `"85"` → value `85`.
  - `"85.5"` → `85.5`.
  - `"8.555"` → the price error.
  - `"100000.01"` → the price error.
  - `"-1"` → the price error.
  - Name of spaces only → the name error.
  - A 101-character name → the name error.
  - A 501-character description → the description error.
  - drink_type `"cold"` → "ประเภทเครื่องดื่มไม่ถูกต้อง".
  - `parseRecipeRows` with qty `"0"` → error.
  - `"1.2345"` → error.
  - 51 rows → error.
  - An empty-material row → skipped.
  - `storagePathFromPublicUrl("https://x.supabase.co/storage/v1/object/public/product-images/t1/p-1.jpg")` → `"t1/p-1.jpg"`.
  - An unrelated URL → `null`.
  - `null` → `null`.

  Expected: all assertions pass.

- [ ] **Step 2: Commit** `feat(products): input and image-path helpers`.

### Task 3: Server actions

**Files:**
- Modify: `src/app/actions/products.ts` (rewrite), `src/lib/order-pricing.ts`, `src/app/(shell)/pos/page.tsx`, `src/lib/dal.ts` (`getProductsForCalculator`)

**Interfaces:**
- Consumes: Task 1 RPCs and column; Task 2 helpers.
- Produces:
  - `createProduct(prev: ProductState, fd: FormData): Promise<ProductState>` and `updateProduct(...)`: same signatures as today. Both use `parseProductInput` and check the category belongs to the tenant ("หมวดหมู่ไม่ถูกต้อง"). `updateProduct` adds `.is("archived_at", null).select("id")`; 0 rows → "เมนูนี้ถูกเก็บแล้ว กรุณากู้คืนก่อนแก้ไข" (or "ไม่พบสินค้า" if the row doesn't exist at all).
  - `removeProduct(productId: string): Promise<{ outcome: "deleted" | "archived" } | { error: string }>`. Flow as in the spec.
    - Held-bill check: `held_bills` where `tenant_id`, `status = 'open'`, `.contains("items", [{ productId }])`.
    - Delete with `.select("id")`. On error code `23503`, archive with `update({ archived_at: new Date().toISOString(), is_active: false }).is("archived_at", null)`.
    - After a real delete, remove the image file found by `storagePathFromPublicUrl`, best effort.
    - `revalidatePath("/products")` and `revalidatePath("/pos")`.
  - `restoreProduct(productId: string): Promise<{ ok: true } | { error: string }>`. Sets `archived_at: null` and keeps `is_active: false`, then revalidates the same paths.
  - `updateProductRecipes(productId: string, rows: { rawMaterialId: string; quantityUsed: string }[]): Promise<{ ok: true } | { error: string }>`. Calls `parseRecipeRows`, then the RPC.
  - `updateProductModifiers(productId: string, modifierIds: string[]): Promise<{ ok: true } | { error: string }>`. Calls the RPC.
  - `uploadProductImage(fd: FormData): Promise<{ url: string } | { error: string }>`. `product_id` is now required. Validates mime and size with the spec's errors: "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP" and "ไฟล์ขนาดใหญ่เกิน 5MB". Order: read the current `image_url` (product must exist and not be archived), upload, update the row (on failure, remove the new file), then remove the old file.
  - RPC error → Thai mapping:

    | RPC error | Thai message |
    |---|---|
    | `forbidden` | ไม่มีสิทธิ์ดำเนินการนี้ |
    | `product_not_found` | ไม่พบสินค้า |
    | `product_archived` | เมนูนี้ถูกเก็บแล้ว กรุณากู้คืนก่อนแก้ไข |
    | `invalid_material` | วัตถุดิบไม่ถูกต้อง กรุณารีเฟรชหน้า |
    | `invalid_modifier` | กลุ่มตัวเลือกไม่ถูกต้อง กรุณารีเฟรชหน้า |
    | `invalid_quantity` | ปริมาณวัตถุดิบไม่ถูกต้อง |
    | anything else | บันทึกข้อมูลไม่สำเร็จ |

  - `deleteProduct` is removed.
- Elsewhere:
  - `order-pricing.ts`: select `archived_at` and treat archived like inactive.
  - POS page and `getProductsForCalculator`: add `.is("archived_at", null)`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2:** `npx tsc --noEmit` and `npm run lint`. Expected: no new errors (callers in Task 4 will fail to compile until updated; do Tasks 3 and 4 back to back and run tsc after Task 4 if needed).
- [ ] **Step 3: Commit** `feat(products): remove-or-archive, restore, atomic saves, validated uploads`.

### Task 4: UI

**Files:**
- Create:
  - `src/components/products/remove-product-dialog.tsx`
  - `src/components/products/archived-products-section.tsx`
  - `src/components/products/restore-product-button.tsx`
- Modify:
  - `src/components/products/product-row-menu.tsx`
  - `src/app/(shell)/products/page.tsx`
  - `src/app/(shell)/products/[id]/edit/page.tsx`
  - `src/components/products/product-form.tsx`
  - `src/components/products/recipe-tab.tsx`
  - `src/components/products/modifiers-tab.tsx`
  - `src/components/products/image-upload-section.tsx`

**Interfaces:**
- Consumes: Task 3 actions.
- Produces:
  - `RemoveProductDialog({ productId, productName, onClose }: { productId: string; productName: string; onClose: () => void })`
    - Fixed overlay `z-50`, same visual pattern as `held-bills-panel.tsx`'s confirm. Title `ลบเมนู "{name}"?`.
    - Body: `ถ้าเมนูนี้เคยขายแล้ว ระบบจะย้ายไปที่ "เมนูที่เก็บแล้ว" แทน เพื่อเก็บประวัติบิลและรายงานไว้ กู้คืนได้ภายหลัง`.
    - Buttons "ยกเลิก" and a destructive "ลบเมนู", both h-12. Shows the error inline.
    - On success: toast `ลบเมนูแล้ว` or `ย้ายไปเมนูที่เก็บแล้ว (เคยมียอดขาย)`, then `router.refresh()` and `onClose()`.
  - `ArchivedProductsSection({ products }: { products: { id: string; name: string; price: number; archivedAt: string }[] })`: same shape as `DeactivatedMembersSection`. Header `เมนูที่เก็บแล้ว ({n})`. Each row shows the name, `฿{formatPrice(price)} · เก็บเมื่อ {th-TH date}` and a `RestoreProductButton`.
  - `RestoreProductButton({ productId }: { productId: string })`. Label "กู้คืน". On success, toast `กู้คืนแล้ว — เมนูยังปิดอยู่ เปิดได้ที่หน้าแก้ไข` and `router.refresh()`.
- Changes:
  - Products page: main list `.is("archived_at", null)`. A second query gets archived products, ordered by `archived_at desc`. Prices use `formatPrice`. The section only renders when n > 0.
  - Edit page: select `archived_at`. When it is set, render a warning banner `เมนูนี้ถูกเก็บแล้ว ไม่แสดงในหน้า POS` with `RestoreProductButton` and no tabs or form.
  - ProductForm:
    - Name `maxLength={100}`, price `max={100000}`, description `maxLength={500}`.
    - High-price guard: a `confirmHighPrice` state. When submitting with price ≥ 1000 and not yet confirmed, `preventDefault`, show `ราคา ฿{formatPrice(p)} สูงกว่าปกติ — กดบันทึกอีกครั้งเพื่อยืนยัน`, and set confirmed. Changing the price resets it.
  - RecipeTab / ModifiersTab: call the new signatures. Show "บันทึก…เรียบร้อยแล้ว" only on `{ ok }`, otherwise show the error. Editing clears both messages.
  - ImageUploadSection: `accept="image/jpeg,image/png,image/webp"`. Client-side size and type pre-check with the same Thai errors. Replace `window.location.reload()` with `router.refresh()`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint`, `npm run build`. Expected: all pass.
- [ ] **Step 3: Commit** `feat(products): remove dialog, archived section, restore, input guards`.

### Task 5: Live verification (QA tenant, Browser pane 1180×740)

**Files:** none (scratchpad scripts only)

- [ ] **Step 1:** Create the QA tenant. Seed 4 products:
  - **N:** never sold.
  - **S:** sold once through the POS.
  - **H:** in an open held bill (queue 1).
  - **I:** has an image and a recipe.
- [ ] **Step 2: Expected results in the UI:**
  - Remove **N** → toast "ลบเมนูแล้ว", and the row is gone from the DB.
  - Remove **S** → toast "ย้ายไปเมนูที่เก็บแล้ว…". It appears in "เมนูที่เก็บแล้ว (1)", is missing from the POS grid, and the order history still shows S.
  - Remove **H** → the error names "คิว 1".
  - Restore **S** → it is back in the list as "ปิด" and still missing from the POS. Toggle it on → it is on the POS.
  - Edit page of an archived product → banner only.
  - Price `8500` → a second tap is needed. `8.555` → error toast.
  - Save a recipe → saved message. A recipe with qty 0 → error, and the DB recipe is unchanged.
  - Upload a JPG to **I** → the old object is removed from `storage.objects`. Uploading a `.txt` renamed `.jpg` (mime text/plain) → rejected.
  - Remove **I** (never sold) → its storage object is gone.
- [ ] **Step 3: Direct server-action attacks** (action ids from the `page.js` chunks, POST with a `Next-Action` header). Each must be refused:
  - As staff: `removeProduct`.
  - As staff: `restoreProduct`.
  - `updateProduct` on an archived product.
  - `updateProductRecipes` with another tenant's material id.
- [ ] **Step 4:** Clean up the QA tenants (0 left) and their storage objects. Close the test tabs.
- [ ] **Step 5:** Update memory: replace `project_inventory_rls_reminder.md` to say that `product_recipes` is now fixed, and that `categories`, `raw_materials` and `inventory_transactions` remain. Add a memory for this feature.
