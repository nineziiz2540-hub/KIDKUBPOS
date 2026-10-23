# Round C1 — Reliable Payments (ความเสถียร รอบ C1)

Status: draft for the user's review · 2026-10-23
Next: round C2 (selling while the shop's internet is down). It is outlined at the end and gets its own spec after C1 ships and passes the iPad test.

## Why

The owner runs an older POS today. Two things keep going wrong there, and KIDKUBPOS must not repeat them:

1. **The QR doesn't appear.** This happens on busy periods, or when the iPad has sat idle for 3–4 hours. Staff press โอน, nothing shows, and they clear the bill and retry 2–3 times while the customer waits.
2. **The order isn't saved.** Sometimes payment is pressed and no order is recorded. This is worse, because the sale silently disappears.

The goal of C1: **one tap on pay always ends clearly.** Either the QR shows or the bill is saved. If something fails, the screen says exactly what happened, and pressing again can never create a second bill.

The user's words: they want staff to be able to use it as easily as possible, and they never want to lose a sale.

## What recon found (2026-10-23, code reading — not yet reproduced live)

**QR modal** (`src/components/pos/qr-payment-modal.tsx`)
- Every open calls the server action `generatePaymentQr` just to fetch the shop's PromptPay ID.
- The call has no catch and no timeout. If it throws, the modal stays on "กำลังสร้าง QR…" forever, with no error and no retry. Causes include a network blip after the iPad wakes, a session refresh, or a deploy that happened while the tab was open.
- This matches the old POS symptom exactly.

**`createOrder`** (`src/app/actions/orders.ts`)
- It makes about 8 sequential database round trips:
  1. profile
  2. re-price
  3. held bill
  4. shift
  5. order number
  6. queue number
  7. order insert
  8. order_items insert, with a hand-written rollback if the items insert fails
- A connection drop part-way leaves the outcome unknown. Today the cashier is told "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบหน้ารายการบิลก่อนกดชำระซ้ำ" and must check the bill history by hand.
- There is no idempotency, so a retry after a lost response records the sale twice.
- No code path loses a bill silently: the catch exists, and the `mayHaveSaved` flag is honoured. The weaknesses are the unknown outcome and duplicates.

**Stale tabs**
- The POS is a single page that is never navigated, so it never reloads.
- After a deploy, the old tab keeps calling the new deployment's server actions. Its first tap can fail.

**Other gaps**
- There is no "internet is down" indicator anywhere.
- There are no unit tests for the money maths: `src/lib/cash.ts`, `src/lib/discount.ts`, `src/lib/order-pricing.ts` and the cart line maths inside `pos-screen.tsx`.

Before fixing, the builder reproduces the QR hang and the duplicate-on-retry live, on a QA tenant, so each fix is proven against the real failure.

## Goals (C1)

1. **The QR appears instantly, with no network.** The page loads the shop's PromptPay ID once, and the QR is drawn on the iPad.
   - If the shop has no PromptPay ID, the modal shows the existing message ("ร้านยังไม่ได้ตั้งค่า PromptPay ID…") right away, never a spinner.
2. **A bill is saved in one step.**
   - The order row, its items, its order number and queue number, the shift link and the held-bill close-out are written in one database transaction. All of it is saved, or none of it.
   - No hand-written rollback remains.
3. **A retry can never create a second bill.**
   - Every payment attempt carries a client-generated id (`client_ref`, a UUID).
   - Sending the same `client_ref` again returns the bill that already exists (same order number, same queue number) instead of creating a new one.
   - Stock is deducted only when the bill is newly created, never on a replay.
4. **The cashier is never left guessing.** When a payment attempt fails because of the connection:
   - The payment window stays open with a clear message and a **ลองอีกครั้ง** button. It resends the same `client_ref`, so it is always safe.
   - If the cashier closes the window instead, the system checks by `client_ref` whether the bill was saved. If it was, the screen shows the normal success state and clears the cart. If not, the cart is kept for another try.
   - If the check itself can't reach the server, the cart is kept and the "check the bill history" warning is shown. That is today's behaviour, now only the last resort.
   - The cashier is no longer told to go and check the bill history in the normal case.
5. **"Internet is down" banner** on the POS. A red bar, visible as long as the connection is down. Wording for C1, where offline selling does not exist yet:
   > ⚠ เน็ตหลุด — ยังชำระเงินไม่ได้ชั่วคราว · แจ้งผู้จัดการ
   - It disappears when the connection is back.
   - Detection must catch "Wi-Fi connected but no internet", which `navigator.onLine` alone does not.
6. **"New version" banner** on the POS.
   - When a newer deployment is live, a bar shows: ระบบมีอัปเดตใหม่ · แตะเพื่อรีเฟรช.
   - If the cart is empty and no payment window is open, the page reloads itself instead.
   - It never reloads while there are items in the cart.
7. **Money maths covered by automated tests.** These tests run in `npm test`:
   - cart line totals with modifiers and quantity
   - discount (percent and amount, rounding, the approval threshold)
   - change and cash validation
   - server re-pricing
8. **Background items**
   - **Vercel auto-deploy.** Find out why a push to `main` did not start a deployment (2026-10-22), and fix it so pushes deploy by themselves. If the fix needs the owner to click something in the Vercel or GitHub dashboard, give exact steps.
   - **Supabase backups.** Find out what backup and restore the FREE plan actually offers for project `khgahdjfkzpgsvbhfrqx`. Report the options and a recommendation to the user in plain Thai. Doing any paid upgrade, or setting up an external backup job, is the user's decision and is not part of C1.
   - **Round B deferred minor, fixed by goal 2.** A transfer sale is refused with "กะถูกปิดไปแล้ว" if the shift closes between the check and the insert. The one-step save resolves the shift inside the transaction, so this race goes away. Verify it.

## Non-goals (C1)

- Selling while offline: that is C2.
- Printers and receipts: there are no printers yet, and none are planned to be bought soon. The shop will run on QR payment without receipts for now.
- More than one selling device per shop. The design assumes **one POS device per shop**; future shops get one POS plus 2 printers each.
- Changing the discount, held-bill, void or refund rules.
- Round D stock work: deduction stays best-effort, as today.
- Locking down direct `orders` inserts through the Data API. The existing guards stay as they are.

## Anti-goals (would make C1 a failure even if it "works")

- Any path where a bill the customer paid for is silently lost.
- Any path where one payment becomes two bills.
- An automatic reload that wipes a cart in progress.
- A banner that cries wolf: shown while the internet is fine, or flickering on a single slow request.
- Breaking the deployed production app while migrations are applied. Dev and production share one database.

## Constraints

- **Stack and docs.** Next.js 16 App Router (read `node_modules/next/dist/docs/` before using an API), Supabase, Tailwind v4.
- **One database for dev and production** (`khgahdjfkzpgsvbhfrqx`). A migration is live the moment it is applied.
  - Each migration must work with the code that is deployed at that moment.
  - Use the two-phase pattern: an additive migration while developing; anything restrictive goes in a second migration applied only after the deploy.
- **Database functions follow the round B shift-function pattern.** These are plpgsql, SECURITY INVOKER, with EXECUTE revoked from public, anon and authenticated, and granted only to service_role. Server actions call them through the admin client.
- **Security rules stay as they are:**
  - server-side re-pricing (client prices are never trusted)
  - manager-PIN approval for large discounts
  - held-bill version check
  - cash needs an open shift (`guard_order_drawer` stays SECURITY DEFINER)
  - tenant isolation
- **Tests.** DB tests are rolled-back DO blocks (`supabase/tests/*.sql`, ending with `raise exception 'RESULT %'`). Unit tests use `node --test`, and the modules they cover must not use `@/` imports.
- **Testing on real data.** Test only on disposable QA tenants and delete them afterwards. Never touch the real tenant "The Connect Brew&Bar".
- **UI.** Verify live in the Browser pane at 1180×740 (iPad Air 5 landscape). Thai copy throughout, short and plain.
- **After the push**, check that a Vercel deployment actually started.

## Decided

**By the user**
- Order of work: C1 first. It gets a detailed review, then a push, then the user's iPad test. C2 starts only if that test finds nothing.
- C2 is offline selling with a visible "internet down" warning, so staff tell the manager quickly. The four C2 screens in the mockup were approved as shown (`.superpowers/brainstorm/1453-1792732546/content/offline-states.html`).
- One POS device per shop. Printers come later.

**Claude's calls in C1** (the user can change these)
- The PromptPay ID is sent to every role's POS page. It is not secret: it is encoded in every QR a customer scans.
- The QR confirm failure behaves like the cash modal: the window stays open and offers a retry with the same `client_ref`.
- The `client_ref` lives for one payment attempt of one cart. A new one starts if the cart, the discount or the payment method changes, or after a success. It survives retries of the same attempt.
- The update banner shows on the POS page only. Other pages navigate normally and pick up new versions as they do today.
- `orders.client_ref` is nullable, so older bills and today's deployed code keep working. It is unique per tenant when present.

**Claude's calls after the builder check** (the user can change these)
- **Replay comes first.** `createOrder` looks up `client_ref` before every other check: held-bill version, open shift, PIN. If a bill with that `client_ref` exists for the tenant, it returns that bill as-is. A replay must succeed even when the held bill is now `paid` or the shift has since closed.
  - Voided or refunded bills are returned as-is too: the payment happened, and the retry comes seconds later.
  - Two concurrent first attempts with the same `client_ref` must still produce one bill. The unique index plus the function's handling of the conflict guarantees this.
- **Stock deduction stays outside the transaction**, best-effort as today. A crash between the commit and the deduction can miss one deduction. This is accepted and logged; reliable deduction is round D.
- **The PromptPay ID is re-read with the periodic version and connection check**, and whenever the tab becomes visible again. A long-open POS tab therefore cannot keep drawing QRs to an account the owner has since changed in Settings. The check uses the last value it got and never blocks the QR on the network.
- **Re-pricing tests.** Split the pure arithmetic in `src/lib/order-pricing.ts` away from its database lookups so it can be unit-tested, and remove `@/` value imports from the pure parts. Behaviour must stay identical, and the existing DB re-pricing protections must still hold. A live check shows that a tampered client price is still overridden.
- **Checking whether a bill was saved** works for every role. It covers both the cash and the QR windows, and is scoped to the caller's tenant: it only ever finds bills of the caller's own shop.
- **Auto-reload only when the POS is fully idle.** That means:
  - the cart is empty
  - no held bill is loaded
  - no dialog or window is open (payment, held-bill list, no-shift, PIN pad, modifiers, discount, note)
  - no payment attempt is in flight or unresolved

  Otherwise only the banner shows.
- **QA tenants** use the established QA flow (`project_pending_backlog` memory, section 8): insert an `auth.users` row, then `create_tenant_and_owner`, then the PIN hash, then the session cookie. Delete them afterwards. No signup or CAPTCHA is involved.
- **Deploy order.**
  1. Push.
  2. Confirm a Vercel deployment starts, or deploy that commit by hand as on 2026-10-22, if the auto-deploy fix isn't in effect yet or needs the owner's dashboard steps.
  3. Apply any restrictive migration only after that deploy is live.

  The additive migration (the `client_ref` column, its index and the function) goes on during development, and today's deployed code ignores it.

## Left to the builder

- The exact shape of the one-step database function: name, parameters, and how re-priced lines and the held-bill close-out are passed in. Re-pricing and PIN checks may stay in TypeScript, with only the writes moved into the function.
- How connectivity is detected: a light ping endpoint, request failures, interval, and debounce, as long as the anti-goal "no crying wolf" holds.
- How the new version is detected. For example, a build id baked into the client compared with a small version endpoint, checked on an interval, on `visibilitychange` and on `online`. Check what Vercel and Next 16 already provide (`deploymentId`, `VERCEL_DEPLOYMENT_ID`), and consider the service worker (`src/app/sw.ts`, Serwist `defaultCache`).
- Where the cart maths moves so it can be unit-tested. Keep behaviour identical.
- Task breakdown and order.

## Round C2 outline (for orientation — not built in C1)

The user approved this direction and its mockup. C1 should not make it harder:
- `client_ref` becomes the offline bill's identity.
- The one-step save becomes the sync endpoint.

**While offline**
- The red banner shows: "เน็ตหลุด — บิลจะถูกเก็บไว้ในเครื่องก่อน · แจ้งผู้จัดการ", plus the number of bills waiting to be sent.
- Selling continues, for cash (if a shift is open) and for transfer (QR drawn locally).
- Disabled while offline, each with the reason shown: discounts that need a PIN, hold or resume bill, void or refund, open or close shift.
- An offline sale gets its queue number immediately on the device. Its full order number comes when it syncs.
- It is recorded with the real sale time.
- Pending bills survive a reload or the iPad being closed, and never expire.

**When the connection is back**
- Bills are sent automatically and in order (yellow "sending 2/4", then green "all sent").
- Selling continues while they send.
- A bill the server refuses, for example because a menu price changed meanwhile, is kept and listed for the manager to review. It is never dropped.
- A shift cannot be closed while bills are still waiting to be sent.
