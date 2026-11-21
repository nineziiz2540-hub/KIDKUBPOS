// "ชุดภาชนะ" (packaging sets) and the shop's "ถุงหิ้ว" setting (round D2a, Task 8). Pure; no I/O.
// The owner page and the server actions share these: the client checks for instant feedback, the server
// checks again because it never trusts what a client sent. save_packaging_set / archive_packaging_set
// (migration 20261123130000) re-check everything in SQL; their error codes are mapped to Thai here.
import { toSatang } from "../cash.ts";
import { buildProductCost, type MaterialCost } from "./product-cost.ts";

export const MAX_PACKAGING_ITEMS = 20;
export const MAX_PACKAGING_QTY = 1000;
export const MAX_PACKAGING_NAME = 60;
export const MAX_BAGS_PER_CUPS = 20;
/** Materials of this category are listed first when picking a set's items. */
export const PACKAGING_CATEGORY = "บรรจุภัณฑ์";

export type PackagingItemDraft = { materialId: string; qty: string };
export type PackagingSetDraft = { name: string; items: PackagingItemDraft[] };
export type PackagingItem = { materialId: string; qty: number };
export type PackagingSetValue = { name: string; items: PackagingItem[] };

const NAME_REQUIRED = "ตั้งชื่อชุดภาชนะ";
const NAME_TOO_LONG = `ชื่อชุดภาชนะยาวเกิน ${MAX_PACKAGING_NAME} ตัวอักษร`;
const ITEMS_REQUIRED = "ใส่วัตถุดิบอย่างน้อย 1 อย่าง";
const DUPLICATE = "วัตถุดิบซ้ำกัน — รวมเป็นบรรทัดเดียว";
const QTY = "จำนวนต่อแก้วต้องมากกว่า 0 ไม่เกิน 1,000";
const QTY_DECIMALS = "จำนวนต่อแก้วใส่ทศนิยมได้ไม่เกิน 3 ตำแหน่ง";
const TOO_MANY = `ตั้งได้ไม่เกิน ${MAX_PACKAGING_ITEMS} บรรทัด`;
const PICK_MATERIAL = "เลือกวัตถุดิบให้ครบทุกบรรทัด หรือลบบรรทัดที่ไม่ใช้";
const BAD_INPUT = "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้า";
const BAGS_PER_CUPS = `1 ถุงต่อทุก N แก้ว: ใส่ N เป็นจำนวนเต็ม 1–${MAX_BAGS_PER_CUPS}`;

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** The set form → a set to save. A fully blank row is dropped; everything else must be complete. */
export function parsePackagingSetDraft(draft: unknown): { value: PackagingSetValue } | { error: string } {
  if (!draft || typeof draft !== "object") return { error: BAD_INPUT };
  const d = draft as Record<string, unknown>;
  if (typeof d.name !== "string" || !Array.isArray(d.items)) return { error: BAD_INPUT };

  const name = d.name.trim();
  if (name === "") return { error: NAME_REQUIRED };
  if ([...name].length > MAX_PACKAGING_NAME) return { error: NAME_TOO_LONG };

  const rows: { materialId: string; qty: string }[] = [];
  for (const raw of d.items as unknown[]) {
    if (!raw || typeof raw !== "object") return { error: BAD_INPUT };
    const r = raw as Record<string, unknown>;
    if (typeof r.materialId !== "string" || typeof r.qty !== "string") return { error: BAD_INPUT };
    const qty = r.qty.trim();
    if (r.materialId === "" && qty === "") continue; // a row the owner added but never filled
    rows.push({ materialId: r.materialId, qty });
  }
  if (rows.length === 0) return { error: ITEMS_REQUIRED };
  if (rows.length > MAX_PACKAGING_ITEMS) return { error: TOO_MANY };

  const items: PackagingItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.materialId === "") return { error: PICK_MATERIAL };
    if (!isId(row.materialId)) return { error: BAD_INPUT };
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(row.qty)) return { error: QTY };
    const qty = Number(row.qty);
    if (!(qty > 0 && qty <= MAX_PACKAGING_QTY)) return { error: QTY };
    if (Math.round(qty * 1000) / 1000 !== qty) return { error: QTY_DECIMALS };
    if (seen.has(row.materialId)) return { error: DUPLICATE };
    seen.add(row.materialId);
    items.push({ materialId: row.materialId, qty });
  }
  return { value: { name, items } };
}

/** save_packaging_set's p_name / p_items (the tenant is never sent: the database takes it from the session). */
export function packagingSetPayload(v: PackagingSetValue): { p_name: string; p_items: { material_id: string; qty: number }[] } {
  return { p_name: v.name, p_items: v.items.map((i) => ({ material_id: i.materialId, qty: i.qty })) };
}

/**
 * Cost of one cup's packaging at today's material costs, in satang (owner/manager pages only). An archived
 * material is skipped, as the till skips it; a material with no usable cost is named in missingMaterials.
 */
export function packagingSetCost(
  items: PackagingItem[],
  materials: { id: string; name: string; unit: string; costPerUnit: number; archived: boolean }[]
): { costSatang: number; missingMaterials: string[] } {
  const live = new Map<string, MaterialCost>();
  for (const m of materials) if (!m.archived) live.set(m.id, { name: m.name, unit: m.unit, costPerUnit: m.costPerUnit });
  const cost = buildProductCost("", items.filter((i) => live.has(i.materialId)), live);
  return { costSatang: toSatang(cost.ingredientCost), missingMaterials: cost.missingMaterials ?? [] };
}

/** Materials grouped by category for the item picker: "บรรจุภัณฑ์" first, then the others in first-seen order. */
export function packagingMaterialGroups<T extends { category: string }>(materials: T[]): { category: string; items: T[] }[] {
  const order = [...new Set(materials.map((m) => m.category))].sort((a, b) =>
    a === PACKAGING_CATEGORY ? -1 : b === PACKAGING_CATEGORY ? 1 : 0
  );
  return order.map((category) => ({ category, items: materials.filter((m) => m.category === category) }));
}

/**
 * A set's items by material name (Thai order), so the list reads the same after every save (the
 * database hands them back in id order). An item whose material has no name here goes last.
 */
export function sortSetItemsByName<T extends { materialId: string }>(items: T[], nameOf: (materialId: string) => string | undefined): T[] {
  return [...items].sort((a, b) => {
    const na = nameOf(a.materialId);
    const nb = nameOf(b.materialId);
    if (na === undefined || nb === undefined) return na === nb ? 0 : na === undefined ? 1 : -1;
    return na.localeCompare(nb, "th");
  });
}

// ── error codes of save_packaging_set / archive_packaging_set (migration 20261123130000) ─────────────

const RPC_ERRORS = {
  forbidden: "ไม่มีสิทธิ์ดำเนินการนี้",
  name_required: NAME_REQUIRED,
  name_too_long: NAME_TOO_LONG,
  items_required: ITEMS_REQUIRED,
  too_many_items: TOO_MANY,
  material_not_found: "ไม่พบวัตถุดิบนี้ หรือปิดใช้แล้ว — เลือกวัตถุดิบอื่น",
  invalid_qty: QTY,
  duplicate_material: DUPLICATE,
  set_not_found: "ไม่พบชุดภาชนะนี้ หรือถูกเก็บแล้ว — รีเฟรชหน้า",
  name_taken: "มีชุดภาชนะชื่อนี้แล้ว — ตั้งชื่ออื่น",
  set_in_use: "ชุดนี้ยังใช้อยู่ในเมนู — เปลี่ยนชุดภาชนะของเมนูก่อน แล้วค่อยเก็บเข้าคลัง",
} as const;

export const PACKAGING_RPC_CODES = Object.keys(RPC_ERRORS) as (keyof typeof RPC_ERRORS)[];

export function packagingRpcError(code: string | undefined): string {
  return code !== undefined && Object.hasOwn(RPC_ERRORS, code)
    ? RPC_ERRORS[code as keyof typeof RPC_ERRORS]
    : "บันทึกชุดภาชนะไม่สำเร็จ — ลองอีกครั้ง";
}

const IN_USE_NAMES_SHOWN = 6;

/** "เก็บเข้าคลัง" refused: "ใช้อยู่ในเมนู: ลาเต้, อเมริกาโน่" (a long list ends "และอีก N เมนู"). */
export function setInUseMessage(menuNames: string[]): string {
  if (menuNames.length === 0) return RPC_ERRORS.set_in_use;
  const shown = menuNames.slice(0, IN_USE_NAMES_SHOWN).join(", ");
  const more = menuNames.length - IN_USE_NAMES_SHOWN;
  return `ใช้อยู่ในเมนู: ${shown}${more > 0 ? ` และอีก ${more} เมนู` : ""}`;
}

// ── "ถุงหิ้ว" (shop settings, owner only) ─────────────────────────────────────────────────────────────

export type BagSettings = { bagMaterialId: string | null; bagsPerCups: number | null };

export const BAG_LIST_LOAD_ERROR = "โหลดรายการวัตถุดิบไม่สำเร็จ ลองรีเฟรชหน้า";

/**
 * What the "ถุงหิ้ว" section may show. The form needs both the shop's saved bag setting and the list of
 * counted materials: with either read failed it would start at "ไม่นับถุง" (or call a valid bag material
 * "ปิดใช้แล้ว"), and saving would clear a good setting. So a failed read shows only the error, no form.
 */
export function bagFormLoad<M extends { id: string }>(
  tenant: { failed: boolean; bagMaterialId: string | null; bagsPerCups: number | null },
  list: { failed: boolean; materials: M[] | null }
): { error: string } | { materials: M[]; defaults: BagSettings & { listed: boolean } } {
  if (tenant.failed || list.failed) return { error: BAG_LIST_LOAD_ERROR };
  const materials = list.materials ?? [];
  const listed = tenant.bagMaterialId !== null && materials.some((m) => m.id === tenant.bagMaterialId);
  return { materials, defaults: { bagMaterialId: tenant.bagMaterialId, bagsPerCups: tenant.bagsPerCups, listed } };
}

/**
 * The settings form → tenants.bag_material_id / bags_per_cups. "ไม่ใส่อัตโนมัติ" = null; "1 ถุงต่อทุก N แก้ว"
 * = N (1–20). Without a bag material nothing is counted, so the automatic count is cleared too. Whether the
 * material is this shop's, tracked and not archived is checked by the server action against the database.
 */
export function parseBagSettings(input: { materialId: unknown; mode: unknown; perCups: unknown }):
  { value: BagSettings } | { error: string } {
  const { materialId, mode, perCups } = input;
  if (typeof materialId !== "string" || (materialId !== "" && !isId(materialId))) return { error: BAD_INPUT };
  if (mode !== "none" && mode !== "per_cups") return { error: BAD_INPUT };
  if (materialId === "") return { value: { bagMaterialId: null, bagsPerCups: null } };
  if (mode === "none") return { value: { bagMaterialId: materialId, bagsPerCups: null } };
  const text = typeof perCups === "string" ? perCups.trim() : "";
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!(n >= 1 && n <= MAX_BAGS_PER_CUPS)) return { error: BAGS_PER_CUPS };
  return { value: { bagMaterialId: materialId, bagsPerCups: n } };
}
