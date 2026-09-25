# Per-Item Notes (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the cashier attach a short note to any cart line (quick chips + free text), keep differently-noted cups on separate lines, store the note on `order_items`, and show it on the order detail page.

**Architecture:** A nullable `order_items.note` column (≤200 chars, DB CHECK). `CartItem` gains `note: string | null`. Shared note rules live in `src/lib/notes.ts`; one `NoteEditor` component is used by the modifier modal and a new `NoteModal` opened by tapping a cart line. The server validates and stores the note through the existing `priceCartItems` → `createOrder` path.

**Tech Stack:** Next.js 16 App Router (client components + server actions), Supabase Postgres, Tailwind v4. No unit-test framework in the repo: pure logic is checked with a Node `--experimental-strip-types` script; UI/server behaviour is verified live on a disposable QA tenant.

## Global Constraints

- Quick notes, exactly: `ไม่ใส่หลอด`, `แยกน้ำแข็ง`, `น้ำแข็งน้อย`, `ใส่แก้วลูกค้า`; chips toggle, multiple allowed, joined with `", "`.
- Max note length **200** characters (after trim), enforced in UI, server, and DB CHECK.
- Empty/whitespace note is stored as `null`.
- A direct product tap merges only into the line whose key is exactly `product.id` (no modifiers, no note). Adding a note to that line re-keys it to `${product.id}-${Date.now()}`.
- Touch sizing from POS UX round 2: interactive controls ≥ 40px tall, body text ≥ 16px.
- Test only on a disposable QA tenant; never touch the real tenant "The Connect Brew&Bar". Do not push without the user's explicit request.

---

### Task 1: DB column + shared note rules

**Files:**
- Create: `supabase/migrations/20260925170000_order_item_note.sql`
- Modify: `src/types/database.ts` (order_items Row/Insert/Update)
- Create: `src/lib/notes.ts`

**Interfaces:**
- Produces: `QUICK_NOTES: readonly string[]`, `MAX_NOTE_LENGTH = 200`, `normalizeNote(raw: unknown): { ok: true; note: string | null } | { ok: false }`, `toggleQuickNote(current: string, chip: string): string`, `hasQuickNote(current: string, chip: string): boolean`.

- [ ] **Step 1: Migration**

```sql
-- Free-text per-cup note ("ไม่ใส่หลอด", "ใส่แก้วลูกค้า", …) captured at the POS. Null when none.
alter table public.order_items
  add column note text,
  add constraint order_items_note_length check (note is null or char_length(note) <= 200);
```

Apply with Supabase `apply_migration` (name `order_item_note`), then add `note: string | null` (Row) and `note?: string | null` (Insert, Update) to `order_items` in `src/types/database.ts`.

- [ ] **Step 2: `src/lib/notes.ts`**

```ts
// Per-cup note rules shared by the POS UI and createOrder.

export const QUICK_NOTES = ["ไม่ใส่หลอด", "แยกน้ำแข็ง", "น้ำแข็งน้อย", "ใส่แก้วลูกค้า"] as const;

/** Mirrors the order_items_note_length CHECK constraint. */
export const MAX_NOTE_LENGTH = 200;

function parts(current: string): string[] {
  return current.split(",").map((p) => p.trim()).filter(Boolean);
}

export function hasQuickNote(current: string, chip: string): boolean {
  return parts(current).includes(chip);
}

/** Adds the chip if absent, removes it if present; keeps any free text the cashier typed. */
export function toggleQuickNote(current: string, chip: string): string {
  const list = parts(current);
  const next = list.includes(chip) ? list.filter((p) => p !== chip) : [...list, chip];
  return next.join(", ");
}

/** Server-side validation: undefined/null/blank → null; non-string or too long → rejected. */
export function normalizeNote(raw: unknown): { ok: true; note: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, note: null };
  if (trimmed.length > MAX_NOTE_LENGTH) return { ok: false };
  return { ok: true, note: trimmed };
}
```

- [ ] **Step 3: Check the pure functions** — copy `notes.ts` to the scratchpad and run a Node script asserting: `toggleQuickNote("", "ไม่ใส่หลอด") === "ไม่ใส่หลอด"`; toggling it again → `""`; `toggleQuickNote("หวานน้อย", "แยกน้ำแข็ง") === "หวานน้อย, แยกน้ำแข็ง"`; `normalizeNote("  ")` → `{ok:true,note:null}`; `normalizeNote("x".repeat(201))` → `{ok:false}`; `normalizeNote(5)` → `{ok:false}`; `normalizeNote(" a ")` → `{ok:true,note:"a"}`. Expected: all pass.

- [ ] **Step 4: Commit** — `feat(pos): order_items.note column and shared note rules`

---

### Task 2: Server stores the note

**Files:**
- Modify: `src/types/app.ts` (`CartItem.note`)
- Modify: `src/lib/order-pricing.ts` (validate + carry note)
- Modify: `src/app/actions/orders.ts` (write `note` on order_items)

**Interfaces:**
- Consumes: `normalizeNote` from Task 1.
- Produces: `CartItem.note: string | null`; `PricedLine.note: string | null`.

- [ ] **Step 1:** In `CartItem` add `note: string | null; // per-cup note, see src/lib/notes.ts`.
- [ ] **Step 2:** In `priceCartItems`, inside the per-item validation loop, run `normalizeNote(item.note)`; on `{ok:false}` return `{ error: "หมายเหตุไม่ถูกต้อง (ไม่เกิน 200 ตัวอักษร)" }`. Add `note: string | null` to `PricedLine` and set it from the normalized value when pushing the line.
- [ ] **Step 3:** In `createOrder`'s `orderItems` map add `note: line.note`.
- [ ] **Step 4:** Fix the two `CartItem` constructions so types pass: `pos-screen.tsx` `addDirectToCart` (`note: null`) and `modifier-modal.tsx` `handleAdd` (temporarily `note: null`; Task 3 wires the editor).
- [ ] **Step 5:** `npx tsc --noEmit -p .` and `npx eslint src` → clean (the pre-existing `<img>` warning only).
- [ ] **Step 6: Commit** — `feat(pos): validate and store per-item notes on orders`

---

### Task 3: Note UI (editor, modal, cart, order detail)

**Files:**
- Create: `src/components/pos/note-editor.tsx`
- Create: `src/components/pos/note-modal.tsx`
- Modify: `src/components/pos/modifier-modal.tsx`
- Modify: `src/components/pos/smart-cart.tsx`
- Modify: `src/components/pos/pos-screen.tsx`
- Modify: `src/app/(shell)/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `QUICK_NOTES`, `MAX_NOTE_LENGTH`, `toggleQuickNote`, `hasQuickNote`; `CartItem.note`.
- Produces: `NoteEditor({ value: string; onChange: (v: string) => void })`; `NoteModal({ itemName: string; initialNote: string; onSave: (note: string) => void; onCancel: () => void })`; SmartCart prop `onSetNote: (key: string, note: string) => void`.

- [ ] **Step 1: `note-editor.tsx`**

```tsx
"use client";
import { MAX_NOTE_LENGTH, QUICK_NOTES, hasQuickNote, toggleQuickNote } from "@/lib/notes";

type Props = { value: string; onChange: (value: string) => void };

/** Quick-note chips + free text, shared by the modifier modal and the cart's note modal. */
export function NoteEditor({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {QUICK_NOTES.map((chip) => {
          const active = hasQuickNote(value, chip);
          return (
            <button
              key={chip}
              type="button"
              onClick={() => onChange(toggleQuickNote(value, chip).slice(0, MAX_NOTE_LENGTH))}
              className={`h-10 px-4 rounded-full border text-base font-medium transition-colors ${
                active
                  ? "border-accent bg-accent text-white"
                  : "border-input bg-white text-sidebar hover:border-accent hover:text-accent"
              }`}
            >
              {chip}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={value}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(e) => onChange(e.target.value)}
        placeholder="หรือพิมพ์หมายเหตุเอง"
        aria-label="หมายเหตุ"
        className="w-full h-12 rounded-lg border border-input px-3 text-base"
      />
    </div>
  );
}
```

- [ ] **Step 2: `note-modal.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NoteEditor } from "./note-editor";

type Props = {
  itemName: string;
  initialNote: string;
  onSave: (note: string) => void;
  onCancel: () => void;
};

export function NoteModal({ itemName, initialNote, onSave, onCancel }: Props) {
  const [note, setNote] = useState(initialNote);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-4">
        <div>
          <h2 className="text-lg font-bold text-sidebar">หมายเหตุ</h2>
          <p className="text-base text-muted-foreground">{itemName}</p>
        </div>
        <NoteEditor value={note} onChange={setNote} />
        <div className="flex gap-2">
          {initialNote !== "" && (
            <Button
              type="button"
              onClick={() => onSave("")}
              className="h-12 px-4 bg-destructive/10 text-destructive text-base hover:bg-destructive/20"
            >
              ลบหมายเหตุ
            </Button>
          )}
          <Button
            type="button"
            onClick={onCancel}
            className="flex-1 h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => onSave(note)}
            className="flex-1 h-12 bg-accent hover:bg-accent/90 text-white text-base"
          >
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Modifier modal** — add `const [note, setNote] = useState("");`, render a "หมายเหตุ (ไม่บังคับ)" heading + `<NoteEditor value={note} onChange={setNote} />` after the modifier groups inside the scroll area, and in `handleAdd` set `note: note.trim() === "" ? null : note.trim()`.

- [ ] **Step 4: pos-screen `setItemNote`**

```tsx
  // A direct-tap line is keyed by product.id so repeat taps merge into it. Once it carries a note
  // it gets its own key, so the next plain tap starts a fresh, note-less line instead of silently
  // adding un-noted cups to a noted one.
  function setItemNote(key: string, rawNote: string) {
    const trimmed = rawNote.trim();
    const note = trimmed === "" ? null : trimmed;
    setCartItems((prev) =>
      prev.map((i) => {
        if (i.cartItemKey !== key) return i;
        const cartItemKey =
          note !== null && i.cartItemKey === i.productId
            ? `${i.productId}-${Date.now()}`
            : i.cartItemKey;
        return { ...i, note, cartItemKey };
      })
    );
  }
```

Pass `onSetNote={setItemNote}` to both `SmartCart` instances.

- [ ] **Step 5: SmartCart** — add prop `onSetNote`; state `const [noteKey, setNoteKey] = useState<string | null>(null)`; make the item's left text block a `<button type="button" onClick={() => setNoteKey(item.cartItemKey)} className="flex-1 min-w-0 text-left">`; under modifiers render the note when present:

```tsx
{item.note && (
  <p className="text-sm text-accent font-medium leading-snug mt-0.5 line-clamp-2">
    📝 {item.note}
  </p>
)}
{!item.note && (
  <p className="text-sm text-muted-foreground/70 mt-0.5">+ หมายเหตุ</p>
)}
```

and render the modal:

```tsx
{noteKey !== null && (() => {
  const item = cartItems.find((i) => i.cartItemKey === noteKey);
  if (!item) return null;
  return (
    <NoteModal
      itemName={item.name}
      initialNote={item.note ?? ""}
      onSave={(note) => {
        onSetNote(item.cartItemKey, note);
        setNoteKey(null);
      }}
      onCancel={() => setNoteKey(null)}
    />
  );
})()}
```

- [ ] **Step 6: Order detail** — select `order_items(id, product_name, unit_price, quantity, subtotal, modifiers_snapshot, note)`, extend `OrderItem` with `modifiers_snapshot: { option: string }[] | null; note: string | null`, and under the product name render modifiers (`text-xs text-muted-foreground`, options joined by ", ") and the note (`text-xs text-accent font-medium`, "📝 " prefix).

- [ ] **Step 7:** `npx tsc --noEmit -p .` + `npx eslint src` → clean.

- [ ] **Step 8: Commit** — `feat(pos): per-item notes with quick chips in cart and modifier modal`

---

### Task 4: Live verification (QA tenant, iPad 1180×740)

- [ ] Latte with modifier + chips "ไม่ใส่หลอด" + "แยกน้ำแข็ง" → cart shows 📝 note.
- [ ] Direct item: tap ชาไทย twice (qty 2, one line) → tap line → add "น้ำแข็งน้อย" → tap ชาไทย again → **two** lines (noted qty 2, plain qty 1).
- [ ] Edit and clear a note via the modal ("ลบหมายเหตุ").
- [ ] Pay cash → `order_items.note` correct per line, null for the plain line; order detail shows modifiers + notes.
- [ ] Direct server-action call with a 201-char note → rejected "หมายเหตุไม่ถูกต้อง"; nothing saved.
- [ ] Console clean in a fresh tab; delete the QA tenant.
