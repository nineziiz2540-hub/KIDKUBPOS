"use server";

import { getProfile, getProductCost } from "@/lib/dal";
import type { ProductCost } from "@/lib/dal";

export async function fetchProductCost(productId: string): Promise<ProductCost> {
  const profile = await getProfile();
  if (!profile) return { productId, ingredientCost: 0, recipes: [] };
  try {
    return await getProductCost(profile.tenant_id, productId);
  } catch {
    return { productId, ingredientCost: 0, recipes: [] };
  }
}
