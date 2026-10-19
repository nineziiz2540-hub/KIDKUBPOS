# Menu ordering, one-page menu editor, iPad sizing (Products round 2)

Agreed with the user on 2026-10-19 through brainstorming with live mockups
(`.superpowers/brainstorm/564-1792420150/content/`). The fit test at real iPad size is
`fit-test-v3.html`.

## Why

The shop runs the POS on an iPad Air 5, always in landscape (Safari viewport about
1180×740). The menu is around 60 drinks: COFFEE 16 (5 of them tagged Special), MATCHA 23, and
NON-COFFEE 17, plus BAKERY and OTHER.

Problems today:

- The POS lists menus A–Z and categories in no controlled order, so the owner can't put
  best-sellers first.
- Adding a menu takes three trips: save the basics, reopen it, add the recipe, save, open
  options, save again.
- Back-office forms use desktop sizing (36px inputs, 14px text, half-width form). They're hard
  to tap and read on the iPad.

## Goals

1. **Category order.** The owner sets the order of categories (for example MATCHA before
   COFFEE). The POS category tabs follow it.
2. **Menu order.** Each category keeps its own menu order. A new menu goes to the end of its
   category. The owner can drag menus to reorder them. The POS follows this order, including the
   drink-type sub-tabs (ร้อน/เย็น/ปั่น/พิเศษ), which just filter the ordered list.
3. **One-page menu editor.** Add and Edit use the same page. Menu info, photo, options
   (modifiers) and recipe are all on one page and saved with one "บันทึกเมนู" button.
4. **iPad sizing** on the categories page, the products list, the menu editor and the category
   form. Controls are 48–56px tall, body text is 16–18px, and page titles are about 26px.
5. **Wording** (the user's exact requests):
   - "เพิ่มสินค้าใหม่" becomes "เพิ่มเมนู"
   - "ชื่อสินค้า" becomes "ชื่อเมนู"
   - "ข้อมูลทั่วไป" becomes "เมนู"
   - "สูตรอาหาร" becomes "สูตรเมนู"
6. **Products list:** thumbnails, a category filter (tabs), and the reorder mode.

## Non-goals and anti-goals

- **No reordering on the POS screen itself.** The user chose back office only, so staff can't
  drag a menu out of place mid-rush, and only Owner/Manager can reorder.
- No always-on dragging. Dragging only works after pressing "จัดเรียง". Changes apply on
  "เสร็จสิ้น", and "ยกเลิก" restores the old order.
- Don't restyle the shared `Input` / `Button` primitives app-wide. Other pages keep their
  current look. The bigger sizing is scoped to the pages above.
- No "Special" category. Special stays a drink type inside COFFEE (the user confirmed this).

## Decisions made with the user

- **Reordering happens in the back office, on two pages:**
  - "หมวดหมู่" reorders categories.
  - "สินค้า" reorders menus, one category at a time.
- **Drag with a finger on a ⠿ handle** (option A), not ▲▼ arrows, because 23 items is too many
  arrow taps.
- **Two-column editor** (option A), checked for overflow at real size.
- **Wording:** the user's four exact changes are in Goal 5 (the user's item 7 is "สูตรอาหาร →
  สูตรเมนู"). The other labels in the copy table are the builder's call, made in the same spirit.
- **Closed (ปิด) menus stay in the products list and are sortable.** They just don't show on
  the POS.
- **QA:** the round 1 flow, where each test run creates its own disposable tenant via SQL.

## Design

### Data

**The dev app and the deployed app share one Supabase database.** The migration goes live
before the new code is pushed, so the currently deployed code must keep working. That code
inserts categories and products without a sort order, and it changes `category_id`. So **the
database assigns the order, and app code never computes "max + 1":**

- `categories.sort_order int not null`, filled by a BEFORE INSERT trigger when not provided: the
  end of the tenant's list.
- `products.sort_order int not null`, handled by a BEFORE INSERT OR UPDATE trigger:
  - **On insert** without a sort order: the end of its category.
  - **On `category_id` change:** the end of the new category. This covers moving a menu, and
    the FK's existing `ON DELETE SET NULL` when a category is deleted, so those menus land at the
    end of "ไม่ระบุหมวดหมู่".
  - **On restore** (`archived_at` goes from set to null): the end of its category.
  - Otherwise the trigger leaves an explicit `sort_order` set by the reorder RPCs alone.
- **Backfill:**
  - Categories: alphabetical per tenant, which is the order the categories page shows today. The
    POS tab order may shift once; the owner rearranges once anyway. *Builder's call.*
  - Products: `row_number()` per (tenant, category_id), ordered by `created_at`, as the user
    asked ("เรียงตามการเพิ่ม").
- **Uncategorized menus** are their own group. They show last.
- **Reorder RPCs** (SECURITY INVOKER, owner/manager, one transaction):
  - `reorder_categories(p_ids uuid[])`
  - `reorder_products(p_category_id uuid, p_ids uuid[])`, where `p_category_id` null means
    uncategorized.
  - The id list must be exactly the current set: every category of the tenant, or every
    non-archived product of that category, archived excluded. Otherwise the RPC raises
    `stale_order` and the UI says "รายการมีการเปลี่ยนแปลง กรุณารีเฟรชหน้าแล้วจัดเรียงใหม่".
    This stops two devices or a stale tab from silently scrambling the order.
- **One save RPC for the editor:**
  - Signature: `save_menu(p_id uuid, p_menu jsonb, p_recipes jsonb, p_modifier_ids uuid[])
    returns uuid`. `p_id` null means create.
  - SECURITY INVOKER. It validates everything first, then writes the product, its recipes and
    its modifier links in one transaction.
  - It reuses round 1's rules: price 0–100,000 with 2 decimals, name 1–100, description ≤ 500,
    recipe quantity rules, materials and modifiers must belong to the tenant, an archived product
    can't be edited, and it handles sort_order on create and on category change.
  - It replaces the separate `updateProduct` / `updateProductRecipes` / `updateProductModifiers`
    calls from the editor. The round 1 RPCs stay; `save_menu` may call them or share their logic.
- **categories RLS:** writes are limited to owner/manager, matching products. Today Staff can
  insert, update and delete categories through the Data API. No DB function writes categories,
  so this is safe. Category names are trimmed, 1–50 chars, with a DB CHECK.

### POS

- **Category tabs:** ordered by `categories.sort_order`. As today, only categories that have at
  least one sellable menu appear.
- **Products:** ordered by category order, then `products.sort_order`. Uncategorized come last.
  The "ทั้งหมด" tab shows this same combined order.
- The POS screen gets no other changes.

### Categories page

- **Larger rows (≥ 56px)** with 17px names. Edit and delete buttons are 44–48px.
- **"จัดเรียง" mode:**
  - A ⠿ drag handle appears on each row.
  - Edit and delete are hidden while sorting.
  - "เสร็จสิ้น" saves and "ยกเลิก" reverts.
- **The category form (new/edit)** gets the same sizing.

### Products page

- **Category tabs** at the top: one per category in category order, plus "ไม่ระบุหมวดหมู่" if
  any are uncategorized.
  - Default tab: the first category, or the one given in `?category=`.
  - "ทั้งหมด" is not needed; search covers it.
  - Tabs are by category only. The drink-type sub-tabs stay a POS-only feature.
- **Each tab lists every non-archived menu in the category, closed ones included.** That is
  exactly the set `reorder_products` expects.
- **Rows:** a 48px thumbnail (placeholder icon if no photo), name, price (`formatPrice`), the
  เปิด/ปิด badge and the ⋮ menu. Rows are at least 64px tall.
- **Search** filters within the current tab.
- **"จัดเรียง" on the current tab:**
  - Drag rows by ⠿. The ⋮ menu and navigation are disabled while sorting.
  - "เสร็จสิ้น" calls `reorder_products` and "ยกเลิก" reverts.
  - Search is hidden while sorting.
- The "เมนูที่เก็บแล้ว" section from round 1 stays as is.

### Menu editor (`/products/new`, `/products/[id]/edit`)

- **Layout:**
  - Two columns at ≥ 1024px viewport, one column below that (portrait or Split View).
  - A sticky top bar has the title ("เพิ่มเมนู" / "แก้ไขเมนู"), "ยกเลิก" and the primary
    "บันทึกเมนู" (52px).
  - Left card "เมนู":
    - Photo tile (104px; camera icon, not emoji).
    - ชื่อเมนู and ราคา (บาท), with `inputmode="decimal"`.
    - หมวดหมู่ as an equal-width tappable chip grid, `repeat(auto-fill, minmax(140px, 1fr))`.
    - ประเภทเครื่องดื่ม as the same chip grid: ไม่ใช่เครื่องดื่ม / ร้อน / เย็น / ปั่น / Special.
    - รายละเอียด.
    - A "เปิดขายในหน้า POS" switch.
  - Right column, card "ตัวเลือกเพิ่มเติม": tappable rows (≥ 60px) with checkbox, name,
    บังคับ tag and an options summary (one line, ellipsis).
  - Right column, card "สูตรเมนู": rows of [material select (flex)] [qty 92px] [unit]
    [delete 50px], plus "+ เพิ่มวัตถุดิบ".
- **Fit:** measured in `fit-test-v3`, nothing overflows at 1180×740.
  - Sidebar collapsed: columns 515px, left 778px tall, right 729px.
  - Sidebar expanded: columns 435px.
  - The page scrolls about 150px; the sticky bar keeps "บันทึกเมนู" reachable.
- **Photo:**
  - Picked photos are resized on the device (round 1 helper) and previewed locally.
  - They upload on "บันทึกเมนู", after `save_menu` returns the id.
  - On create, if the upload fails, the menu is still saved. The page lands on the edit page
    with the error "บันทึกเมนูแล้ว แต่อัปโหลดรูปไม่สำเร็จ กรุณาลองเพิ่มรูปอีกครั้ง".
  - On edit, if the upload fails, stay on the page with the same message. The other changes are
    already saved.
  - A new photo replaces the old one; round 1 cleanup removes the old file.
  - No "remove photo" button. Nothing offers one today. *Builder's call.*
- **Unsaved changes:**
  - Editor "ยกเลิก" with changes asks first, in an in-app dialog: "ทิ้งการแก้ไขที่ยังไม่บันทึก?".
  - Sort-mode "ยกเลิก" reverts without asking.
  - *Builder's call.*
- **Errors:**
  - Server validation messages (round 1 copy) show in a toast and stay on the page.
  - Nothing is lost when an error is shown.
  - Network failure shows "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่".
- **After a successful save:**
  - Go to `/products` on the menu's category tab.
  - Show the toast "บันทึกเมนูแล้ว".
- **Archived menus:** the edit page keeps round 1's banner and restore button.
- **The high-price guard (≥ 1,000 needs a second tap) stays.**

### Copy

| Where | Text |
|---|---|
| Products page add button | "เพิ่มเมนู" |
| Editor titles | "เพิ่มเมนู" / "แก้ไขเมนู" |
| Name label | "ชื่อเมนู" |
| Section titles | "เมนู", "ตัวเลือกเพิ่มเติม", "สูตรเมนู" |
| Active switch | "เปิดขายในหน้า POS" |
| Reorder buttons | "จัดเรียง", "เสร็จสิ้น", "ยกเลิก" |

## Constraints

- Next.js 16 (read `node_modules/next/dist/docs/` before using APIs), Supabase, Tailwind v4.
- Drag and drop: `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0 and `@dnd-kit/utilities`
  3.2.2. Use touch-friendly sensors: a press-and-hold delay or a distance threshold, so a scroll
  is never mistaken for a drag.
- Test only on a disposable QA tenant. Never touch "The Connect Brew&Bar".
- Verify live in the Browser pane at 1180×740.
- No push until the user asks.

## Left to the builder

- Exact dnd sensor thresholds, as long as page scrolling with a finger still works in sort mode.
- Whether `save_menu` calls the round 1 replace RPCs or inlines the same checks.
- Component split and file names inside `src/components/products/` and
  `src/components/categories/`.
