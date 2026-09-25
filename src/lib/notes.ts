// Per-cup note rules shared by the POS UI and createOrder.

export const QUICK_NOTES = ["ไม่ใส่หลอด", "แยกน้ำแข็ง", "น้ำแข็งน้อย", "ใส่แก้วลูกค้า"] as const;

/** Mirrors the order_items_note_length CHECK constraint. */
export const MAX_NOTE_LENGTH = 200;

function parts(current: string): string[] {
  return current
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
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
