// Pure rules of "บันทึกของเสีย" at the POS (round D2a, Task 11): what a waste request may hold, the words
// of its label and ledger reason, the quantity typed on the pad, and the Thai for an undo's error codes.
// No I/O and no framework imports, so node:test can run it. The server action re-parses everything the
// client sends; the client only uses this to know what to ask for.
import type { CartChoices } from "../../types/app.ts";
import { isValidCartChoices } from "../order-pricing-core.ts";
import { composeEntryQty, entryToBaseQty } from "./material-view.ts";

export const WASTE_REASONS = ["ทำหก", "ชงใหม่ให้ลูกค้า", "หมดอายุ/เสีย", "พนักงานดื่ม", "ชิม/จูนเครื่อง", "อื่น ๆ"] as const;
export const OTHER_REASON = "อื่น ๆ";

export type WasteInput =
  | {
      kind: "menu";
      productId: string;
      quantity: number;
      choices?: CartChoices;
      optionIds: string[];
      houseGlass?: boolean;
      reason: string;
      otherText?: string;
    }
  | { kind: "material"; materialId: string; qty: number; reason: string; otherText?: string };

export const ERR_REASON = "เลือกเหตุผล";
export const ERR_OTHER_TEXT = "พิมพ์เหตุผลสั้น ๆ";
export const ERR_QTY = "ใส่จำนวนให้ถูกต้อง";
const ERR_BAD = "ข้อมูลไม่ถูกต้อง";

const MAX_MENU_QTY = 20;
const MAX_MATERIAL_QTY = 100_000;
const MAX_OTHER_TEXT = 100;
const MAX_OPTION_IDS = 50;

function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function isId(v: unknown): v is string {
  return typeof v === "string" && v !== "" && v.length <= 100;
}

/** Checks one waste request; a bad one comes back as the Thai sentence to show. */
export function parseWasteInput(raw: unknown): { value: WasteInput } | { error: string } {
  if (!isObject(raw)) return { error: ERR_BAD };
  const { kind } = raw;
  if (kind !== "menu" && kind !== "material") return { error: ERR_BAD };

  let head: { kind: "menu"; productId: string; quantity: number; choices?: CartChoices; optionIds: string[]; houseGlass?: boolean } | { kind: "material"; materialId: string; qty: number };
  if (kind === "menu") {
    const { productId, quantity, choices, optionIds, houseGlass } = raw;
    if (!isId(productId)) return { error: ERR_BAD };
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_MENU_QTY) {
      return { error: ERR_QTY };
    }
    if (!Array.isArray(optionIds) || optionIds.length > MAX_OPTION_IDS || !optionIds.every(isId)) return { error: ERR_BAD };
    if (houseGlass !== undefined && typeof houseGlass !== "boolean") return { error: ERR_BAD };
    if (!isValidCartChoices(choices)) return { error: ERR_BAD };
    head = {
      kind: "menu",
      productId,
      quantity,
      ...(choices !== undefined ? { choices: choices as CartChoices } : {}),
      optionIds: [...optionIds],
      ...(houseGlass !== undefined ? { houseGlass } : {}),
    };
  } else {
    const { materialId, qty } = raw;
    if (!isId(materialId)) return { error: ERR_BAD };
    if (
      typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0 || qty > MAX_MATERIAL_QTY ||
      Math.round(qty * 1000) / 1000 !== qty
    ) {
      return { error: ERR_QTY };
    }
    head = { kind: "material", materialId, qty };
  }

  const { reason, otherText } = raw;
  if (typeof reason !== "string" || !(WASTE_REASONS as readonly string[]).includes(reason)) return { error: ERR_REASON };
  if (reason !== OTHER_REASON) return { value: { ...head, reason } };
  const text = typeof otherText === "string" ? otherText.trim() : "";
  if (text === "" || text.length > MAX_OTHER_TEXT) return { error: ERR_OTHER_TEXT };
  return { value: { ...head, reason, otherText: text } };
}

/** The words for the thing wasted: the menu with its picks ("ลาเต้ เคนยา"), or the material with its unit. */
export type WasteNames = { name: string; /** menu: the picked bean/matcha words */ parts?: string[]; /** material: its use unit */ unit?: string };

function numberText(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** "ลาเต้ เคนยา 1 แก้ว" or "นมโอ๊ต 200 ml". */
export function wasteLabel(input: WasteInput, names: WasteNames): string {
  if (input.kind === "menu") {
    return `${[names.name, ...(names.parts ?? [])].join(" ")} ${input.quantity} แก้ว`;
  }
  return `${names.name} ${numberText(input.qty)}${names.unit ? ` ${names.unit}` : ""}`;
}

/** The reason as the shop picked it: อื่น ๆ is replaced by what was typed. */
export function wasteReasonOf(input: WasteInput): string {
  return input.reason === OTHER_REASON && input.otherText ? input.otherText : input.reason;
}

/** What the stock history shows: "ทำหก · ลาเต้ เคนยา 1 แก้ว". */
export function wasteReasonText(input: WasteInput, label: string): string {
  return `${wasteReasonOf(input)} · ${label}`;
}

/**
 * The number pad + ¼ ½ ¾ → quantity in the material's use unit. "purchase" counts in the purchase unit
 * (ขวด…) and is multiplied by its size; with no purchase size, or in "use", the number is taken as typed.
 * null = nothing typed yet.
 */
export function wasteMaterialQty(
  pad: string,
  fraction: 0 | 0.25 | 0.5 | 0.75,
  unit: "purchase" | "use",
  purchaseSize: number | null
): number | null {
  return entryToBaseQty(composeEntryQty(pad, fraction), unit === "purchase" ? purchaseSize : null);
}

/** Plain Thai for stock_waste_undo's error codes (R-D2a-24c); never a raw code. */
export function wasteUndoErrorMessage(message: string | undefined): string {
  if (message) {
    if (message.includes("too_late")) return "เลยเวลาย้อนกลับแล้ว (10 นาที)";
    if (message.includes("forbidden")) return "ย้อนกลับได้เฉพาะคนที่บันทึก หรือผู้จัดการ";
    if (message.includes("already_undone")) return "ย้อนกลับไปแล้ว";
    if (message.includes("not_found")) return "ไม่พบรายการนี้";
  }
  return "ย้อนกลับไม่สำเร็จ ลองใหม่อีกครั้ง";
}

/** The most one material waste takes, in the use unit. */
export const WASTE_MAX_QTY = 100_000;

/** A material the waste list shows: names and units only, never a cost (spec §8). */
export type WasteMaterial = {
  id: string;
  name: string;
  unit: string;
  category: string;
  purchaseUnit: string | null;
  purchaseSize: number | null;
};

/** The material list grouped by category in name order, for the "วัตถุดิบ" tab. */
export function groupMaterials(materials: WasteMaterial[]): { category: string; items: WasteMaterial[] }[] {
  const byCat = new Map<string, WasteMaterial[]>();
  for (const m of materials) byCat.set(m.category, [...(byCat.get(m.category) ?? []), m]);
  return [...byCat.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "th"))
    .map(([category, items]) => ({ category, items: [...items].sort((a, b) => a.name.localeCompare(b.name, "th")) }));
}

export const NO_COUNTED_MATERIALS = "เมนูนี้ไม่มีวัตถุดิบที่นับสต๊อก ไม่ต้องบันทึก";

/**
 * A menu waste's lines, minus any whose material is untracked or archived: stock_waste skips those
 * silently, so without this a waste that writes nothing would still show a green "saved" toast.
 */
export function keepCountedLines<T extends { material_id: string }>(lines: T[], countedIds: Set<string>): T[] {
  return lines.filter((l) => countedIds.has(l.material_id));
}
