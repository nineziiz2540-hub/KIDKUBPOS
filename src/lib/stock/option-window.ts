// The POS option window's rules (round D1). Pure — no React/Next.js/Supabase imports — so the node
// test runner covers them: which rows a menu shows, how the cashier's taps move the picks, and the
// cart line they become. Picks are always settled against the catalog with stock-core's own default
// chain (the server's rules), so the cup on screen, the cart price and the stock recorded agree.
import type { CartChoices, CartItem, ModifierWithOptions, PosProduct, SelectedModifier } from "../../types/app.ts";
import { formatPrice } from "../cash.ts";
import { lineTotal } from "../cart-math.ts";
import { defaultChoices, isDefaultChoice } from "./pos-choices.ts";
import {
  defaultLevel, defaultSlotMember, slotAdds, slotCount,
  type ChoiceGroup, type ChoiceSnapshot, type GroupMember, type SlotForAdds, type StockCatalog,
} from "./stock-core.ts";

export type Chip = { id: string; label: string; priceDelta: number };

/** One bean/matcha choice: the house row and the special row share a single pick. */
export type SlotRows = {
  groupId: string;
  houseTitle: string;
  specialTitle: string;
  /** the sub-row under the extra-shot option on a special cup, e.g. "ช็อตเพิ่มใช้เมล็ดร้าน" */
  shotTitle: string;
  house: Chip[];
  /** empty when the menu does not offer specials (or the group has none) */
  special: Chip[];
};

export type SweetnessRows = {
  levels: { id: string; name: string; isNone: boolean }[];
  /** "หวานด้วย": the menu's sweetener plus the ones it may change to; empty = the row is not shown */
  sweeteners: Chip[];
};

export type OptionRows = { slots: SlotRows[]; sweetness: SweetnessRows | null };

/** What the cashier has picked so far. Records, not Maps: it is React state. */
export type WindowState = {
  /** groupId → the chosen member (house or special: one pick per group) */
  slots: Record<string, string>;
  /** groupId → 2 while the chosen special is doubled (×2); absent = ×1. Never set for a house member. */
  counts: Record<string, 2>;
  /**
   * groupId → the house member picked for the extra shot on a special cup. Kept (not shown) while the
   * shot option is unticked, so ticking it again keeps the pick.
   */
  shots: Record<string, string>;
  levelId: string | null;
  /** the sweetener picked; kept (not shown) while the level is "ไม่หวาน", so going back needs no re-pick */
  sweetenerId: string | null;
  /** modifierId → chosen option ids */
  options: Record<string, string[]>;
};

type SlotLine = { groupId: string; defaultMemberId: string | null; allowSpecial: boolean };

/** The menu's slot lines with a usable default: one per group, first line wins (as defaultChoices). */
function slotLines(productId: string, catalog: StockCatalog): { line: SlotLine; group: ChoiceGroup; fallback: GroupMember }[] {
  const out: { line: SlotLine; group: ChoiceGroup; fallback: GroupMember }[] = [];
  const seen = new Set<string>();
  for (const line of catalog.recipes.get(productId) ?? []) {
    if (line.kind !== "slot" || seen.has(line.groupId)) continue;
    const group = catalog.groups.get(line.groupId);
    if (!group || group.members.length === 0) continue;
    const fallback = defaultSlotMember(group, line);
    if (!fallback) continue;
    seen.add(line.groupId);
    out.push({ line, group, fallback });
  }
  return out;
}

const chip = (m: GroupMember): Chip => ({ id: m.id, label: m.label, priceDelta: m.priceDelta });

/** Screen words from spec §8.1 (bean / matcha); any other group goes by the name the owner gave it. */
function titles(group: ChoiceGroup): { house: string; special: string; shot: string } {
  if (group.kind === "bean") return { house: "เมล็ดร้าน (ระดับคั่ว)", special: "เมล็ดพิเศษ", shot: "ช็อตเพิ่มใช้เมล็ดร้าน" };
  if (group.kind === "matcha") return { house: "มัทฉะร้าน", special: "มัทฉะพิเศษ", shot: "ช็อตเพิ่มใช้มัทฉะร้าน" };
  return { house: group.name, special: `${group.name} พิเศษ`, shot: `ช็อตเพิ่มใช้${group.name}` };
}

/** The bean/matcha and sweetness rows this menu shows, in screen order. */
export function optionRows(productId: string, catalog: StockCatalog): OptionRows {
  const slots = slotLines(productId, catalog).map(({ line, group }): SlotRows => {
    const t = titles(group);
    return {
      groupId: group.id,
      houseTitle: t.house,
      specialTitle: t.special,
      shotTitle: t.shot,
      house: group.members.filter((m) => m.tier === "house").map(chip),
      special: line.allowSpecial ? group.members.filter((m) => m.tier === "special").map(chip) : [],
    };
  });

  let sweetness: SweetnessRows | null = null;
  const ps = catalog.productSweetness.get(productId);
  if (ps && catalog.levels.length > 0) {
    const members = catalog.groups.get(ps.groupId)?.members ?? [];
    const offered = members.filter((m) => m.id === ps.defaultMemberId || ps.allowedMemberIds.includes(m.id));
    sweetness = {
      levels: catalog.levels.map((l) => ({ id: l.id, name: l.name, isNone: l.isNone })),
      // nothing to change to (spec 6.2.1: no ticks) → no row
      sweeteners: offered.length > 1 ? offered.map(chip) : [],
    };
  }
  return { slots, sweetness };
}

export function hasOptionRows(rows: OptionRows): boolean {
  return rows.slots.length > 0 || rows.sweetness !== null;
}

type Picks = {
  slots: Record<string, string>;
  counts: Record<string, 2>;
  shots: Record<string, string>;
  levelId: string | null;
  sweetenerId: string | null;
};

type CartSlot = CartChoices["slots"][number];

/**
 * Picks → CartChoices: each pick is kept when the catalog still offers it on this menu, otherwise
 * that part is the menu default (resolveLine's chain). A special on a line that forbids specials is
 * dropped here, so the server never has to refuse the line as stale. It uses resolveLine's own
 * helpers, so it records the same thing: ×2 only on the chosen special (slotCount), and an extra shot
 * on a special cup uses a house member written on the slot (slotAdds); a house cup's shot writes nothing.
 */
function settle(productId: string, catalog: StockCatalog, picks: Picks, optionIds: string[]): CartChoices {
  const slots: CartChoices["slots"] = [];
  const byGroup = new Map<string, SlotForAdds & { slot: CartSlot }>();
  for (const { line, group, fallback } of slotLines(productId, catalog)) {
    const picked = group.members.find((m) => m.id === picks.slots[line.groupId]);
    const member = picked && (picked.tier === "house" || line.allowSpecial) ? picked : fallback;
    const slot: CartSlot = { groupId: line.groupId, memberId: member.id, label: member.label, tier: member.tier, priceDelta: member.priceDelta };
    // the server's own rule: ×2 only on the chosen special itself, never on a fallback
    if (slotCount(member, picks.slots[line.groupId], picks.counts[line.groupId]) === 2) slot.count = 2;
    slots.push(slot);
    byGroup.set(line.groupId, { slot, group, line, member, shotPick: picks.shots[line.groupId] });
  }

  // The server's own slot_add pass: same slotAddGroupIds, same shot member and option ids.
  const { slotAddGroupIds, shots } = slotAdds(optionIds, catalog.optionEffects, byGroup);
  for (const [groupId, shot] of shots) {
    byGroup.get(groupId)!.slot.shot = { memberId: shot.member.id, label: shot.member.label, optionIds: shot.optionIds };
  }

  let sweetness: CartChoices["sweetness"] = null;
  const ps = catalog.productSweetness.get(productId);
  if (ps) {
    const level = catalog.levels.find((l) => l.id === picks.levelId) ?? defaultLevel(catalog.levels, ps);
    if (level?.isNone) {
      sweetness = { levelId: level.id, levelName: level.name, memberId: null, memberLabel: null };
    } else if (level) {
      const members = catalog.groups.get(ps.groupId)?.members ?? [];
      const id = picks.sweetenerId;
      const ok = id !== null && (id === ps.defaultMemberId || (ps.allowedMemberIds.includes(id) && members.some((m) => m.id === id)));
      const memberId = ok ? id : ps.defaultMemberId;
      const label = members.find((m) => m.id === memberId)?.label ?? null;
      sweetness = { levelId: level.id, levelName: level.name, memberId, memberLabel: label };
    }
  }
  return { slots, slotAddGroupIds, sweetness };
}

/** The window's picks as the line's choices (optionIds = the chosen modifier options, for slot_add). */
export function choicesFromWindow(productId: string, catalog: StockCatalog, state: WindowState, optionIds: string[]): CartChoices {
  return settle(productId, catalog, state, optionIds);
}

function countsOf(choices: CartChoices): Record<string, 2> {
  return Object.fromEntries(choices.slots.filter((s) => s.count === 2).map((s) => [s.groupId, 2 as const]));
}

function shotsOf(choices: CartChoices): Record<string, string> {
  return Object.fromEntries(choices.slots.flatMap((s) => (s.shot ? [[s.groupId, s.shot.memberId]] : [])));
}

function picksOf(choices: CartChoices): Picks {
  return {
    slots: Object.fromEntries(choices.slots.map((s) => [s.groupId, s.memberId])),
    counts: countsOf(choices),
    shots: shotsOf(choices),
    levelId: choices.sweetness?.levelId ?? null,
    sweetenerId: choices.sweetness?.memberId ?? null,
  };
}

/**
 * A saved line's choices (parked bill, restored draft) rebuilt from today's catalog: labels, tiers
 * and prices from the catalog, never the stored copy; a member/level/sweetener no longer offered →
 * that part falls back to the menu default.
 */
export function refreshChoices(productId: string, catalog: StockCatalog, choices: CartChoices, optionIds: string[]): CartChoices {
  return settle(productId, catalog, picksOf(choices), optionIds);
}

/** Where the window starts: the menu defaults, or (editing) the line's own picks. */
export function initialWindowState(
  productId: string,
  catalog: StockCatalog,
  modifiers: ModifierWithOptions[],
  from?: Pick<CartItem, "selectedModifiers" | "choices">
): WindowState {
  const optionIds = from?.selectedModifiers.map((m) => m.optionId) ?? [];
  const start = from?.choices ? refreshChoices(productId, catalog, from.choices, optionIds) : defaultChoices(productId, catalog);
  const options: Record<string, string[]> = {};
  for (const m of modifiers) {
    const chosen = m.options.filter((o) => optionIds.includes(o.id)).map((o) => o.id);
    if (chosen.length > 0) options[m.id] = m.isMultiSelect ? chosen : chosen.slice(0, 1);
  }
  return {
    slots: Object.fromEntries(start.slots.map((s) => [s.groupId, s.memberId])),
    counts: countsOf(start),
    shots: shotsOf(start),
    levelId: start.sweetness?.levelId ?? null,
    // a ไม่หวาน start remembers the menu's sweetener for when a level is picked
    sweetenerId: start.sweetness?.memberId ?? catalog.productSweetness.get(productId)?.defaultMemberId ?? null,
    options,
  };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const rest = { ...record };
  delete rest[key];
  return rest;
}

/** A tap on a house chip: that member, ×1 (house members never double; a re-tap changes nothing). */
export function pickSlot(state: WindowState, groupId: string, memberId: string): WindowState {
  return { ...state, slots: { ...state.slots, [groupId]: memberId }, counts: withoutKey(state.counts, groupId) };
}

/**
 * A tap on a special chip: another member → that member at ×1; the chosen one at ×1 → ×2 (one more
 * dose and its price again); at ×2 → back to ×1. ×2 is the most.
 */
export function tapSpecial(state: WindowState, groupId: string, memberId: string): WindowState {
  if (state.slots[groupId] !== memberId) {
    return { ...state, slots: { ...state.slots, [groupId]: memberId }, counts: withoutKey(state.counts, groupId) };
  }
  if (state.counts[groupId] === 2) return { ...state, counts: withoutKey(state.counts, groupId) };
  return { ...state, counts: { ...state.counts, [groupId]: 2 } };
}

/** A tap in the "ช็อตเพิ่มใช้…" sub-row: the house member the extra shot uses on a special cup. */
export function pickShot(state: WindowState, groupId: string, memberId: string): WindowState {
  return { ...state, shots: { ...state.shots, [groupId]: memberId } };
}

export function pickLevel(state: WindowState, levelId: string): WindowState {
  return { ...state, levelId };
}

function noneLevelName(state: WindowState, rows: OptionRows): string | null {
  const level = rows.sweetness?.levels.find((l) => l.id === state.levelId);
  return level?.isNone ? level.name : null;
}

/** "หวานด้วย" is locked (shown faded, not hidden) while the level is "ไม่หวาน". */
export function sweetenerLocked(state: WindowState, rows: OptionRows): boolean {
  return noneLevelName(state, rows) !== null;
}

/** The word next to the locked row, e.g. "ไม่หวาน · ไม่ต้องเลือก"; null when the row is usable. */
export function sweetenerHint(state: WindowState, rows: OptionRows): string | null {
  const name = noneLevelName(state, rows);
  return name === null ? null : `${name} · ไม่ต้องเลือก`;
}

export function pickSweetener(state: WindowState, rows: OptionRows, memberId: string): WindowState {
  return sweetenerLocked(state, rows) ? state : { ...state, sweetenerId: memberId };
}

/** The sweetener chip shown as selected (none while locked). */
export function shownSweetener(state: WindowState, rows: OptionRows): string | null {
  return sweetenerLocked(state, rows) ? null : state.sweetenerId;
}

/**
 * A tap on a modifier option: multi-select toggles; single-select switches, and a second tap on the
 * chosen one takes it back unless the group is required (a tap by mistake is undone by tapping again).
 */
export function toggleOption(state: WindowState, modifier: ModifierWithOptions, optionId: string): WindowState {
  const current = state.options[modifier.id] ?? [];
  let next: string[];
  if (modifier.isMultiSelect) {
    next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
  } else if (current.includes(optionId)) {
    next = modifier.isRequired ? current : [];
  } else {
    next = [optionId];
  }
  return { ...state, options: { ...state.options, [modifier.id]: next } };
}

export function missingRequired(state: WindowState, modifiers: ModifierWithOptions[]): ModifierWithOptions[] {
  return modifiers.filter((m) => m.isRequired && (state.options[m.id] ?? []).length === 0);
}

/** Why the add button is off, e.g. "เลือก ร้อน/เย็น ก่อน"; null when nothing is missing. */
export function missingHint(missing: ModifierWithOptions[]): string | null {
  return missing.length === 0 ? null : `เลือก ${missing.map((m) => m.name).join(", ")} ก่อน`;
}

export function modifierHint(modifier: ModifierWithOptions): string | null {
  const words = [modifier.isRequired ? "จำเป็น" : null, modifier.isMultiSelect ? "เลือกได้หลายอย่าง" : null].filter(
    (w): w is string => w !== null
  );
  return words.length === 0 ? null : words.join(" · ");
}

/** "+20" on a chip; null for no price. */
export function priceTag(delta: number): string | null {
  if (delta === 0) return null;
  return delta > 0 ? `+${formatPrice(delta)}` : `−${formatPrice(-delta)}`;
}

function selectedModifiersOf(state: WindowState, modifiers: ModifierWithOptions[]): SelectedModifier[] {
  const out: SelectedModifier[] = [];
  for (const modifier of modifiers) {
    const chosen = state.options[modifier.id] ?? [];
    for (const option of modifier.options) {
      if (!chosen.includes(option.id)) continue;
      out.push({
        modifierId: modifier.id,
        modifierName: modifier.name,
        optionId: option.id,
        optionName: option.name,
        priceDelta: option.priceDelta,
      });
    }
  }
  return out;
}

/**
 * The cart line the window's picks make. A menu without bean/sweetness rows gets no `choices` key at
 * all, exactly like a line from before round D1 (the server then applies its defaults).
 */
export function buildLine(args: {
  product: Pick<PosProduct, "id" | "name" | "price">;
  modifiers: ModifierWithOptions[];
  catalog: StockCatalog;
  state: WindowState;
  note: string;
  quantity: number;
  key: string;
}): CartItem {
  const { product, modifiers, catalog, state, quantity } = args;
  const selectedModifiers = selectedModifiersOf(state, modifiers);
  const choices = hasOptionRows(optionRows(product.id, catalog))
    ? choicesFromWindow(product.id, catalog, state, selectedModifiers.map((m) => m.optionId))
    : undefined;
  const note = args.note.trim();
  const line: CartItem = {
    cartItemKey: args.key,
    productId: product.id,
    name: product.name,
    basePrice: product.price,
    quantity,
    selectedModifiers,
    totalPrice: lineTotal(product.price, selectedModifiers, quantity, choices),
    note: note === "" ? null : note,
  };
  if (choices) line.choices = choices;
  return line;
}

/** The footer button: "เพิ่มลงตะกร้า · ฿85" (one cup), or "บันทึก · ฿170" when editing (the whole line). */
export function footerText(mode: "add" | "edit", line: CartItem): string {
  return `${mode === "add" ? "เพิ่มลงตะกร้า" : "บันทึก"} · ฿${formatPrice(line.totalPrice)}`;
}

export type LinePart = { text: string; changed: boolean };

/**
 * A bean/matcha word: a special shows its price too ("เคนยา (+20)", spec §7.1), and "×2" when doubled
 * ("เคนยา (+20) ×2"); a house pick is just its label.
 */
type WordSlot = { label: string; tier: "house" | "special"; count?: number };

/** " ×2" after a doubled special's word. */
function withCount(word: string, s: WordSlot): string {
  return s.tier === "special" && s.count === 2 ? `${word} ×2` : word;
}

function slotText(s: WordSlot & { priceDelta: number }): string {
  const tag = s.tier === "special" ? priceTag(s.priceDelta) : null;
  return withCount(tag === null ? s.label : `${s.label} (${tag})`, s);
}

/** A bean/matcha name without its price, as the held-bill audit lists it: "เคนยา", "เคนยา ×2". */
export function slotName(s: WordSlot): string {
  return withCount(s.label, s);
}

/** An option's words: "เพิ่มช็อต (+15)"; a free option is its name alone. */
export function optionText(name: string, priceDelta: number): string {
  const tag = priceTag(priceDelta);
  return tag === null ? name : `${name} (${tag})`;
}

/**
 * An option's name as the cart, bill and held-bill audit read it (no price): an extra shot on a
 * special cup names the house member(s) it uses — every slot whose shot lists the option, in slot
 * order, joined by "/": "เพิ่มช็อต คั่วกลาง", "เพิ่มทั้งคู่ คั่วกลาง/อุจิ". Any other option is its name.
 */
export function optionName(
  name: string,
  optionId: string | undefined,
  slots: readonly { shot?: { label: string; optionIds: string[] } }[] | undefined
): string {
  if (optionId === undefined) return name;
  const labels = (slots ?? []).flatMap((s) => (s.shot?.optionIds.includes(optionId) ? [s.shot.label] : []));
  return labels.length === 0 ? name : `${name} ${labels.join("/")}`;
}

/** The "ช็อตเพิ่มใช้…" sub-row the window shows right after the modifier row `afterModifierId`. */
export type ShotRow = { groupId: string; title: string; chips: Chip[]; selectedId: string; afterModifierId: string };

/**
 * The extra-shot sub-rows, in slot order: one per slot whose member is special and that has a ticked
 * option adding to it (its settled `shot`). `chips` are the group's house members, `selectedId` the
 * house member the shot uses (the same one the server will deduct), `afterModifierId` the first
 * modifier row holding such an option. Read from the built line (buildLine), so the row always
 * shows what is charged and recorded. A group without house members has nothing to pick: no row.
 */
export function shotRows(rows: OptionRows, line: Pick<CartItem, "choices" | "selectedModifiers">): ShotRow[] {
  const out: ShotRow[] = [];
  for (const slot of line.choices?.slots ?? []) {
    const shot = slot.shot;
    if (!shot) continue;
    const row = rows.slots.find((r) => r.groupId === slot.groupId);
    if (!row || row.house.length === 0) continue;
    const after = line.selectedModifiers.find((m) => shot.optionIds.includes(m.optionId));
    if (!after) continue;
    out.push({ groupId: slot.groupId, title: row.shotTitle, chips: row.house, selectedId: shot.memberId, afterModifierId: after.modifierId });
  }
  return out;
}

/** The words of a saved order line's choice snapshot (bill history, void dialog): same words and order as the cart. */
export function snapshotParts(snapshot: ChoiceSnapshot | null | undefined): string[] {
  if (!snapshot) return [];
  const parts = (snapshot.slots ?? []).map(slotText);
  const sw = snapshot.sweetness;
  if (sw) {
    parts.push(sw.levelName);
    if (sw.memberId !== null && sw.label !== null) parts.push(sw.label);
  }
  return parts;
}

/**
 * A saved order line's detail under its name: choices (bean, level, sweetener) then the chosen options
 * (modifiers_snapshot entries; `optionId` tells which one is the extra shot and gets its house bean).
 * A line from before round D1 (no snapshot) keeps the old look: its options joined by ", ".
 */
export function billLineDetail(
  snapshot: ChoiceSnapshot | null | undefined,
  options: (string | { option: string; priceDelta?: number; optionId?: string })[]
): string | null {
  const slots = snapshot?.slots;
  const words = options.map((o) =>
    typeof o === "string" ? o : optionText(optionName(o.option, o.optionId, slots), o.priceDelta ?? 0)
  );
  if (!snapshot) return words.length === 0 ? null : words.join(", ");
  const all = [...snapshotParts(snapshot), ...words];
  return all.length === 0 ? null : all.join(" · ");
}

/**
 * A cart line's bean/sweetness words; `changed` = not the menu default (shown bold accent).
 * `defaults` null = the page has no stock data, so nothing can be told apart: no word is marked.
 */
export function choiceParts(choices: CartChoices | undefined, defaults: CartChoices | null): LinePart[] {
  if (!choices) return [];
  const differs = (part: Parameters<typeof isDefaultChoice>[1]) => defaults !== null && !isDefaultChoice(defaults, part);
  const parts: LinePart[] = choices.slots.map((s) => ({
    text: slotText(s),
    // a doubled special is never the menu default
    changed: differs({ kind: "slot", groupId: s.groupId, memberId: s.memberId, count: s.count }),
  }));
  const sw = choices.sweetness;
  if (sw) {
    parts.push({ text: sw.levelName, changed: differs({ kind: "level", levelId: sw.levelId }) });
    if (sw.memberId !== null && sw.memberLabel !== null) {
      parts.push({ text: sw.memberLabel, changed: differs({ kind: "sweetener", memberId: sw.memberId }) });
    }
  }
  return parts;
}

/**
 * Everything the barista makes differently for this line, in the order they make it: bean/sweetness
 * words, then every chosen option with its price (the extra shot on a special cup names its house
 * bean: "เพิ่มช็อต คั่วกลาง (+15)"). Options have no default, so a chosen one is always marked (R42).
 */
export function cartLineParts(item: Pick<CartItem, "choices" | "selectedModifiers">, defaults: CartChoices | null): LinePart[] {
  const slots = item.choices?.slots;
  return [
    ...choiceParts(item.choices, defaults),
    ...item.selectedModifiers.map((m) => ({
      text: optionText(optionName(m.optionName, m.optionId, slots), m.priceDelta),
      changed: true,
    })),
  ];
}
