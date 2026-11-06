import type { CartItem } from "../../types/app.ts";

// The cart in progress, as saved on the device so a reload brings it back (spec call 16).
// Pure: no React, no browser globals. The manager PIN is never part of it.

export type CartDraft = {
  v: 1;
  tenantId: string;
  sellerId: string;
  savedAt: number;
  items: CartItem[];
  orderType: "dine_in" | "take_away";
  paymentMethod: "cash" | "transfer";
  customer: { id: string; phone: string | null } | null;
  activeHeld: {
    id: string;
    version: number;
    queueNumber: number;
    customerLabel: string | null;
  } | null;
  discount: { type: "percent" | "amount"; value: string; reason: string } | null;
  /**
   * The client_ref of this cart's online payment attempt, if one was started (it may have been
   * saved with its answer lost). After a reload the POS reuses exactly this ref and no other, so
   * the restored cart can only ever replay its own bill. Absent when no payment was tried.
   */
  attemptRef?: string;
};

/** What the screen hands over; the draft keeps exactly the listed fields of it. */
export type DraftState = Omit<CartDraft, "v" | "tenantId" | "sellerId">;

type Ids = { tenantId: string; sellerId: string };

/** A draft older than this is not brought back (a different day's cart). */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Only CartItem's known fields: unknown keys inside an item are dropped too. */
function cleanItem(i: CartItem): CartItem {
  return {
    cartItemKey: i.cartItemKey,
    productId: i.productId,
    name: i.name,
    basePrice: i.basePrice,
    quantity: i.quantity,
    selectedModifiers: i.selectedModifiers.map((m) => ({
      modifierId: m.modifierId,
      modifierName: m.modifierName,
      optionId: m.optionId,
      optionName: m.optionName,
      priceDelta: m.priceDelta,
    })),
    totalPrice: i.totalPrice,
    note: i.note,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (x: unknown): x is string => typeof x === "string" && UUID_RE.test(x);

export function draftKey(ids: Ids): string {
  return `cart:${ids.tenantId}:${ids.sellerId}`;
}

export function toDraft(state: DraftState, ids: Ids): CartDraft | null {
  if (state.items.length === 0 && state.activeHeld === null) return null;
  return {
    v: 1,
    tenantId: ids.tenantId,
    sellerId: ids.sellerId,
    savedAt: state.savedAt,
    items: state.items.map(cleanItem),
    orderType: state.orderType,
    paymentMethod: state.paymentMethod,
    customer: state.customer ? { id: state.customer.id, phone: state.customer.phone } : null,
    activeHeld: state.activeHeld
      ? {
          id: state.activeHeld.id,
          version: state.activeHeld.version,
          queueNumber: state.activeHeld.queueNumber,
          customerLabel: state.activeHeld.customerLabel,
        }
      : null,
    discount: state.discount
      ? {
          type: state.discount.type,
          value: state.discount.value,
          reason: state.discount.reason,
        }
      : null,
    ...(isUuid(state.attemptRef) ? { attemptRef: state.attemptRef } : {}),
  };
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function validItem(x: unknown): x is CartItem {
  if (!isObj(x)) return false;
  if (!isStr(x.cartItemKey) || !isStr(x.productId) || !isStr(x.name)) return false;
  if (!isNum(x.basePrice) || !isNum(x.quantity) || !isNum(x.totalPrice)) return false;
  if (!(x.note === null || isStr(x.note))) return false;
  if (!Array.isArray(x.selectedModifiers)) return false;
  return x.selectedModifiers.every(
    (m) =>
      isObj(m) &&
      isStr(m.modifierId) &&
      isStr(m.modifierName) &&
      isStr(m.optionId) &&
      isStr(m.optionName) &&
      isNum(m.priceDelta)
  );
}

/** The saved draft if it is this seller's, current-version and well formed; otherwise null. */
export function restorable(d: unknown, ids: Ids, now?: number): CartDraft | null {
  if (!isObj(d) || d.v !== 1) return null;
  if (d.tenantId !== ids.tenantId || d.sellerId !== ids.sellerId) return null;
  if (!isNum(d.savedAt)) return null;
  if (now !== undefined && now - d.savedAt > DRAFT_MAX_AGE_MS) return null;
  if (!Array.isArray(d.items) || !d.items.every(validItem)) return null;
  if (d.orderType !== "dine_in" && d.orderType !== "take_away") return null;
  if (d.paymentMethod !== "cash" && d.paymentMethod !== "transfer") return null;

  let customer: CartDraft["customer"] = null;
  if (d.customer !== null) {
    const c = d.customer;
    if (!isObj(c) || !isStr(c.id) || !(c.phone === null || isStr(c.phone))) return null;
    customer = { id: c.id, phone: c.phone };
  }

  let activeHeld: CartDraft["activeHeld"] = null;
  if (d.activeHeld !== null) {
    const h = d.activeHeld;
    if (
      !isObj(h) ||
      !isStr(h.id) ||
      !isNum(h.version) ||
      !isNum(h.queueNumber) ||
      !(h.customerLabel === null || isStr(h.customerLabel))
    ) {
      return null;
    }
    activeHeld = {
      id: h.id,
      version: h.version,
      queueNumber: h.queueNumber,
      customerLabel: h.customerLabel,
    };
  }

  let discount: CartDraft["discount"] = null;
  if (d.discount !== null) {
    const x = d.discount;
    if (
      !isObj(x) ||
      (x.type !== "percent" && x.type !== "amount") ||
      !isStr(x.value) ||
      !isStr(x.reason)
    ) {
      return null;
    }
    discount = { type: x.type, value: x.value, reason: x.reason };
  }

  const draft: CartDraft = {
    v: 1,
    tenantId: ids.tenantId,
    sellerId: ids.sellerId,
    savedAt: d.savedAt,
    items: d.items.map(cleanItem),
    orderType: d.orderType,
    paymentMethod: d.paymentMethod,
    customer,
    activeHeld,
    discount,
    // A malformed ref is dropped (the cart still comes back, it just adopts nothing).
    ...(isUuid(d.attemptRef) ? { attemptRef: d.attemptRef } : {}),
  };
  // An empty cart with no held bill is not worth bringing back.
  if (draft.items.length === 0 && draft.activeHeld === null) return null;
  return draft;
}
