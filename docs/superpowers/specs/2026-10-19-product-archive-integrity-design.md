# Products page — archive instead of delete, data integrity (Round 1)

Approved by the user on 2026-10-19 ("อนุมัติและเริ่มทำได้โดยวางแผนอย่างละเอียด").

## Problem

1. Deleting a product that has ever been sold silently does nothing. `order_items.product_id`
   references `products(id)` with no `ON DELETE`, so Postgres rejects the delete (23503), and
   `deleteProduct` ignores the error and redirects back to the list.
2. Saving a recipe or modifier links deletes the old rows, then inserts the new ones, in two
   requests. If the insert fails, the old rows are gone and the UI still says "saved".
3. Price has no ceiling and no decimal limit (`8500` instead of `85` is accepted silently).
4. Replacing an image leaves the old file in storage; the file extension comes from the
   user's filename; any type of file is accepted.

Found while investigating (fixed in the same round because the same code paths change):

5. Storage policies on bucket `product-images` let **any logged-in user of any shop** upload,
   overwrite or delete **any shop's** images (policies only check `bucket_id`).
6. `product_recipes` has one `ALL` policy scoped by tenant only, so Staff can write recipes
   directly through the Data API (the Inventory RLS reminder). `deduct_stock_for_order` and
   `restock_for_voided_order` only **read** `product_recipes`, so locking writes is safe.

## Design

### Remove = delete if never sold, otherwise archive

- New column `products.archived_at timestamptz null`. Archived ⇒ `is_active = false`
  (DB CHECK), hidden from the POS, the main products list and the cost calculator.
- One server action `removeProduct(productId)`:
  1. Refuses if the product is in an **open held bill**: "เมนูนี้อยู่ในบิลพักที่ยังไม่ชำระ
     (คิว 3, 5) กรุณาชำระหรือแก้ไขบิลก่อน".
  2. Tries a real delete. Recipes and modifier links cascade. The image file is removed.
  3. If the delete fails with 23503 (the product has sales), it archives instead. This covers a
     sale that lands between opening the dialog and confirming.
- The products page gets a collapsed "เมนูที่เก็บแล้ว (n)" section, the same pattern as
  deactivated team members, with a "กู้คืน" button. Restoring clears `archived_at` and leaves the
  product **closed** (`is_active = false`), so it never reappears on the POS by surprise.
- The edit page of an archived product shows a banner with "กู้คืน" instead of the form.
  The server also rejects edits, image uploads, recipe saves and modifier saves for archived
  products.
- An in-app confirm dialog replaces `confirm()`. It explains that a product that has been sold
  moves to "เมนูที่เก็บแล้ว". The toast afterwards says which of the two outcomes happened.

### Atomic recipe and modifier saves

- Two SECURITY INVOKER RPCs, each one transaction: `replace_product_recipes` and
  `replace_product_modifiers`. They check role and tenant, check that every material or
  modifier belongs to the tenant, then delete and insert. Any error rolls back everything.
- Server actions return `{ ok: true } | { error }`. The tabs show "saved" only on success and
  show the error otherwise.

### Input limits (server + DB CHECK)

| Field | Rule | Thai error |
|---|---|---|
| name | trimmed, 1–100 chars | ชื่อสินค้าต้องมี 1–100 ตัวอักษร |
| price | 0–100,000, at most 2 decimals | ราคาต้องอยู่ระหว่าง 0–100,000 บาท และมีทศนิยมไม่เกิน 2 ตำแหน่ง |
| description | ≤ 500 chars | รายละเอียดต้องไม่เกิน 500 ตัวอักษร |
| category_id | null or a category of this tenant | หมวดหมู่ไม่ถูกต้อง |
| drink_type | null, hot, iced, blended, special | ประเภทเครื่องดื่มไม่ถูกต้อง |
| recipe quantity | > 0, ≤ 100,000, at most 3 decimals; ≤ 50 rows | ปริมาณวัตถุดิบไม่ถูกต้อง |

- Soft guard in the form: a price ≥ 1,000 needs a second tap on "บันทึก". The form shows
  "ราคา ฿8,500 สูงกว่าปกติ — กดบันทึกอีกครั้งเพื่อยืนยัน".

### Images

- Only JPEG, PNG and WebP, ≤ 5 MB. The bucket enforces the same limits. The extension comes
  from the MIME type.
- Path: `<tenant_id>/<product_id>-<timestamp>.<ext>`. After the product row points at the new
  file, the old file is removed (best effort). If updating the row fails, the new upload is
  removed.
- Storage write policies (insert/update/delete) require the first folder to be
  `auth_tenant_id()` and the role to be owner or manager. Reads stay public (the bucket is
  public).

## Out of scope (Round 2)

Thumbnails and the category filter in the list, POS menu ordering, touch sizing on product
pages, and ฿85 vs ฿85.00 display. Exception: the list switches to `formatPrice` now, because
that line is already being rewritten.
