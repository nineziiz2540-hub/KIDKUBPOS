import type { DiscountType } from "@/lib/discount";

export type SelectedModifier = {
  modifierId: string;
  modifierName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
};

/**
 * What the cashier chose for a line's bean/sweetness (round D1). The ids are picks the server honours
 * after checking them against its catalog (toLineChoices → resolveLine): each slot's memberId, a
 * special's count 2 (only on that same chosen special) and shot.memberId (only when it is a house
 * member of that group); sweetness levelId/memberId. Labels, tier and priceDelta are display and
 * cart maths only: the server re-reads them from the catalog. slotAddGroupIds is a record only.
 */
export type CartChoices = {
  slots: {
    groupId: string; memberId: string; label: string; tier: "house" | "special"; priceDelta: number;
    /** present (= 2) only when a special member is doubled (one more dose and its price again) */
    count?: 2;
    /** present only on a special member with a chosen extra-shot option: the house member the shot uses */
    shot?: { memberId: string; label: string; optionIds: string[] };
  }[];
  /** groups that the line's selected options add to (slot_add effects); a record only, not used for price */
  slotAddGroupIds: string[];
  sweetness: { levelId: string; levelName: string; memberId: string | null; memberLabel: string | null } | null;
};

export type CartItem = {
  cartItemKey: string;
  productId: string;
  name: string;
  basePrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  totalPrice: number; // (basePrice + sum(priceDelta)) * quantity
  note: string | null; // per-cup note, see src/lib/notes.ts
  /** Absent on carts and offline outbox entries saved before round D1. */
  choices?: CartChoices;
};

export type CreateOrderInput = {
  items: CartItem[];
  paymentMethod: "cash" | "transfer";
  orderType: "dine_in" | "take_away";
  customerId?: string;
  note?: string;
  discountType?: DiscountType;
  discountValue?: number;
  discountReason?: string;
  approverPin?: string;
  /** Required for cash orders, must be omitted for transfer. */
  cashReceived?: number;
  /** Set when paying a parked bill; version must match what the cashier loaded. */
  heldBillId?: string;
  heldBillVersion?: number;
  /** Id of this payment attempt, kept across retries; the same id never records a second bill. */
  clientRef: string;
  /** Set when the bill was sold in device-numbered mode and is sent later by the outbox. */
  offline?: OfflineSale;
  /**
   * "Record as charged" from the manager's review list (offline bills only): the device's prices
   * are kept and an owner/manager PIN approves it. The PIN is sent once and never stored.
   */
  override?: { approverPin: string; reason: string };
};

/** What the device recorded at the moment of an offline sale. */
export type OfflineSale = {
  tenantId: string;
  sellerId: string;
  soldAt: string /* ISO */;
  queueNumber: number;
  shiftId: string | null;
};

/** A recorded bill as createOrder / checkOrderSaved return it. */
export type SavedOrder = {
  orderId: string;
  orderNumber: string;
  queueNumber: number;
  cashReceived: number | null;
  changeAmount: number | null;
};

export type ProductCost = {
  productId: string;
  ingredientCost: number;
  recipes: {
    materialName: string;
    unit: string;
    quantityUsed: number;
    costPerUnit: number;
    lineCost: number;
  }[];
  /** materials in the cup with no usable cost (0 / unknown) — the total is then understated */
  missingMaterials?: string[];
  /** the menu's recipe could not be resolved (e.g. a chosen member was removed) */
  unresolved?: boolean;
};

export type LowStockAlert = {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  minStockAlert: number;
};

export type ModifierWithOptions = {
  id: string;
  name: string;
  isRequired: boolean;
  isMultiSelect: boolean;
  sortOrder: number;
  options: {
    id: string;
    name: string;
    priceDelta: number;
    sortOrder: number;
  }[];
};

// --- POS display types ---

export type PosProduct = {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  drink_type: "hot" | "iced" | "blended" | "special" | null;
  category_id: string | null;
  categoryName: string | null;
};

export type PosCategory = {
  id: string;
  name: string;
};
