// Pure helpers for the owner's group + sweetness setup pages (round D1, Task 11). No I/O.
import { validateSweetnessAmount, type GroupKind } from "./config-validate.ts";

export const SEED_GROUPS: { kind: "bean" | "matcha" | "sweetener"; name: string }[] = [
  { kind: "bean", name: "เมล็ด" },
  { kind: "matcha", name: "มัทฉะ" },
  { kind: "sweetener", name: "ความหวาน" },
];
export const SEED_LEVELS: { name: string; isNone: boolean; isDefault: boolean }[] = [
  { name: "ไม่หวาน", isNone: true, isDefault: false },
  { name: "หวานน้อย", isNone: false, isDefault: false },
  { name: "หวานปกติ", isNone: false, isDefault: true },
  { name: "หวานมาก", isNone: false, isDefault: false },
];

const norm = (s: string) => s.trim().toLowerCase();

/** Groups still to create. A kind that already has a group is never created again (idempotent). */
export function missingSeedGroups(
  existing: { kind: string; sort_order: number }[]
): { kind: "bean" | "matcha" | "sweetener"; name: string; sortOrder: number }[] {
  const have = new Set(existing.map((g) => g.kind));
  let next = existing.reduce((mx, g) => Math.max(mx, g.sort_order), -1) + 1;
  return SEED_GROUPS.filter((g) => !have.has(g.kind)).map((g) => ({ ...g, sortOrder: next++ }));
}

/** Levels still to create, by name. Never adds a second ไม่หวาน or a second default. */
export function missingSeedLevels(
  existing: { name: string; is_none: boolean; is_default: boolean; sort_order: number }[]
): { name: string; isNone: boolean; isDefault: boolean; sortOrder: number }[] {
  const names = new Set(existing.map((l) => norm(l.name)));
  const hasNone = existing.some((l) => l.is_none);
  const hasDefault = existing.some((l) => l.is_default);
  let next = existing.reduce((mx, l) => Math.max(mx, l.sort_order), -1) + 1;
  return SEED_LEVELS.filter((l) => !names.has(norm(l.name)) && !(l.isNone && hasNone)).map((l) => ({
    name: l.name,
    isNone: l.isNone,
    isDefault: l.isDefault && !hasDefault,
    sortOrder: next++,
  }));
}

/** Two-step default switch: clear the old default(s) first (the partial unique index allows only one). */
export function planDefaultSwitch(
  items: { id: string; isDefault: boolean }[],
  newId: string
): { clearIds: string[]; setId: string | null } | null {
  const target = items.find((i) => i.id === newId);
  if (!target) return null;
  const clearIds = items.filter((i) => i.isDefault && i.id !== newId).map((i) => i.id);
  return { clearIds, setId: target.isDefault && clearIds.length === 0 ? null : newId };
}

/** New order after moving `id` one step up (-1) or down (+1); unchanged at the edges. */
export function moveId(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  out[i] = ids[j]!;
  out[j] = ids[i]!;
  return out;
}

export function tierWord(kind: GroupKind, tier: "house" | "special"): string {
  if (kind === "matcha") return tier === "house" ? "มัทฉะร้าน" : "มัทฉะพิเศษ";
  return tier === "house" ? "เมล็ดร้าน" : "เมล็ดพิเศษ";
}

/** One grid cell as typed: digits with up to 3 decimals, 0..10,000. */
export function parseAmountText(text: string): { value: number } | { error: string } {
  const t = text.trim();
  if (t === "") return { error: "ใส่ปริมาณให้ครบทุกช่อง" };
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return { error: "ปริมาณใส่เป็นตัวเลข ทศนิยมไม่เกิน 3 ตำแหน่ง" };
  const value = Number(t);
  const bad = validateSweetnessAmount(value);
  return bad ? { error: bad } : { value };
}

export const gridKey = (memberId: string, levelId: string) => `${memberId}:${levelId}`;

type GridMember = { id: string };
type GridLevel = { id: string; isNone: boolean };

/** Saved rows → editable grid text. The ไม่หวาน column is always "0"; a cell with no saved row is blank. */
export function buildGrid(
  members: GridMember[],
  levels: GridLevel[],
  rows: { member_id: string; level_id: string; amount: number }[]
): Record<string, string> {
  const saved = new Map(rows.map((r) => [gridKey(r.member_id, r.level_id), r.amount]));
  const grid: Record<string, string> = {};
  for (const m of members) {
    for (const l of levels) {
      const k = gridKey(m.id, l.id);
      if (l.isNone) grid[k] = "0";
      else grid[k] = saved.has(k) ? String(saved.get(k)) : "";
    }
  }
  return grid;
}

/** Grid text → rows to write. Stops at the first bad or blank cell; the ไม่หวาน column is forced to 0. */
export function gridToCells(
  members: GridMember[],
  levels: GridLevel[],
  grid: Record<string, string>
): { cells: { memberId: string; levelId: string; amount: number }[] } | { error: string } {
  const cells: { memberId: string; levelId: string; amount: number }[] = [];
  for (const m of members) {
    for (const l of levels) {
      if (l.isNone) {
        cells.push({ memberId: m.id, levelId: l.id, amount: 0 });
        continue;
      }
      const r = parseAmountText(grid[gridKey(m.id, l.id)] ?? "");
      if ("error" in r) return { error: r.error };
      cells.push({ memberId: m.id, levelId: l.id, amount: r.value });
    }
  }
  return { cells };
}
