// "ผลต่อสต๊อก" of a modifier option (round D1): what choosing the option adds to the cup's stock.
// Pure; no I/O. Two kinds (spec §6.4):
//   slot_add     "เพิ่มในช่องเมล็ด/มัทฉะ" — +amount in the cup's bean/matcha slot (เพิ่มช็อต = +9 g): the cup's
//                own member on a house cup; on a special cup a house member of that group (the
//                cashier's pick, else the menu's house default), never the special and never its price
//                (stock-core shotMember / slotAdds)
//   material_add "เพิ่มวัตถุดิบ"          — +amount of one fixed material (วิปครีม, ท็อปปิ้ง)
export const MAX_EFFECT_AMOUNT = 100000;
export const MAX_EFFECTS_PER_OPTION = 20;

export type EffectDraft = { kind: "slot_add" | "material_add"; targetId: string; amount: string };
export type EffectInput =
  | { kind: "slot_add"; groupId: string; amount: number }
  | { kind: "material_add"; materialId: string; amount: number };

const AMOUNT_ERROR = `ปริมาณต้องมากกว่า 0 ไม่เกิน ${MAX_EFFECT_AMOUNT.toLocaleString("en-US")} และทศนิยมไม่เกิน 3 ตำแหน่ง`;
const HALF_ROW = "เลือกให้ครบและใส่ปริมาณทุกบรรทัด หรือลบบรรทัดที่ไม่ใช้";
const DUPLICATE = "ผลต่อสต๊อกซ้ำกัน — รวมเป็นบรรทัดเดียว";
const TOO_MANY = `ตั้งผลต่อสต๊อกได้ไม่เกิน ${MAX_EFFECTS_PER_OPTION} บรรทัด`;
const BAD_INPUT = "ข้อมูลไม่ถูกต้อง";

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

function amountOk(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= MAX_EFFECT_AMOUNT && Math.round(n * 1000) / 1000 === n;
}

/** The form's rows → effects to save. A fully blank row is dropped; a half-filled one is an error. */
export function parseEffectDrafts(drafts: EffectDraft[]): { value: EffectInput[] } | { error: string } {
  const value: EffectInput[] = [];
  for (const d of drafts) {
    const amountText = d.amount.trim();
    if (d.targetId === "" && amountText === "") continue;
    if (d.targetId === "" || amountText === "") return { error: HALF_ROW };
    if (!/^\d+(\.\d{1,3})?$/.test(amountText)) return { error: AMOUNT_ERROR };
    const amount = Number(amountText);
    if (!amountOk(amount)) return { error: AMOUNT_ERROR };
    value.push(
      d.kind === "slot_add"
        ? { kind: "slot_add", groupId: d.targetId, amount }
        : { kind: "material_add", materialId: d.targetId, amount }
    );
  }
  const checked = checkEffectInputs(value);
  return "error" in checked ? checked : { value };
}

/**
 * Server-side shape check of what a client sent (never trusted): known kind, an id, an amount in range,
 * no repeated target. Tenant ownership of the ids is checked by the server action against the database.
 */
export function checkEffectInputs(raw: unknown): { value: EffectInput[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: BAD_INPUT };
  if (raw.length > MAX_EFFECTS_PER_OPTION) return { error: TOO_MANY };
  const seen = new Set<string>();
  const value: EffectInput[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== "object") return { error: BAD_INPUT };
    const e = item as Record<string, unknown>;
    if (typeof e.amount !== "number" || !amountOk(e.amount)) return { error: AMOUNT_ERROR };
    let key: string;
    if (e.kind === "slot_add" && isId(e.groupId)) {
      key = `g:${e.groupId}`;
      value.push({ kind: "slot_add", groupId: e.groupId, amount: e.amount });
    } else if (e.kind === "material_add" && isId(e.materialId)) {
      key = `m:${e.materialId}`;
      value.push({ kind: "material_add", materialId: e.materialId, amount: e.amount });
    } else {
      return { error: BAD_INPUT };
    }
    if (seen.has(key)) return { error: DUPLICATE };
    seen.add(key);
  }
  return { value };
}

/** Saved rows → the form's rows. */
export function effectDraftsFromRows(
  rows: { kind: string; group_id: string | null; raw_material_id: string | null; amount: number | string }[]
): EffectDraft[] {
  return rows.flatMap((r): EffectDraft[] => {
    if (r.kind === "slot_add" && r.group_id) return [{ kind: "slot_add", targetId: r.group_id, amount: String(Number(r.amount)) }];
    if (r.kind === "material_add" && r.raw_material_id)
      return [{ kind: "material_add", targetId: r.raw_material_id, amount: String(Number(r.amount)) }];
    return [];
  });
}

/** save_option_effects' p_effects (the tenant is never sent: the database takes it from the session). */
export function effectPayload(effects: EffectInput[]) {
  return effects.map((e) => ({
    kind: e.kind,
    group_id: e.kind === "slot_add" ? e.groupId : null,
    raw_material_id: e.kind === "material_add" ? e.materialId : null,
    amount: e.amount,
  }));
}
