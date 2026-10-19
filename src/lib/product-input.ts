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
const QTY_ERROR = "ปริมาณวัตถุดิบไม่ถูกต้อง";

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

type RawMenuFields = {
  name: string;
  price: string;
  description: string;
  categoryId: string;
  drinkType: string;
  isActive: boolean;
};

/** The single place the menu field rules live; both the form parser and the editor draft use it. */
function validateMenuFields(raw: RawMenuFields): { value: ProductInput } | { error: string } {
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

export type RecipeRowInput = { rawMaterialId: string; quantityUsed: number };

/** Rows with no material or no quantity are blank editor rows and are dropped. */
export function parseRecipeRows(
  rows: { rawMaterialId: string; quantityUsed: string }[]
): { value: RecipeRowInput[] } | { error: string } {
  const filled = rows.filter((r) => r.rawMaterialId !== "" && r.quantityUsed.trim() !== "");
  if (filled.length > MAX_RECIPE_ROWS) return { error: QTY_ERROR };

  const value: RecipeRowInput[] = [];
  for (const row of filled) {
    const raw = row.quantityUsed.trim();
    if (!/^\d+(\.\d{1,3})?$/.test(raw)) return { error: QTY_ERROR };
    const qty = Number(raw);
    if (qty <= 0 || qty > MAX_RECIPE_QTY) return { error: QTY_ERROR };
    value.push({ rawMaterialId: row.rawMaterialId, quantityUsed: qty });
  }
  return { value };
}

/** Everything the one-page menu editor sends in a single save. */
export type MenuDraft = {
  name: string;
  price: string;
  description: string;
  categoryId: string | null;
  drinkType: DrinkType | null;
  isActive: boolean;
  recipes: { rawMaterialId: string; quantityUsed: string }[];
  modifierIds: string[];
};

export function parseMenuDraft(
  d: MenuDraft
): { value: { menu: ProductInput; recipes: RecipeRowInput[]; modifierIds: string[] } } | { error: string } {
  const menu = validateMenuFields({
    name: d.name,
    price: d.price,
    description: d.description,
    categoryId: d.categoryId ?? "",
    drinkType: d.drinkType ?? "",
    isActive: d.isActive,
  });
  if ("error" in menu) return menu;

  const recipes = parseRecipeRows(d.recipes);
  if ("error" in recipes) return recipes;

  return {
    value: { menu: menu.value, recipes: recipes.value, modifierIds: [...new Set(d.modifierIds)] },
  };
}

export const MAX_CATEGORY_NAME = 50;

export function parseCategoryName(raw: unknown): { value: string } | { error: string } {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length < 1 || name.length > MAX_CATEGORY_NAME) {
    return { error: "ชื่อหมวดหมู่ต้องมี 1–50 ตัวอักษร" };
  }
  return { value: name };
}
