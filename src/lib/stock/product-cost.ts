// Cost of one cup at CURRENT material prices, for the pricing calculator (round D1). Pure; no I/O.
import type { ProductCost } from "../../types/app.ts";
import type { StockLine } from "./stock-core.ts";

export type MaterialCost = { name: string; unit: string; costPerUnit: number };

/**
 * Prices a resolved cup (fixed rows + chosen bean/matcha/sweetener slots) at current cost per unit.
 * A material with no usable cost (0, negative, not finite) or one that cannot be found is reported in
 * `missingMaterials` instead of silently looking free.
 */
export function buildProductCost(
  productId: string,
  stock: StockLine[],
  materials: Map<string, MaterialCost>
): ProductCost {
  const recipes: ProductCost["recipes"] = [];
  const missingMaterials: string[] = [];
  let ingredientCost = 0;
  for (const line of stock) {
    const mat = materials.get(line.materialId);
    if (!mat) {
      missingMaterials.push("(วัตถุดิบที่ไม่พบ)");
      continue;
    }
    const usable = Number.isFinite(mat.costPerUnit) && mat.costPerUnit > 0;
    if (!usable) missingMaterials.push(mat.name);
    const costPerUnit = usable ? mat.costPerUnit : 0;
    const lineCost = line.qty * costPerUnit;
    ingredientCost += lineCost;
    recipes.push({ materialName: mat.name, unit: mat.unit, quantityUsed: line.qty, costPerUnit, lineCost });
  }
  return { productId, ingredientCost, recipes, missingMaterials };
}
