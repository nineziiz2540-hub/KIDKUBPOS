# QR e-receipt (ใบเสร็จ QR) + shop logo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- After every paid bill, the POS cart shows a QR code by itself (แบบ A).
- A customer scans it and gets a read-only receipt page for that one bill on their phone, with no login.
- The receipt shows the shop's own logo, which the owner uploads in Settings. A shop without a logo shows its name instead.
- Staff can show the same QR again from the bill's history page.

**Architecture:**
- **Link:** the token is the bill's existing `orders.client_ref` (a UUID v4 made on the iPad at payment time, offline too). The link is `{origin}/r/{client_ref}`. `order_record` and the outbox are untouched.
- **Data:** one `security definer` SQL function, `receipt_get(p_token uuid)`, that only `service_role` may call. It returns a whitelisted jsonb, so the fields that may reach a customer are listed in one place and covered by a SQL test. The page calls it through the admin client.
- **Page:** a public, server-rendered page at `src/app/r/[token]/page.tsx`.
  - It sits outside the `(shell)` and `(auth)` route groups and is excluded from the proxy matcher.
  - A pure module turns the jsonb into what the page shows.
- **Logo:**
  - Stored as `tenants.logo_url`, the same pattern as `products.image_url`. The file lives in the existing public `product-images` bucket under the shop's folder.
  - The image is trimmed and shrunk on the device before upload.
  - Only the owner can set or remove it.
- **Service worker:** Serwist's automatic registration is turned off. One small client component in the root layout registers it on every page except `/r/…`.
- **QR:** drawn on the device with the `qrcode` package that is already installed, so it works offline.

**Tech Stack:** Next.js 16.2.9 (App Router; read `node_modules/next/dist/docs/` before writing Next code), React 19.2, Supabase Postgres 17 (plpgsql) and Storage, `qrcode` 1.5, Serwist 9.5.11, node:test (`npm test`), Tailwind tokens in `src/app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-11-24-qr-e-receipt-design.md`. The owner approved it on 2026-11-24 and approved the logo addition (§7.9) the same day. The spec is the authority. Section numbers below (§7.4 etc.) refer to it.

## Global Constraints

- **One Supabase DB for dev and production** (`khgahdjfkzpgsvbhfrqx`). A migration is live the moment it is applied.
  - Additive only. Use `create or replace` with the same signature only; no overloads.
  - **Do not modify `order_record` or anything in the offline outbox path** (spec §3 anti-goal).
- **SQL process (same as D1/D2a):**
  1. Dry run: the migration text plus its test in ONE `execute_sql` call. The test ends with `raise exception 'RESULT <json>'`, so it always rolls back.
  2. Task review.
  3. The controller applies the exact committed file (`apply_migration`).
  4. The controller verifies the live `md5(prosrc)` against the committed body.
  5. Regenerate types (`generate_typescript_types`) and hand-merge only the new entries into `src/types/database.ts`.
- **`receipt_get`:**
  - Declared `language plpgsql security definer set search_path = public`.
  - Then `revoke all on function … from public, anon, authenticated; grant execute … to service_role`.
  - Called only from server code, via `createAdminClient()` (`src/lib/supabase/admin.ts`).
- **Never sent to the browser on `/r/`** (spec §7.2):
  - `cost_total`, `created_by` and every approver column, `customer_id`
  - `note` (on the bill and on each line), every reason column
  - `shift_id`, `tenant_id`, `orders.id`, `bags`

  A non-`completed` bill sends no items and no money at all.
- **Exact customer-facing copy** (spec §7.2–7.5):
  - Heading: `ใบเสร็จรับเงิน (ไม่ใช่ใบกำกับภาษี)`
  - Footer: `ขอบคุณที่อุดหนุน`
  - Cancelled: `บิลนี้ถูกยกเลิกแล้ว`
  - Refunded: `บิลนี้คืนเงินแล้ว`
  - Unpaid: `ร้านยังไม่ได้รับเงินสำหรับบิลนี้ กรุณาติดต่อร้าน`
  - Not found, invalid, not synced or unknown status: `ยังไม่พบใบเสร็จนี้ ถ้าเพิ่งซื้อตอนอินเทอร์เน็ตของร้านขัดข้อง ลองเปิดใหม่ภายหลัง`
  - POS QR caption: `สแกนเก็บใบเสร็จ`
  - Offline note: `เปิดได้หลังบิลขึ้นระบบ`
  - History button: `QR ใบเสร็จ`
  - Page title: `ใบเสร็จ · {ชื่อร้าน}`
- **Logo rules** (spec §7.9):
  - Owner only. The file goes to bucket `product-images` at `<tenant_id>/logo-<epoch ms>.png`.
  - On the device: trim white or transparent margins only, shrink the longest side to ≤ 800 px, output PNG. Never remove a background and never change colours.
  - The receipt box is 170×100 px for a full receipt and 96×66 px for a status notice, `object-fit: contain`.
  - With no logo, the receipt shows the shop name as text.
  - Settings hint: `แนะนำไฟล์ PNG พื้นหลังโปร่งใส มีแค่โลโก้และชื่อร้าน`
- **The path `/r/` is permanent.** Customers keep photos of these QR codes, so it must never be renamed.
- **Never block or slow a sale:**
  - If the QR cannot be drawn, nothing shows and the sale goes on.
  - No extra tap: the QR appears and disappears with the after-sale queue number.
- **No new env vars or secrets. No Vercel or Supabase setting changes.**
- **Live checks run on a disposable QA tenant only.**
  - Its name starts with `QA QR`. Task 3 creates it and Task 8 deletes it, together with its storage files. The purge is guarded by tenant name.
  - **Never touch the tenant "The Connect Brew&Bar".**
  - Copy the pattern from `qa-d2a-setup.cjs` / `qa-cookie.cjs` in the session scratchpad (`C:\Users\WINDOW~1\AppData\Local\Temp\claude\263e0ca2def7991f\3a5a4dc8-7924-4c1f-bf3c-5515c9efd802\scratchpad`).
  - Test passwords and PINs are test values that live only in the scratchpad.
- **UI:**
  - Colour tokens only (`accent`, `sidebar`, `success`, `warning`, `destructive`, `muted`).
  - Touch targets ≥ 48 px. Thai words only on screen.
  - Check POS and Settings in the Browser pane at 1180×740 (iPad landscape). Check the receipt page at 375×812.
- **Verification commands:** `npm test`, `npx tsc --noEmit`, `npx eslint <changed files>`, `npm run build`.
  - Serwist is off in development. **Service-worker checks need `npm run build` plus the `kidkubpos-prod-local` launch config** (port 3000), so stop the dev server first.
- **Commits:** commit per task on `main`. **Push only when the owner says so.**

## Review Focus

1. **A cash bill later changed to transfer** (order_adjustments) keeps its old `cash_received`/`change_amount`. The receipt must not show "รับเงิน … ทอน …". Pinned by the SQL key `cash_fields_only_for_cash` (Task 1) and a unit test (Task 2).
2. **The owner's real logo file is 4334×4334 px with wide white margins.** On an iPad, a canvas over ~16.7 MP fails, and this file is 18.8 MP. Processing must downscale before reading pixels. It must end with a trimmed logo, not a square full of white. Pinned by a unit test of `logoWorkSize` (Task 4), plus the live check with that exact file (Task 4) and the owner's iPad check (Task 8).
3. **A status the app doesn't know yet** (a future value of `orders.status`) must show the not-found message, never a paid receipt. Unit test `unknown status is not shown as paid` (Task 2).
4. **A token in capitals, or with a query string** (some scanner apps uppercase links; LINE adds `?openExternalBrowser=1`) still opens the receipt. Unit test for capitals (Task 2) and a live check of both (Task 3).
5. **An offline cash sale** stacks the warning card, the cash box and the QR. It must still fit the iPad cart without scrolling. Live measurement `scrollHeight <= clientHeight` at 1180×740 (Task 6).

## Owner-facing calls in this plan (Claude ตัดสินเอง — เจ้าของแก้ได้)

- **P-1:** ใบเสร็จไม่แสดงคำว่า "แก้วร้าน" ใต้รายการ ถือเป็นประเภทการสั่งเหมือนถุง ส่วนตัวเลือกอื่นแสดงตามปกติ
- **P-2:** ตัวเลขเงินทุกจุดมีทศนิยม 2 ตำแหน่งและคั่นหลักพัน เช่น `฿1,250.00` รวมถึงบรรทัด `รับเงิน ฿200.00 · ทอน ฿60.00`
- **P-3:** บิลที่ไม่มีส่วนลดแสดงบรรทัดเดียวว่า "ยอดสุทธิ" ส่วนบิลที่มีส่วนลดแสดง "รวม / ส่วนลด / ยอดสุทธิ"
- **P-4:** วิธีชำระเขียนว่า "ชำระโดย เงินสด" หรือ "ชำระโดย โอนเงิน"
- **P-5:** ระบบไม่ได้เก็บลำดับรายการในตะกร้าไว้ ใบเสร็จจึงเรียงรายการตามเวลาก่อน แล้วตามชื่อ ลำดับเหมือนเดิมทุกครั้งที่เปิด
- **P-6:** QR บน POS ขนาด 148 px ถ้าช่องตะกร้าไม่พอจะลดระยะห่างรอบ ๆ ก่อน และไม่ลด QR ต่ำกว่า 120 px ส่วน QR ในหน้าประวัติบิลขนาด 296 px
- **P-7:** ปุ่ม "QR ใบเสร็จ" อยู่ใต้หัวบิลในหน้าประวัติบิล
- **P-8:** ถ้าฐานข้อมูลขัดข้อง หน้าใบเสร็จขึ้นข้อความเดียวกับ "ยังไม่พบ"
- **P-9:** ตัวช่วยออฟไลน์ลงทะเบียนจากจุดเดียวใน layout หลัก ทุกหน้าทำงานเหมือนเดิม ยกเว้นหน้า `/r/…`
- **P-10:** ช่องโลโก้อยู่ในส่วน "ข้อมูลร้านค้า" ของหน้าตั้งค่า แก้ได้เฉพาะเจ้าของร้าน (manager แก้ไม่ได้ เหมือนชื่อร้าน) ไฟล์เก็บที่เดียวกับรูปเมนู
- **P-11:** ถ้าตัดขอบแล้วไม่เหลืออะไรเลย (รูปขาวล้วนหรือโปร่งใสล้วน) ระบบขึ้นว่า "ไม่พบโลโก้ในรูปนี้" และไม่บันทึก

---

## Task 1: DB — `receipt_get`, client_ref index, `tenants.logo_url`

**Files:**
- Create: `supabase/migrations/20261124170000_receipt_get.sql`
- Create: `supabase/tests/receipt_get_test.sql`
- Modify: `src/types/database.ts` (hand-merge `tenants.logo_url` and the `receipt_get` function entry)

**Interfaces:**
- Produces:
  - **Index** `orders_client_ref_idx on public.orders (client_ref) where client_ref is not null`. The existing `orders_tenant_client_ref` starts with `tenant_id`, so it can't serve this lookup.
  - **Column** `tenants.logo_url text` (null = no logo), with check constraint `tenants_logo_url_own_folder`:
    ```sql
    logo_url is null or (char_length(logo_url) <= 500 and logo_url like '%/storage/v1/object/public/product-images/' || id::text || '/logo-%')
    ```
    `tenants` has table-level grants (checked 2026-11-24). The update policy `owners can update their tenant name` already limits writes to the owner, so no grant or policy changes.
  - **Function** `public.receipt_get(p_token uuid) returns jsonb`:
    - Returns **null** when `p_token` is null, when no order has that `client_ref`, or when **more than one** order (any tenants) has it.
    - **Base keys, always and exactly:** `shop_name` (`tenants.name`), `shop_logo_url` (`tenants.logo_url`), `order_number`, `queue_number`, `created_at`, `status`.
    - **Only when `status = 'completed'`, it adds:**
      - `items`: an array of exactly `{ name, quantity, subtotal, choices, options }`.
        - Built from `product_name`, `quantity`, `subtotal`, `choices` and `modifiers_snapshot`.
        - Ordered by `order_items.created_at, product_name, id`.
        - `[]` when the bill has no lines.
      - `subtotal`, `discount_amount`, `total`, `payment_method`.
      - `cash_received` and `change_amount`: the stored values only when `payment_method = 'cash'`, otherwise JSON null.
    - Read-only. Never raises for a normal miss.
  - **Types:** `receipt_get: { Args: { p_token: string }; Returns: Json }`, and `logo_url: string | null` on the tenants Row, Insert and Update.

- [ ] **Step 1: Write `supabase/tests/receipt_get_test.sql`** in the style of `supabase/tests/order_record_test.sql`.
  - **Seed:** use `create_tenant_and_owner`, and insert into `orders` / `order_items` directly as the default role.
  - **Markers:** put a distinctive marker in every forbidden column:
    - note `'NOTE-MARKER'`, every reason `'REASON-MARKER'`
    - a customer named `'CUSTOMER-MARKER'`, a staff `full_name` `'STAFF-MARKER'`
    - `cost_total = 987.65`
  - **Sessions:** RLS checks use `set local role authenticated` + `request.jwt.claims`.
  - Every key must be true:
    - **Shape of a completed bill:**
      - `completed_full_shape`: the key set equals the 6 base keys plus `items, subtotal, discount_amount, total, payment_method, cash_received, change_amount`.
      - `item_fields_only`: each item's key set is exactly `{name, quantity, subtotal, choices, options}`.
      - `items_order_stable`: two lines with equal `created_at` come back in `product_name` order, the same on two calls.
      - `empty_items_array`: a completed bill with no lines gives `items = []`.
    - **Statuses:**
      - `cancelled_minimal_keys`, `refunded_minimal_keys`, `unpaid_minimal_keys`: exactly the 6 base keys.
      - `restored_paid_full`: call once while the bill is `unpaid` (6 keys). Update it to `completed` with `transfer_verified_at` set, as `restore_paid` does. Call again: the full shape.
      - `transfer_unverified_full`: a transfer with `transfer_verified_at is null` gets the full shape.
    - **Money:**
      - `cash_fields_only_for_cash`: a `transfer` bill storing `cash_received = 200, change_amount = 60` gives both null. A cash bill gives `200` and `60`.
      - `discount_amount_present`: `discount_amount = 15` comes back as 15.
    - **Logo:**
      - `logo_url_returned`: a tenant with a valid `logo_url` returns it in `shop_logo_url`.
      - `logo_null_when_unset`: a tenant without one returns null.
    - **No leaks:**
      - `no_forbidden_text`: across every seeded result, `result::text` contains none of `NOTE-MARKER`, `REASON-MARKER`, `CUSTOMER-MARKER`, `STAFF-MARKER`, `987.65`, the order's `id`, the `tenant_id`, or the `client_ref`.
    - **Misses:**
      - `not_found_null`, `null_token_null`.
      - `same_ref_two_tenants_null`: the same `client_ref` on an order in tenant A and on one in tenant B gives null.
    - **Who may call it:**
      - `anon_cannot_execute`, `authenticated_cannot_execute`: `has_function_privilege(..., 'execute')` is false.
      - `service_role_can_execute`: true.
      - `definer_with_search_path`: `pg_proc.prosecdef` is true and `proconfig` contains `search_path=public`.
    - **Index:**
      - `index_exists_partial`: the `pg_indexes.indexdef` of `orders_client_ref_idx` matches `%(client_ref)%WHERE (client_ref IS NOT NULL)%`.
    - **Who may set the logo:**
      - `owner_sets_logo_own_folder`: as owner, an update to `https://x.supabase.co/storage/v1/object/public/product-images/<own tenant id>/logo-1.png` succeeds.
      - `logo_other_folder_refused`: another tenant's folder raises 23514.
      - `logo_external_url_refused`: `https://evil.example/logo.png` raises 23514.
      - `manager_cannot_set_logo`, `staff_cannot_set_logo`: their update changes 0 rows.
- [ ] **Step 2: Dry run the test alone.** Expected: it fails, because `receipt_get` and `logo_url` are missing.
- [ ] **Step 3: Write the migration.**
  - `set local lock_timeout = '5s'` at the top.
  - Header comment covering:
    - what each object is for
    - "additive; the deployed app neither reads logo_url nor calls receipt_get"
    - "the whitelist of fields that may reach a customer lives in receipt_get"
  - Use a plain `create index if not exists`.
- [ ] **Step 4: Dry run the migration plus the test in one `execute_sql`.** Expected: `RESULT` with every key true. Commit both files and request review. The controller then applies, checks md5, regenerates types and hand-merges them.
- [ ] **Step 5: `npx tsc --noEmit` passes. Commit:**
  ```bash
  git commit -m "feat(receipt): receipt_get service function, client_ref index, tenants.logo_url"
  ```

## Task 2: Pure receipt logic: link, token, page view

**Files:**
- Create: `src/lib/receipt-link.ts`, `src/lib/receipt-link.test.ts`
- Create: `src/lib/receipt-view.ts`, `src/lib/receipt-view.test.ts`

Both are pure, so `npm test` can load them: relative `.ts` imports only, no `@/`, no React or Next.

**Interfaces:**
- Consumes:
  - `billLineDetail` and `ChoiceSnapshot` (`src/lib/stock/option-window.ts`, `src/lib/stock/stock-core.ts`)
  - `formatDateTime` (`src/lib/bangkok-time.ts`)
- Produces in `receipt-link.ts`:
  - `export const RECEIPT_PATH = "/r/"`
  - `export const RECEIPT_QR_CAPTION = "สแกนเก็บใบเสร็จ"`
  - `export const RECEIPT_QR_PENDING_NOTE = "เปิดได้หลังบิลขึ้นระบบ"`
  - `export function isReceiptToken(s: string): boolean`: the same UUID regex as `UUID_RE` in `src/app/actions/orders.ts`, case-insensitive.
  - `export function receiptUrl(origin: string, clientRef: string): string`: `origin` with any trailing `/` removed, then `RECEIPT_PATH`, then `clientRef`.
  - `export function shouldRegisterServiceWorker(pathname: string): boolean`: false for `/r` and anything under `/r/`, true otherwise.
- Produces in `receipt-view.ts`:
  - `export type ReceiptItemData = { name: string; quantity: number; subtotal: number; choices: ChoiceSnapshot | null; options: (string | { option: string; priceDelta?: number; optionId?: string })[] | null }`
  - `export type ReceiptData = { shop_name: string; shop_logo_url: string | null; order_number: string | null; queue_number: number | null; created_at: string; status: string; items?: ReceiptItemData[]; subtotal?: number; discount_amount?: number; total?: number; payment_method?: string; cash_received?: number | null; change_amount?: number | null }`
  - `export type ReceiptView`, one of three shapes:
    - `{ kind: "not_found"; message: string }`
    - `{ kind: "notice"; shopName: string; logoUrl: string | null; billLine: string; dateTime: string; message: string; tone: "destructive" | "warning" }`
    - `{ kind: "receipt"; shopName: string; logoUrl: string | null; billLine: string; dateTime: string; lines: { text: string; amount: string; detail: string | null }[]; subtotal: string | null; discount: string | null; total: string; payment: string | null; cash: string | null }`
  - `export function toReceiptView(data: ReceiptData | null): ReceiptView`
  - `export function receiptTitle(view: ReceiptView): string`: `ใบเสร็จ · {shopName}`, or `ใบเสร็จ` for not-found.
  - Exported copy constants with the exact strings from Global Constraints: `RECEIPT_HEADING`, `RECEIPT_THANKS`, `RECEIPT_NOT_FOUND`, `RECEIPT_CANCELLED`, `RECEIPT_REFUNDED`, `RECEIPT_UNPAID`.
- Rules the signatures leave open:
  - **`billLine`:** `บิล {order_number}` and `คิว {queue_number}`, each only when not null, joined by ` · `. Empty string when both are null.
  - **`dateTime`:** `formatDateTime(created_at)` + ` น.`.
  - **Money:** `฿` plus `toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })` (P-2).
  - **Lines:** `text` is `{name} ×{quantity}`. `detail` is `billLineDetail(choices without its "packaging" key, options ?? [])` (P-1).
  - **Totals:** `subtotal` and `discount` are set only when `discount_amount > 0`; the discount reads `-฿15.00`.
  - **`payment`:** `ชำระโดย เงินสด` for cash, `ชำระโดย โอนเงิน` for transfer, null otherwise.
  - **`cash`:** only for cash with both amounts present: `รับเงิน ฿200.00 · ทอน ฿60.00`.
  - **`logoUrl`:** `shop_logo_url`, or null when empty or missing.
  - **Statuses:**
    - `cancelled` → notice, tone `destructive`.
    - `refunded` → notice, tone `warning`.
    - `unpaid` → notice, tone `destructive`.
    - `completed` without a finite `total` → not-found.
    - Any other status → not-found.

- [ ] **Step 1: Write the failing tests.**
  - `receipt-link.test.ts`:
    - `isReceiptToken accepts a v4 uuid in lower and upper case`
    - `isReceiptToken rejects "abc", "", a uuid with spaces, a 35-char string`
    - `receiptUrl("https://kidkubpos.vercel.app/", ref) === "https://kidkubpos.vercel.app/r/" + ref`
    - `shouldRegisterServiceWorker`: `"/pos"` true, `"/"` true, `"/login"` true, `"/r/x"` false, `"/r"` false, `"/reports"` true
  - `receipt-view.test.ts` (use `created_at: "2026-11-24T07:05:00Z"`):
    - `completed cash bill`:
      - `billLine === "บิล TC-0123 · คิว 12"`
      - `dateTime === "24 พ.ย. 2569 14:05 น."`
      - a line `{ text: "ลาเต้เย็น ×2", amount: "฿140.00" }`
      - `total === "฿140.00"`
      - `payment === "ชำระโดย เงินสด"`
      - `cash === "รับเงิน ฿200.00 · ทอน ฿60.00"`
      - `subtotal` and `discount` are null
    - `discount shows subtotal and minus line`: `subtotal === "฿155.00"`, `discount === "-฿15.00"`.
    - `thousands separator`: total 1250 gives `"฿1,250.00"`.
    - `Bangkok time across midnight`: `created_at: "2026-11-24T17:30:00Z"` gives `dateTime === "25 พ.ย. 2569 00:30 น."`.
    - `transfer shows no cash line even if amounts are present`: `payment === "ชำระโดย โอนเงิน"`, `cash === null`.
    - `house glass word is not on the receipt`: a snapshot with `packaging: { houseGlass: true }` and a sweetness level gives a `detail` that contains the level name and not `"แก้วร้าน"`.
    - `logo passes through; empty string becomes null`.
    - `cancelled/refunded/unpaid give a notice with the exact message and tone`.
    - `unknown status is not shown as paid`: `status: "voided"` gives `kind === "not_found"`.
    - `null data gives not_found with RECEIPT_NOT_FOUND`.
    - `completed with no items gives a receipt with lines []`.
    - `receiptTitle` for a receipt and for not-found.
- [ ] **Step 2:** Run `npm test`. Expected: the new tests fail, because the modules are missing.
- [ ] **Step 3: Implement both modules.**
- [ ] **Step 4: Verify.** Run `npm test`, `npx tsc --noEmit`, and `npx eslint` on the 4 files. All pass.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(receipt): pure receipt link and receipt view logic"
  ```

## Task 3: Public receipt page `/r/[token]`

**Files:**
- Create: `src/lib/receipt-data.ts`
- Create: `src/components/receipt/receipt-brand.tsx`
- Create: `src/app/r/[token]/page.tsx`
- Modify: `src/proxy.ts` (matcher only), `next.config.ts` (add `headers()`)

**Interfaces:**
- Consumes:
  - Task 1 `receipt_get`.
  - Task 2 `isReceiptToken`, `toReceiptView`, `receiptTitle`, the copy constants, `ReceiptData`.
- Produces:
  - `export const getReceipt: (token: string) => Promise<ReceiptData | null>` in `src/lib/receipt-data.ts`:
    - `import "server-only"`. Wrapped in React `cache()`, so metadata and the page share one call.
    - Returns null without touching the DB when `!isReceiptToken(token)`.
    - Otherwise calls `createAdminClient().rpc("receipt_get", { p_token: token })`.
    - On error it runs `console.error("receipt_get failed", error.code)` and returns null (P-8).
  - `export function ReceiptBrand({ logoUrl, shopName, size }: { logoUrl: string | null; shopName: string; size: "full" | "small" })`:
    - No hooks and no `"use client"`, so both the receipt page (server) and the Settings preview (client, Task 4) can render it.
    - With a logo: an `<img src={logoUrl} alt={shopName}>` centred in a box of 170×100 (`full`) or 96×66 (`small`), with `object-contain`. Add `// eslint-disable-next-line @next/next/no-img-element`, as `src/components/pos/product-grid.tsx:171` does.
    - Without one: the shop name as centred text (`full`: 20 px, weight 600; `small`: 16 px).

- [ ] **Step 1: Read the Next docs.**
  - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`: the sections `robots`, `referrer`, `manifest`, `appleWebApp` and Merging.
  - `…/02-guides/caching-without-cache-components.md`: `dynamic`.
  - The `headers` page under `03-api-reference/05-config/01-next-config-js/`.
- [ ] **Step 2: Proxy.** In `src/proxy.ts`, add `r/` to the negative lookahead of the single matcher: `...|offline\\.html|r/).*)`. Nothing else in the proxy changes.
- [ ] **Step 3: Headers.** In `next.config.ts`, add `async headers()`. For `source: "/r/:token*"` it returns `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`.
- [ ] **Step 4: `ReceiptBrand` and the page.**
  - The page is a server component and renders no client components. Segment config: `export const dynamic = "force-dynamic"`.
  - `generateMetadata({ params })` returns:
    - `title: receiptTitle(view)`
    - `robots: { index: false, follow: false }`
    - `referrer: "no-referrer"`
    - `manifest: null` and `appleWebApp: null`. If the `Metadata` type refuses null, use `appleWebApp: { title: "ใบเสร็จ" }`.
  - Body: `<main lang="th">` holding a centred white card, `max-w-sm`, readable at 375 px.
  - A **receipt** view shows, in this order (spec §7.2, plus the mockup the owner approved on 2026-11-24):
    1. `<ReceiptBrand size="full">`
    2. `RECEIPT_HEADING`, small and muted
    3. bill line
    4. date
    5. dashed divider
    6. lines, each with its detail in small muted text
    7. dashed divider
    8. `รวม` / `ส่วนลด` / `ยอดสุทธิ` (P-3; ยอดสุทธิ larger)
    9. payment
    10. cash
    11. dashed divider
    12. `RECEIPT_THANKS`
  - A **notice** view shows `<ReceiptBrand size="small">`, the bill line, the date, and the message in `text-destructive` or `text-warning` per `tone`. No lines, no totals.
  - A **not-found** view shows only its message.
  - The bill number and every amount use `font-mono tabular-nums`. `--font-mono` is Inter, the app's number font.
  - The page has no links and no buttons.
- [ ] **Step 5: QA tenant and seed.**
  - Copy `qa-d2a-setup.cjs` to `qa-qr-setup.cjs` in the scratchpad. Use tenant name `QA QR Receipt`, a QA owner and a QA staff.
  - Seed through `execute_sql` as the default role:
    - a cash `completed` bill: cash 200/60, two lines with choices, note `NOTE-MARKER`
    - a transfer `completed` bill with stale cash amounts
    - a bill with a discount of 15
    - one `cancelled`, one `refunded`, one `unpaid`
    - a `completed` bill whose `client_ref` is null (needed in Task 7)
  - Save the ids and refs to `qa-qr-ids.json` in the scratchpad.
- [ ] **Step 6: Live check on the dev server `kidkubpos-dev`.** The QA tenant has no logo yet, so the name fallback shows.
  - **Signed out:**
    - `curl -s -o out.html -w "%{http_code} %{redirect_url}" http://localhost:3000/r/<cash ref>` gives `200` and an empty redirect.
    - `out.html` contains `QA QR Receipt`, `ใบเสร็จรับเงิน (ไม่ใช่ใบกำกับภาษี)` and `รับเงิน ฿200.00 · ทอน ฿60.00`.
    - It does not contain `NOTE-MARKER`, the order id, the tenant id or the staff name.
  - **Headers:** `curl -sI` shows `x-robots-tag: noindex, nofollow` and `referrer-policy: no-referrer`, and `cache-control` contains `no-store`.
  - **Each seeded ref shows the right view:**
    - The stale-cash transfer has no cash line.
    - `/r/not-a-uuid` returns `200` with the not-found message.
    - The cash ref in capitals, and the cash ref with `?openExternalBrowser=1`, both show the full receipt.
  - **Signed in:** with the QA owner cookie jar (`qa-cookie.cjs`), the cash ref gives `200` and no redirect.
  - **Screenshots** in the Browser pane at 375×812: the cash receipt, the discount receipt and the unpaid notice.
- [ ] **Step 7: Verify and commit.** Run `npx tsc --noEmit`, `npx eslint` on the changed files, and `npm run build`. Then:
  ```bash
  git commit -m "feat(receipt): public /r/[token] receipt page (no login, noindex, no cache)"
  ```

## Task 4: Shop logo in Settings (owner)

**Files:**
- Create: `src/lib/logo-image.ts`, `src/lib/logo-image.test.ts` (pure)
- Create: `src/lib/prepare-logo.ts` (browser-only)
- Create: `src/app/actions/shop-logo.ts`
- Create: `src/components/settings/shop-logo-form.tsx`
- Modify: `src/app/(shell)/settings/page.tsx`

**Interfaces:**
- Consumes:
  - Task 1 `tenants.logo_url`.
  - Task 3 `ReceiptBrand`.
  - `PRODUCT_IMAGE_BUCKET` and `storagePathFromPublicUrl` (`src/lib/product-images.ts`).
  - `getProfile` (`src/lib/dal`).
- Produces in `logo-image.ts` (pure):
  - `export const LOGO_MAX_SIDE = 800`
  - `export const LOGO_WORK_MAX_SIDE = 2000`
  - `export const LOGO_MAX_BYTES = 1024 * 1024`
  - `export const LOGO_HINT = "แนะนำไฟล์ PNG พื้นหลังโปร่งใส มีแค่โลโก้และชื่อร้าน"`
  - `export function logoWorkSize(width: number, height: number): { width: number; height: number }`: scales down so the longer side is ≤ `LOGO_WORK_MAX_SIDE`, never up, with rounded integers.
  - `export function logoTrimBox(data: Uint8ClampedArray, width: number, height: number): { x: number; y: number; width: number; height: number } | null`:
    - A pixel is empty when alpha < 16, or when r, g and b are all ≥ 245.
    - Returns the bounding box of the non-empty pixels, padded by 2 % of the longer side and clamped to the image. Returns null when nothing is non-empty.
  - `export function logoOutputSize(width: number, height: number): { width: number; height: number }`: the longer side ≤ `LOGO_MAX_SIDE`, never upscaled.
  - `export function logoPath(tenantId: string, now: number): string` returns `` `${tenantId}/logo-${now}.png` ``.
- Produces in `prepare-logo.ts` (browser):
  - `export async function prepareLogo(file: File): Promise<{ file: File; previewUrl: string } | { error: string }>`
  - Steps:
    1. `createImageBitmap(file, { imageOrientation: "from-image" })`.
    2. Draw onto a canvas of `logoWorkSize(...)`. This must never be a full-size canvas: an iPad canvas over ~16.7 MP fails.
    3. `getImageData`, then `logoTrimBox`.
    4. Draw the trimmed area onto a transparent canvas of `logoOutputSize(...)`.
    5. `toBlob(…, "image/png")`.
    6. Return a `File` named `logo.png` plus `URL.createObjectURL`.
  - Errors, as exact Thai text:
    - Type not jpeg/png/webp: `รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP`
    - Decode or canvas failure: `อ่านไฟล์รูปไม่ได้`
    - Trim box null: `ไม่พบโลโก้ในรูปนี้` (P-11)
    - Output > `LOGO_MAX_BYTES`: `ไฟล์โลโก้ใหญ่เกินไป`
- Produces in `src/app/actions/shop-logo.ts` (`"use server"`):
  - `export async function uploadShopLogo(formData: FormData): Promise<{ url: string } | { error: string }>`:
    - Owner only; anyone else gets `ไม่มีสิทธิ์ดำเนินการนี้`.
    - The `logo` field must be a `File` of type `image/png`, size ≤ `LOGO_MAX_BYTES`.
    - Upload with the **user** client to `PRODUCT_IMAGE_BUCKET` at `logoPath(tenant_id, Date.now())`.
    - Update `tenants.logo_url` to the public URL. If the update fails, remove the new file and return `อัปโหลดโลโก้ไม่สำเร็จ`.
    - Remove the previous file, read from the old `logo_url` via `storagePathFromPublicUrl`.
    - Finish with `revalidatePath("/settings")`.
    - Pattern: `uploadProductImage` in `src/app/actions/products.ts:250-295`.
  - `export async function removeShopLogo(): Promise<{ ok: true } | { error: string }>`: owner only. Sets `logo_url = null`, then removes the file.
- Produces in `shop-logo-form.tsx` (client):
  - `export function ShopLogoForm({ logoUrl, shopName }: { logoUrl: string | null; shopName: string })`
  - **Shows:**
    - the current state as `<ReceiptBrand size="full">` inside a white mini receipt header
    - `LOGO_HINT`
    - a `เลือกไฟล์โลโก้` button (≥ 48 px; hidden `input type=file accept="image/png,image/jpeg,image/webp"`)
    - `ลบโลโก้` when a logo exists, confirmed through `ConfirmDialog` with the title `ลบโลโก้ร้าน?`
  - **After choosing a file:** run `prepareLogo`, then show the preview header: `ReceiptBrand` with the preview URL, `RECEIPT_HEADING` and a sample line `บิล 0001 · คิว 1`. Offer `บันทึกโลโก้` (primary) and `ยกเลิก`.
  - **Feedback:** errors show inline in `text-destructive`. Success toasts read `บันทึกโลโก้แล้ว` / `ลบโลโก้แล้ว`.
  - **Clean-up:** revoke object URLs on cancel, on save and on unmount.

- [ ] **Step 1: Write the failing tests** in `logo-image.test.ts`:
  - `logoWorkSize(4334, 4334)` gives `{ width: 2000, height: 2000 }`; `logoWorkSize(500, 300)` stays `{ width: 500, height: 300 }`.
  - `logoOutputSize(2000, 1000)` gives `{ width: 800, height: 400 }`; `logoOutputSize(300, 200)` stays.
  - `logoTrimBox`, using small synthetic RGBA arrays built in the test:
    - `white margins are trimmed`: a 10×10 white image with a 2×3 black block at (4,3) gives a box covering exactly that block, plus padding clamped.
    - `transparent margins are trimmed`
    - `a solid coloured background is kept whole`: an all-black 10×10 gives the full image.
    - `all white gives null`, `all transparent gives null`
    - `near-white (250,250,250) counts as empty`
  - `logoPath("t1", 5) === "t1/logo-5.png"`
- [ ] **Step 2:** Run `npm test`. Expected: the new tests fail.
- [ ] **Step 3: Implement** `logo-image.ts`, `prepare-logo.ts`, `shop-logo.ts`, `shop-logo-form.tsx`.
  - In the settings page, add `logo_url` to the tenants select.
  - Render `<ShopLogoForm>` in the `ข้อมูลร้านค้า` section, under `StoreNameForm`, with a `โลโก้ร้าน (แสดงบนใบเสร็จ)` sub-label.
- [ ] **Step 4: Verify.** Run `npm test`, `npx tsc --noEmit`, and `npx eslint` on the changed files.
- [ ] **Step 5: Live check on the dev server, as the QA owner, at 1180×740.**
  - **Get the test file in:** the Browser pane has no file picker.
    - Copy the owner's logo, `C:\Users\Windows 11 Pro\.claude\uploads\3a5a4dc8-7924-4c1f-bf3c-5515c9efd802\ab19fe72-image.png` (4334×4334, wide white margins), to `public/qa-logo-test.png` **temporarily**.
    - Set it into the input with `javascript_tool`: fetch it, then `new DataTransfer()`, then `input.files = dt.files`, then dispatch `change`.
    - **Never commit it.** Delete it at the end of this step and confirm `git status` doesn't list it.
  - **Preview:** the preview `<img>` has `naturalWidth <= 800` and an aspect ratio of about 1.46. That shows it was trimmed; a square means it was not. Take a screenshot.
  - **Save:**
    - `select logo_url from tenants where name = 'QA QR Receipt'` matches the pattern.
    - `/r/<cash ref>` at 375×812 shows the logo instead of the name. Take a screenshot.
    - The unpaid notice shows the small logo.
  - **Upload again:** `select count(*) from storage.objects where bucket_id = 'product-images' and name like '<qa tenant id>/logo-%'` stays 1, so the old file was removed.
  - **Remove:** `logo_url` is null, the storage count is 0, and the receipt shows `QA QR Receipt` as text.
  - **Error case:** an all-white PNG made in the test page shows `ไม่พบโลโก้ในรูปนี้`.
- [ ] **Step 6: Commit**
  ```bash
  git commit -m "feat(settings): shop logo (owner) — trimmed and shrunk on the device, shown on receipts"
  ```

## Task 5: Service worker registers on app pages only

**Files:**
- Create: `src/components/pwa/register-service-worker.tsx`
- Modify: `next.config.ts` (Serwist options), `src/app/layout.tsx`

**Interfaces:**
- Consumes: Task 2 `shouldRegisterServiceWorker`.
- Produces: `export function RegisterServiceWorker(): null`, a client component.
  - One `useEffect` with `[]` deps: if `shouldRegisterServiceWorker(window.location.pathname)` and `window.serwist` exists, call `window.serwist.register().catch(() => {})`.
  - Serwist's `sw-entry` creates `window.serwist` in production builds only. Type it locally as `{ register(): Promise<unknown> } | undefined`; do not import `@serwist/next/react`.

- [ ] **Step 1: Config.** In `next.config.ts`, add `register: false` to `withSerwistInit`, with this comment:
  > Customer receipt pages (/r/) must not install the POS service worker. RegisterServiceWorker in the root layout registers it on every other page, the same as before.
- [ ] **Step 2: Mount it.** Write the component and render `<RegisterServiceWorker />` inside `<body>` of `src/app/layout.tsx`, next to `<Toaster />`.
- [ ] **Step 3: Verify.** Run `npx tsc --noEmit`, `npx eslint` on the changed files, and `npm run build`. The build log printing Serwist's "will not be automatically registered" info line is expected.
- [ ] **Step 4: Production check.** Stop `kidkubpos-dev` and start `kidkubpos-prod-local`. In the Browser pane:
  - **a. App pages still register.**
    1. On `http://localhost:3000/login`, first unregister every registration and delete every cache.
    2. Reload, and wait for load plus 3 s.
    3. `(await navigator.serviceWorker.getRegistration())?.active?.scriptURL` ends in `/sw.js`.
  - **b. The receipt page does not register.**
    1. Use a fresh origin, `http://127.0.0.1:3000/r/<cash ref>`. Clear registrations and caches there.
    2. Reload and wait 5 s.
    3. `await navigator.serviceWorker.getRegistration()` is `undefined`, and `await caches.keys()` is `[]`. The receipt still renders.
  - **c. Offline POS still works.**
    1. On localhost, sign in as the QA owner and open `/pos`.
    2. Wait until `(await caches.open("pos-shell")).match("/pos")` is truthy.
    3. Stop the server (`preview_stop`) and reload `/pos`.
    4. The POS product grid renders, not the `offline.html` text.
  - **d. An iPad that already has the service worker still gets updates.**
    1. Keep the registration from (c). Rebuild with `cmd /c "set VERCEL_GIT_COMMIT_SHA=qa-sw-2&& npm run build"`, which changes the chunk hashes.
    2. Start `kidkubpos-prod-local` and reload `/pos`.
    3. Within 15 s, `await caches.match([...document.scripts].map(s => s.src).find(s => s.includes("/_next/static/chunks/")))` is truthy.
  - Record every result in the report. Then rebuild normally (no env) and restart `kidkubpos-dev`.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "fix(pwa): register the service worker on app pages only, never on /r/ receipts"
  ```

## Task 6: QR in the POS cart after a sale (แบบ A)

**Files:**
- Create: `src/components/receipt/receipt-qr.tsx`
- Modify: `src/components/pos/pos-screen.tsx`, `src/components/pos/smart-cart.tsx`, `src/components/pos/offline-sale-result.tsx`

**Interfaces:**
- Consumes: Task 2 `receiptUrl`, `RECEIPT_QR_CAPTION`, `RECEIPT_QR_PENDING_NOTE`.
- Produces:
  - `export function ReceiptQr({ url, size, note }: { url: string; size: number; note?: string | null })`, a client component:
    - Draws `QRCode.toDataURL(url, { width: size, margin: 2, errorCorrectionLevel: "L" })` on the device, with the same superseded-run guard as `qr-payment-modal.tsx:44-58`.
    - Holds a fixed `size`×`size` box while drawing.
    - On error it renders **nothing**: no message, no box.
    - When drawn, it shows the image (`alt="QR ใบเสร็จ"`), then `RECEIPT_QR_CAPTION`, then `note` if given.
    - The root element carries `data-receipt-url={url}` for live checks. The QR encodes the same text anyway.
  - `SmartCart` gains the prop `receiptUrl: string | null`.
  - `OfflineSaleResult` gains the prop `receiptUrl?: string | null`.

- [ ] **Step 1: `ReceiptQr`.** Write the component.
- [ ] **Step 2: `pos-screen.tsx`.**
  - Add `const [lastReceiptRef, setLastReceiptRef] = useState<string | null>(null)`.
  - **Set it:**
    - In `applySuccess`, to the value `settledRef.current` gets (`attemptRef.current?.clientRef ?? null`). Read it before `attemptRef.current = null`.
    - In `showOfflineResult`, to `clientRef`.
  - **Reset it to null** at every other site that calls `setLastOrderNumber(null)`. Today those are around lines 746, 1229, 1414 and 1513.
  - **Pass `receiptUrl` to `SmartCart`:**
    - When `lastReceiptRef !== null && (lastOrderNumber !== null || lastOffline !== null) && typeof window !== "undefined"`, pass `receiptUrl(window.location.origin, lastReceiptRef)`.
    - Otherwise pass `null`.
  - The QR then shows exactly when the after-sale result shows:
    - online success, including paying a held bill
    - an uncertain bill that `checkOrderSaved` confirms while the cart is unchanged (it goes through `applySuccess`)
    - an offline sale

    It never shows after holding a bill, nor after the "cart has changed" notice.
- [ ] **Step 3: `smart-cart.tsx`.**
  - When `lastOrderNumber && receiptUrl`, render `<ReceiptQr url={receiptUrl} size={148} />` in the empty-cart block, centred, after the cash-tender box and before `แตะเมนูเพื่อเพิ่มลงตะกร้า`.
  - Pass `receiptUrl` through to `OfflineSaleResult` when `lastOffline` is set.
- [ ] **Step 4: `offline-sale-result.tsx`.** When `receiptUrl` is set, render `<ReceiptQr url={receiptUrl} size={148} note={sent ? null : RECEIPT_QR_PENDING_NOTE} />` at the bottom of the card.
- [ ] **Step 5: Verify.** Run `npx tsc --noEmit`, `npx eslint` on the changed files, and `npm test`.
- [ ] **Step 6: Live check on the dev server, QA tenant, Browser pane at 1180×740.**
  - For each sale, compare `data-receipt-url` with the new order's `client_ref`. Find it by `order_number` via `execute_sql`.
  - **Cash sale:**
    - The QR sits under the cash box. Opening its URL in a new tab shows that bill's receipt, with the QA logo if Task 4 left one; it is fine either way.
    - The cart scroll container has `scrollHeight <= clientHeight`. If it doesn't, cut the empty-state padding and margins (P-6), never the QR below 120 px.
    - Take a screenshot.
  - **Transfer sale:** the QR shows.
  - **Paying a held bill:** the QR shows.
  - **Holding a bill:** no QR.
  - **Tapping a menu after a sale:** the QR goes away together with the queue number.
  - **Uncertain bill:** start `kidkubpos-dev-delay`, where createOrder waits 60 s. Pay, let it end without an answer, and let `checkOrderSaved` confirm it. The normal result shows, with the QR.
  - **Offline sale:** use the method in `qa-c2.md`.
    - The card shows the QR and `เปิดได้หลังบิลขึ้นระบบ`.
    - The cart still has `scrollHeight <= clientHeight` (Review Focus 5). Take a screenshot.
    - Opening the URL before sync gives the not-found message.
    - After the bill is sent, the note goes away and the URL shows the receipt.
- [ ] **Step 7: Commit**
  ```bash
  git commit -m "feat(pos): receipt QR shows in the cart after every paid bill (online and offline)"
  ```

## Task 7: "QR ใบเสร็จ" on the bill history page

**Files:**
- Create: `src/components/orders/receipt-qr-button.tsx`
- Modify: `src/app/(shell)/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 2 `receiptUrl`; Task 6 `ReceiptQr`.
- Produces: `export function ReceiptQrButton({ clientRef, orderLabel }: { clientRef: string; orderLabel: string })`, a client component.
  - **The button:** full width, outlined, ≥ 48 px tall, with the lucide `QrCode` icon and the text `QR ใบเสร็จ`.
  - **The dialog** follows the `ConfirmDialog` pattern (`src/components/ui/confirm-dialog.tsx`): a fixed overlay where a backdrop tap (`e.target === e.currentTarget`) closes it. It contains:
    - the title `QR ใบเสร็จ`
    - `orderLabel`
    - `<ReceiptQr url={receiptUrl(window.location.origin, clientRef)} size={296} />`
    - a `ปิด` button, 48 px tall
  - Escape also closes it.

- [ ] **Step 1: The button.** Write `ReceiptQrButton`.
- [ ] **Step 2: The page.**
  - Add `client_ref` to `ORDER_SELECT`, and `client_ref: string | null` to `OrderDetail`.
  - Render `<ReceiptQrButton clientRef={order.client_ref} orderLabel={order.order_number ?? ""} />` directly under the header block, for **every status**, only when `order.client_ref !== null` (P-7).
  - If selecting `client_ref` raises 42501, stop and report NEEDS_CONTEXT. Do not change grants.
- [ ] **Step 3: Verify.** Run `npx tsc --noEmit` and `npx eslint` on the changed files.
- [ ] **Step 4: Live check at 1180×740, as the QA owner and then as QA staff.**
  - The cash and unpaid bills both show the button.
  - The QR's `data-receipt-url` matches the bill's `client_ref`.
  - A backdrop tap closes the dialog, and so does `ปิด`.
  - The seeded bill whose `client_ref` is null has no button.
  - Take a screenshot.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(orders): show a bill's receipt QR again from bill history"
  ```

## Task 8: End-to-end on a production build, then clean up

**Files:** none in the repo. Results go in the ledger and the report.

- [ ] **Step 1: Run the checks.** `npm test`, `npx tsc --noEmit`, `npx eslint` on every file changed in Tasks 2–7, and `npm run build`. All must pass.
- [ ] **Step 2: Walk spec §8 "live" on `kidkubpos-prod-local`** with the QA tenant and its logo, at iPad 1180×740 for POS and Settings, and 375×812 for the receipt.
  - **Cash and transfer sales:** the QR shows by itself, and the link opens without login, showing the logo.
  - **Cancel and refund** from history: the link changes its message.
  - **Mark the transfer unpaid:** the unpaid notice shows. **Then mark it paid again** ("เจอเงินแล้ว"): the full receipt comes back.
  - **A transfer not yet verified:** the normal receipt, with no note.
  - **Offline sale:** "ยังไม่พบ" before sync, the receipt after.
  - **Reopen from history:** works.
  - **Logo:** change it, then remove it. The receipt follows each time.
  - **Signed-in iPad tab:** no redirect.
  - **Service worker:** not registered on `/r/…` at a fresh origin.
  - **POS offline:** still opens with the server stopped.
- [ ] **Step 3: Clean up.**
  - Remove the QA tenant's storage files under `<qa tenant id>/`. Use the admin client storage API from a scratchpad node script. Direct SQL deletes on `storage.objects` are not used.
  - Delete the QA tenant with `execute_sql`, guarded by `name like 'QA QR%'`, in the purge order of `qa-d2a-setup.cjs`'s cleanup. Delete its auth users.
  - Confirm with count queries:
    - nothing named `QA QR%` remains
    - no storage objects remain under that tenant id
    - the order count of "The Connect Brew&Bar" is unchanged from before Task 3
  - Confirm `public/qa-logo-test.png` does not exist.
- [ ] **Step 4: Write the owner's iPad checklist into the report, in Thai,** for after the push:
  - Refresh every POS tab once.
  - **ตั้งค่า → ข้อมูลร้านค้า → โลโก้ร้าน:** choose the logo file the owner already has. The preview must be trimmed with no wide white margin. Then save.
  - Sell one cash cup. A QR shows; scan it with a real phone, and the receipt opens with the logo.
  - Sell one transfer cup and scan it.
  - Turn Wi-Fi off and refresh the POS page. It must still open.
  - Sell one cup offline, then scan it after Wi-Fi is back.
  - Open the same QR from ประวัติบิล.
