# Round C2 — Selling While Offline (ความเสถียร รอบ C2)

Status: draft for the user's review · 2026-11-05
Follows: round C1 (reliable payments). It shipped 2026-11-05 (3d7091d) and passed the user's localhost and iPad tests. The Vercel region moved to sin1 the same day (24610ac).

## Why

The shop's internet sometimes drops. The user wants two things when it does:

1. **The POS keeps selling.** Bills are kept on the iPad and sent to the system by themselves when the connection is back.
2. **Staff see it right away.** A warning banner tells them the internet is down, so they can tell the manager, who can fix the problem on site as fast as possible.

The user's earlier words still hold: staff should find it as easy as possible, and a sale must never be lost.

The approved mockup has four screens, in event order: offline and still selling, a sale finished offline, sending when back online, and the update bar. It was approved as shown ("ชัดเจนดีครับ ตามภาพแบบนี้ดีเยี่ยมเลย"). File: `.superpowers/brainstorm/1453-1792732546/content/offline-states.html`.

The user skipped the clarifying questions ("เริ่มเขียนแผนได้เลยครับผม อนุมัติ แต่ทำโดยละเอียดรอบคอบครับ"). Everything below that isn't in the C1 spec's C2 outline or the mockup is **Claude's call**, listed under "Claude's calls" at the end so the user can check them.

## What recon found (2026-11-05, code reading)

**A live bug, today, in production.** `@serwist/next` defaults `reloadOnOnline` to `true`, and `next.config.ts` doesn't turn it off. The built `main` bundle contains `window.addEventListener("online", () => location.reload())`.
- So whenever the iPad's Wi-Fi comes back, the POS page reloads itself. That wipes the cart in progress and C1's "check before paying again" warning, which lives only in React state.
- On localhost it never shows, because Serwist is disabled in development. That is why the user's C1 test there passed.
- This breaks C1's anti-goal "an automatic reload that wipes a cart in progress", and C2 cannot work with it on.

**The POS page cannot open offline today.**
- The service worker caches navigations under defaultCache's catch-all `others` rule. That rule is NetworkFirst with no timeout and a 24-hour expiry, and it doesn't refuse redirected responses.
- So reopening Safari offline either:
  - fails, if more than 24 hours have passed, or
  - hangs on a "Wi-Fi without internet" connection, or
  - could serve a cached `/login` page under `/pos`, if a redirect was ever cached.
- The cached page also carries whatever shift and held-bill state it had when it was cached.

**How the POS knows things today.**
- The `/pos` server page loads these once:
  - products, categories and modifiers
  - the open shift id
  - held bills
  - the PromptPay ID
- The heartbeat (`/api/heartbeat`, every 30 s, NetworkOnly in the service worker) returns `{version, promptpayId}`.

**Queue numbers** come from `next_queue_number`: one counter per tenant per Bangkok business date in `tenant_queue_counters`.
- Holding a bill also takes a number.
- Order numbers come from `generate_order_number` (`tenants.order_sequence`).

**Bills are written by `order_create`** (C1). It:
- attaches the bill to whatever shift is open at the moment it runs
- stamps `created_at = now()`
- takes the actor from the session

All three are wrong for a bill sold 40 minutes earlier while offline.

**The actor is the session user.** Manager and Staff get their own Supabase session through `switchToMember`, which is a server round trip. So nobody can switch user while offline.

**Order items.** `order_items.product_id` is NOT NULL, with an FK to `products`.

**Audit log.** `order_adjustments` is the existing append-only audit log for bill changes. Its kinds today are `payment_method_change`, `mark_unpaid` and `restore_paid`.

## Goals (C2)

1. **Fix the live reload bug first.** The page must never reload by itself when the connection comes back. The only reloads left are C1's idle-only auto-reload for a new version, and the cashier's own tap.

2. **Selling continues offline.**
   - Menu, cart, modifiers, notes, order type, cash (only if a shift is known to be open) and transfer (QR drawn on the device, as in C1) all work as normal.
   - A sale finished offline:
     - is stored on the iPad straight away
     - gets its **queue number on the spot**
     - clears the cart
     - shows the mockup's confirmation: "คิว 12 · บันทึกไว้ในเครื่องแล้ว ✓ · รอส่งขึ้นระบบเมื่อเน็ตกลับมา · เลขบิลจะได้หลังส่งขึ้นระบบ"
   - For cash it also shows the change, as it does online.

3. **Red bar while offline**, replacing C1's wording:
   > ⚠ เน็ตหลุด — บิลจะถูกเก็บไว้ในเครื่องก่อน · แจ้งผู้จัดการ · ค้างส่ง N บิล

   It stays up as long as the connection is down. It uses the same "no crying wolf" rules as C1: two failed checks in a row, or the browser itself reporting offline.

4. **What needs the server is disabled offline, each with its reason** in the same greyed style as the mockup ("— ใช้ไม่ได้ตอนเน็ตหลุด"):
   - discounts that need a manager PIN
   - holding a bill, or opening a held bill from the list
   - looking up or attaching a member
   - open shift, close shift and cash in/out
   - void and refund
   - switching user
   - going to other pages of the app

   Discounts under the PIN threshold still work. A held bill that was already open in the cart when the connection dropped can still be paid.

5. **Pending bills survive.** A reload, closing Safari, the iPad sleeping, or the battery dying must not lose them.
   - They never expire.
   - They are tied to the shop (tenant) and the seller who made them.

6. **The POS opens offline.** If the iPad reloads or reopens Safari while the internet is down, the POS page still opens, from the service worker, and selling works.
   - It uses the last known menu.
   - It uses the most recent shift, queue and PromptPay information the device has seen.
   - A page that has never been opened on this device cannot open offline. That is acceptable.

7. **Sending when the connection is back** works by itself, with nothing to tap:
   - The yellow bar shows "⟳ เน็ตกลับมาแล้ว — กำลังส่งบิลขึ้นระบบ… 2 / 4".
   - Then the green bar shows "✓ ส่งบิลครบแล้ว 4 บิล", which hides itself after 5 seconds.
   - Bills are sent oldest first.
   - Selling continues while they send.
   - Each bill is recorded with:
     - **its real sale time** (`created_at` is the time it was sold, not the time it was sent)
     - **its seller**
     - **the queue number the customer was given**
     - **the shift that was open when it was sold**
   - Its order number (KK.xxx) is given when it arrives.

8. **A bill the server refuses is never dropped.**
   - It stays on the iPad and is listed for the manager to review: "บิลส่งไม่ผ่าน N บิล · ให้ผู้จัดการตรวจ".
   - Reasons include:
     - a menu price changed while offline
     - a menu was turned off
     - a held bill was changed elsewhere
     - the cash bill's shift was closed on another device
   - The review shows, for each bill:
     - time, queue number, items, amount charged and payment method
     - the reason, in plain Thai
   - The manager can **record it as charged** with a manager PIN, so the money actually taken is what gets recorded.
   - The refused bills don't block the others from sending.
   - Sending a bill again is always safe: same `client_ref`, so it never creates a second bill.

9. **A shift cannot be closed while bills are still waiting to be sent**, or waiting for review, on this device. The close button is disabled with the reason and the count.

10. **The bill history marks offline bills** with a small "ขายตอนเน็ตหลุด" label, so the owner can tell them apart.

11. **The C1 "no answer" case can use the same queue.** When an online payment gets no answer after 15 s, the payment window offers **บันทึกไว้ในเครื่อง** next to ลองอีกครั้ง.
    - That turns the attempt into a pending bill with its existing `client_ref`, so the customer isn't kept waiting.
    - If the server had in fact saved it, sending it later just returns that bill.

## Non-goals (C2)

- More than one selling device per shop (unchanged from C1). Two POS screens selling offline at the same time could hand out the same queue number.
- Printers and receipts.
- Selling on a device that has never opened the POS while online.
- Offline work on any page other than the POS.
- Voids, refunds, held bills, shift changes or member lookups while offline.
- Round D stock work. Deduction for a sent bill stays best-effort, run once when the bill is created on the server.

## Anti-goals (would make C2 a failure even if it "works")

- Any path that loses a bill the customer paid for: a reload, a crash mid-send, a refused bill, a logout, or another shop signing in on the same iPad.
- Any path where one payment becomes two bills, including a bill re-sent after a lost response, or sent from two open tabs.
- A pending bill recorded under the wrong shop, the wrong shift or the wrong day's queue.
- An automatic reload that wipes a cart, a result on screen, or the pending list.
- The red bar crying wolf (C1's rule), or the yellow/green bars flickering.
- Weakening a security rule. These stay:
  - server re-pricing
  - manager PIN for large discounts
  - cash needs an open shift
  - tenant isolation

  The only new exception is "record as charged", and it needs a verified manager PIN and is logged.
- Breaking the deployed app while migrations are applied (one shared database).

## Constraints

- **Stack and docs.** Next.js 16 App Router (read `node_modules/next/dist/docs/` before using an API), Supabase, Tailwind v4, Serwist 9.5 (`@serwist/next`).
  - Don't add new runtime dependencies for storage. Use IndexedDB directly, through a small wrapper.
- **One database for dev and production.** A migration is live the moment it is applied.
  - Each migration must work with the code deployed at that moment.
  - Use the two-phase pattern: additive while developing; anything restrictive (dropping the old function, tightening grants) in a second migration applied only after the deploy.
- **No function overloads.** Never add a second signature under an existing function name: PostgREST named-argument calls become ambiguous, which is a past production bug in this project. A changed signature gets a new function name, and the old one is dropped in phase two.
- **Database functions follow the established pattern.** plpgsql, SECURITY INVOKER, EXECUTE revoked from public, anon and authenticated, granted to service_role, and called from server actions through the admin client.
- **Security rules stay** (see the anti-goals). Re-pricing still happens on the server when a pending bill is sent: device prices are never trusted, except through the manager-PIN "record as charged" path.
- **Tests.**
  - DB tests are rolled-back DO blocks (`supabase/tests/*.sql`, ending with `raise exception 'RESULT %'`).
  - Unit tests use `node --test`, and the modules they cover use relative `.ts` imports, not `@/`.
  - The pure rules (queue assignment, business date, retry vs refuse, send order, what is disabled offline) live in such modules and are unit-tested.
- **Testing offline for real.** The service worker is disabled in `npm run dev`, so offline behaviour must be verified on a production build served locally (`npm run build` + `npm start`). Stopping that local server is how the page loses its server; restarting it brings the connection back.
  - Use disposable QA tenants only. Delete them afterwards. Never touch "The Connect Brew&Bar".
  - Verify the UI in the Browser pane at 1180×740.
- **After the push**, check that a Vercel deployment actually started.

## Decided

**By the user**
- Offline selling with a visible "internet down" warning so staff tell the manager (2026-10-23).
- **Shifts are closed only on the POS iPad** (2026-11-05: "ปิดกะที่ iPad เครื่อง POS เท่านั้นครับ").
  - So blocking the close button on that device (goal 9) is enough. The server does not need to learn about pending bills.
  - The rare case of a shift closed elsewhere is still covered by review: see Claude's call 5.
  - The user confirmed the reload fix on localhost. With items in the cart, dropping and restoring the connection keeps the cart. A manual refresh still empties it.
- The four mockup screens, approved as shown.
- One POS device per shop. Printers come later. No receipts for now.
- Back-up decisions are put off until the POS is finished, before going live (2026-11-05).

**From the C1 spec's C2 outline** (approved direction)
- `client_ref` is the offline bill's identity.
- The one-step save is what sending uses.
- The queue number is given on the device; the order number comes on sync.
- The sale is recorded with its real time.
- Pending bills survive reloads and never expire.
- Sending is automatic and oldest first, with yellow then green bars, and selling continues during it.
- A refused bill is kept and listed for the manager, never dropped.
- A shift cannot be closed while bills are waiting.

## Claude's calls (the user can change these)

1. **One path for every sale: the device's outbox.** Every payment attempt is written to an outbox on the iPad (IndexedDB) before it is sent. What happens next depends on how the sale was made.
   - **An online sale (C1 flow)** has its entry kept only as a crash backup, in the state *attempt*. While the cashier is at the payment window, C1's behaviour is unchanged:
     - **Success:** the entry is removed.
     - **A definite refusal** (wrong PIN, cash under the total, a menu that no longer exists): the problem goes back to the cart, as today, and the entry is removed. It never goes to manager review.
     - **No answer, then the cashier closes the window:** C1's check runs. Saved means success. Not saved means the cart comes back and the entry is removed.
     - **The check itself gets no answer:** the entry stays in the state *check-only*. That is C1's "unresolved" warning, now kept across reloads. The sender only ever *asks* whether a check-only entry was saved; it never sends it. C1's rule still holds: it is checked again before the next payment.
   - **A bill becomes final**, meaning it will be sent no matter what, only in two cases:
     - it was sold in device-numbered mode (offline, or with bills still waiting), or
     - the cashier tapped **บันทึกไว้ในเครื่อง**.
   - A final bill leaves the outbox only when the server confirms it (created or replayed), or when "record as charged" succeeds. A crash mid-send can't lose it.
   - Any app tab that sends a final bill uses its `client_ref`, so two tabs can never make two bills.

2. **"Device-numbered mode"** applies when the connection is down **or** the outbox still holds bills.
   - In this mode:
     - sales take a device queue number and go straight into the outbox
     - the features that need the server (goal 4) stay disabled, until the outbox is empty and the connection is back
   - Sending normally takes seconds once the connection returns.
   - This stops a held bill or a new online sale from getting a server number that clashes with a pending bill's number.
   - **Bills waiting for manager review don't keep this mode on.** One refused bill must not switch off holding or shift close for days. Instead, when a bill is refused, the device asks the server to raise that day's counter to at least the bill's queue number (a small, separate call). Later server numbers then can't clash with it.

3. **Device queue numbers** are "last known number for today + 1".
   - "Last known" is the highest of:
     - today's counter, from the heartbeat
     - every queue number the server returns to this device
     - every number the device has itself handed out
   - It is kept per Bangkok business date, and it resets at Bangkok midnight on the device.
   - When the bill is sent, the server keeps the device's number and raises that day's counter to at least that number, so later online numbers continue above it. The day is the one of the sale time, not of the send time.

4. **Sale time.**
   - The device's clock gives `created_at`.
   - The server clamps a time more than 5 minutes in the future to `now()`.
   - It never refuses an old one: bills never expire.

5. **Shift of an offline sale.**
   - The device records the shift it believed was open at the moment of sale.
   - **Cash:** the bill must go to that shift, and that shift must still be open. Otherwise the bill is refused and goes to review.
     - In review, "record as charged" puts it in the shift that is open now. If none is open, it asks for a shift to be opened first.
   - **Transfer:** it goes to the recorded shift if that shift is still open. Otherwise it is saved with no shift. Transfers don't touch the cash drawer.

6. **Seller.**
   - The bill is recorded under the seller saved with it, not under whoever is signed in when it is sent.
   - The server only accepts a seller who is an active member of the same shop.
   - If that seller has been deactivated since, the bill goes to review with the reason "พนักงานที่ขายบิลนี้ถูกปิดใช้งานแล้ว". It is never retried forever.
     - "Record as charged" still records it under the original seller: the profile still exists, and the record must say who really sold it. The approving manager is logged.

6b. **A large discount never travels offline.**
   - The manager's PIN is never stored on the device.
   - So **บันทึกไว้ในเครื่อง** is not offered for an attempt whose discount needed a PIN. That attempt can still use ลองอีกครั้ง, or be cancelled.
   - Offline, PIN discounts are disabled anyway (goal 4).

7. **Shop guard.** Each pending bill stores its tenant id.
   - It is only sent while the signed-in user belongs to that tenant.
   - The server refuses a bill whose tenant doesn't match the session's tenant. The device treats that as "wait", not "refuse".
   - So if another shop ever signs in on the same iPad, nothing is sent to the wrong shop and nothing is deleted.

8. **Retry vs refuse.**
   - **Kept pending and retried:** connection failures, timeouts, server 5xx, signed out, wrong shop, "please refresh" (old tab).
   - **Moved to review:** price or menu changed, menu off, held bill stale, cash shift closed, discount now needs approval, seller deactivated.
   - These outcomes come back as machine-readable codes, not by matching Thai text.
   - Retries back off from 5 s to 1 minute and restart on every heartbeat success.
   - Sending pauses while a payment window is open, so it never competes with the cashier's own payment.

9. **"Record as charged".**
   - It is a manager PIN action in the review list.
   - The server records the bill with the device's prices and totals.
   - It also writes an `order_adjustments` row with a new kind, `offline_override`, containing:
     - the server's price total and the charged total
     - the reason
     - the approving manager

   If a product on the bill has since been **deleted** (not archived), the bill can't be recorded, because `order_items.product_id` is required. It stays in review with that reason. This is very rare: only menus never sold can be deleted.

10. **No "discard" button.** Nothing on the device can delete a pending or refused bill. A bill the customer didn't really pay for gets voided normally in the bill history after it has been recorded.

11. **Offline page opening.**
    - A dedicated service-worker rule for the `/pos` page: NetworkFirst with a short network timeout (about 4 s).
    - Its own cache, with no expiry.
    - It never stores a redirected or non-200 response.
    - Every online load refreshes it. Old-build chunks the cached page needs must stay available.
    - The heartbeat also returns:
      - the open shift id
      - today's last queue number
    - The device keeps the latest values it has seen of these and of the PromptPay ID. When the page opens offline, it prefers them over the cached page's own values whenever they are newer.

12. **Sending runs on the POS page.** The shifts page reads the outbox count only to block closing. Logging out with pending bills shows a warning first, but the bills stay on the device either way.

13. **Storage.** The app asks the browser for persistent storage (`navigator.storage.persist()`). Safari can evict site data that goes unused for weeks; a POS used every day is not at risk.

14. **The "ขายตอนเน็ตหลุด" label** needs a flag on `orders` (`sold_offline`, default false). It is set for every bill that went through device-numbered mode or the "บันทึกไว้ในเครื่อง" button.

16. **The cart in progress survives a reload too.**
    - The current cart is saved on the device as it changes: items, order type, payment method, attached member, the held bill loaded, and a discount that needs no PIN.
    - It comes back after a manual refresh, a crash or a reopened Safari, with a short note "กู้ตะกร้าที่ค้างไว้".
    - A PIN approval is never saved, so a large discount comes back needing approval again.
    - It is cleared when the sale completes, when the cart is cleared, and for a different shop or seller.
    - Why: offline, a dead battery or an accidental refresh mid-order would otherwise lose the order. Today a manual refresh empties the cart (confirmed by the user, 2026-11-05).

15. **Known limit: different queue number.** A bill saved with "บันทึกไว้ในเครื่อง" after a no-answer may turn out to have been saved by the server already, with a server queue number. The bill then keeps the server's number, and the device's number is shown next to it in the review summary. This is rare, and is accepted.

## Left to the builder

- The new database function's name and parameters (no overload of `order_create`), and the phase-two drop of `order_create`.
- How the outbox wrapper, the sender and the POS are split into files. `pos-screen.tsx` is already 934 lines; the new logic goes into its own modules and hooks.
- Where exactly the disabled reasons appear in the cart, header, sidebar and payment windows. Follow the mockup's style.
- How the review list opens: a button on the bar, or in the header.
- The exact retry timings within the bounds above.
- Task breakdown and order. The reload bug fix comes first.
