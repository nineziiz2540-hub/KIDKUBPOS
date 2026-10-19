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

export function parseProductInput(formData: FormData): { value: ProductInput } | { error: string } {
  const name = text(formData, "name").trim();
  if (name.length < 1 || name.length > MAX_PRODUCT_NAME) {
    return { error: "ชื่อสินค้าต้องมี 1–100 ตัวอักษร" };
  }

  const priceRaw = text(formData, "price").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(priceRaw)) return { error: PRICE_ERROR };
  const price = Number(priceRaw);
  if (price > MAX_PRODUCT_PRICE) return { error: PRICE_ERROR };

  const descriptionRaw = text(formData, "description").trim();
  if (descriptionRaw.length > MAX_PRODUCT_DESCRIPTION) {
    return { error: "รายละเอียดต้องไม่เกิน 500 ตัวอักษร" };
  }

  const drinkRaw = text(formData, "drink_type");
  if (drinkRaw !== "" && !(DRINK_TYPES as readonly string[]).includes(drinkRaw)) {
    return { error: "ประเภทเครื่องดื่มไม่ถูกต้อง" };
  }

  const categoryRaw = text(formData, "category_id");

  return {
    value: {
      name,
      price,
      description: descriptionRaw === "" ? null : descriptionRaw,
      categoryId: categoryRaw === "" ? null : categoryRaw,
      drinkType: drinkRaw === "" ? null : (drinkRaw as DrinkType),
      isActive: text(formData, "is_active") === "on",
    },
  };
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
