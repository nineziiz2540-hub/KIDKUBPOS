// Validation for product forms. Pure (no imports) so it runs in plain Node tests.
// The same limits are enforced by DB CHECKs (migration 20261019120000).

export const MAX_PRODUCT_PRICE = 100000;
/** Prices at or above this need a second tap in the form ("8500 instead of 85"). */
export const HIGH_PRICE_CONFIRM = 1000;
export const MAX_PRODUCT_NAME = 100;
export const MAX_PRODUCT_DESCRIPTION = 500;
export const MAX_RECIPE_QTY = 100000;
export const MAX_RECIPE_ROWS = 50;

const DRINK_TYPES = ["hot", "iced", "blended", "special"] as const;
export type DrinkType = (typeof DRINK_TYPES)[number];

export type ProductInput = {
  name: string;
  price: number;
  description: string | null;
  categoryId: string | null;
  drinkType: DrinkType | null;
  isActive: boolean;
};

const PRICE_ERROR = "ราคาต้องอยู่ระหว่าง 0–100,000 บาท และมีทศนิยมไม่เกิน 2 ตำแหน่ง";

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

export type RawMenuFields = {
  name: string;
  price: string;
  description: string;
  categoryId: string;
  drinkType: string;
  isActive: boolean;
};

/** The single place the menu field rules live; both the form parser and the editor draft (menu-draft.ts) use it. */
export function validateMenuFields(raw: RawMenuFields): { value: ProductInput } | { error: string } {
  const name = raw.name.trim();
  if (name.length < 1 || name.length > MAX_PRODUCT_NAME) {
    return { error: "ชื่อเมนูต้องมี 1–100 ตัวอักษร" };
  }

  const priceRaw = raw.price.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(priceRaw)) return { error: PRICE_ERROR };
  const price = Number(priceRaw);
  if (price > MAX_PRODUCT_PRICE) return { error: PRICE_ERROR };

  const description = raw.description.trim();
  if (description.length > MAX_PRODUCT_DESCRIPTION) {
    return { error: "รายละเอียดต้องไม่เกิน 500 ตัวอักษร" };
  }

  if (raw.drinkType !== "" && !(DRINK_TYPES as readonly string[]).includes(raw.drinkType)) {
    return { error: "ประเภทเครื่องดื่มไม่ถูกต้อง" };
  }

  return {
    value: {
      name,
      price,
      description: description === "" ? null : description,
      categoryId: raw.categoryId === "" ? null : raw.categoryId,
      drinkType: raw.drinkType === "" ? null : (raw.drinkType as DrinkType),
      isActive: raw.isActive,
    },
  };
}

export function parseProductInput(formData: FormData): { value: ProductInput } | { error: string } {
  return validateMenuFields({
    name: text(formData, "name"),
    price: text(formData, "price"),
    description: text(formData, "description"),
    categoryId: text(formData, "category_id"),
    drinkType: text(formData, "drink_type"),
    isActive: text(formData, "is_active") === "on",
  });
}

// The editor's draft (recipe lines, sweetness) and its parser live in menu-draft.ts.

export const MAX_CATEGORY_NAME = 50;

export function parseCategoryName(raw: unknown): { value: string } | { error: string } {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length < 1 || name.length > MAX_CATEGORY_NAME) {
    return { error: "ชื่อหมวดหมู่ต้องมี 1–50 ตัวอักษร" };
  }
  return { value: name };
}
