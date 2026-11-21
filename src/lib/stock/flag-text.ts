// The owner's "ยอดน่าจะผิด" rows (round D2a): plain Thai text for each flag, with neutral words when a
// menu / material / person was later archived or removed. Free of "@/" imports so `node --test` loads it.
import { formatDate } from "../bangkok-time.ts";

export type FlagKind = "sold_while_out" | "stock_skipped";

export type FlagNames = {
  menu: string | null;
  material: string | null;
  person: string | null;
  orderNumber: string | null;
};

export const FLAG_HINT = "รับของเข้าหรือนับใหม่ให้ตรง";

/** The row's sentence and its hint (null when the row has none). The date is the Bangkok date of the flag. */
export function flagText(
  flag: { kind: string; created_at: string },
  names: FlagNames
): { text: string; hint: string | null } {
  if (flag.kind === "stock_skipped") {
    return { text: `หักสต๊อกไม่สำเร็จ · บิล ${names.orderNumber || "-"}`, hint: null };
  }
  const menu = names.menu || "เมนู";
  const material = names.material || "วัตถุดิบ";
  const person = names.person || "-";
  return {
    text: `ขาย${menu}ตอนระบบคิดว่า${material}หมด · ${formatDate(flag.created_at)} · โดย ${person}`,
    hint: FLAG_HINT,
  };
}
