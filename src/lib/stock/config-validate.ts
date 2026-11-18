// Validation for the owner's stock setup pages (round D1). Pure; no I/O. Each function returns the
// first problem as a short Thai sentence in café words, or null when fine.
import { MAX_PRODUCT_PRICE } from "../product-input.ts";

export type GroupKind = "bean" | "matcha" | "sweetener" | "other";
export type MemberInput = { materialId: string; label: string; tier: "house" | "special"; priceDelta: number; isDefault: boolean };
export type LevelInput = { name: string; isNone: boolean; isDefault: boolean };
export const MAX_SWEETNESS_AMOUNT = 10000;

export function validateGroupMembers(kind: GroupKind, members: MemberInput[]): string | null {
  const seen = new Set<string>();
  let defaults = 0;
  for (const m of members) {
    if (m.label.trim() === "") return "ใส่ชื่อให้ครบทุกตัวเลือก";
    if (seen.has(m.materialId)) return "วัตถุดิบเดียวกันใส่ซ้ำไม่ได้";
    seen.add(m.materialId);
    if (m.isDefault) defaults += 1;
    if (!Number.isFinite(m.priceDelta) || m.priceDelta < 0 || m.priceDelta > MAX_PRODUCT_PRICE) {
      return `ราคาเพิ่มต้องอยู่ระหว่าง 0 ถึง ${MAX_PRODUCT_PRICE.toLocaleString("en-US")} บาท`;
    }
    if (Math.round(m.priceDelta * 100) / 100 !== m.priceDelta) return "ราคาเพิ่มใส่ได้ไม่เกิน 2 ตำแหน่งทศนิยม";
    if (m.tier === "house" && m.priceDelta !== 0) return "ตัวร้านไม่คิดราคาเพิ่ม ใส่ราคาเพิ่มได้เฉพาะตัวพิเศษ";
    if (kind === "sweetener" && m.tier === "special") return "สารให้ความหวานไม่มีตัวพิเศษ";
  }
  if (defaults > 1) return "ตั้งค่าเริ่มต้นได้แค่ 1 ตัว";
  return null;
}

export function validateSweetnessLevels(levels: LevelInput[]): string | null {
  const names = new Set<string>();
  let nones = 0;
  let defaults = 0;
  for (const l of levels) {
    const name = l.name.trim();
    if (name === "") return "ใส่ชื่อระดับความหวานให้ครบ";
    const key = name.toLowerCase();
    if (names.has(key)) return "ชื่อระดับความหวานซ้ำกัน";
    names.add(key);
    if (l.isNone) nones += 1;
    if (l.isDefault) defaults += 1;
  }
  if (nones > 1) return "ระดับ \"ไม่หวาน\" ตั้งได้แค่ 1 ระดับ";
  if (defaults > 1) return "ตั้งค่าเริ่มต้นได้แค่ 1 ระดับ";
  return null;
}

export function validateSweetnessAmount(amount: number): string | null {
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_SWEETNESS_AMOUNT) {
    return `ปริมาณต้องอยู่ระหว่าง 0 ถึง ${MAX_SWEETNESS_AMOUNT.toLocaleString("en-US")}`;
  }
  return null;
}
