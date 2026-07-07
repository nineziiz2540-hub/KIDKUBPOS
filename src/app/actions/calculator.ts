"use server";

import { getProfile } from "@/lib/dal";
import { getProductCost } from "@/lib/dal";
import type { ProductCost } from "@/lib/dal";

export async function fetchProductCost(productId: string): Promise<ProductCost> {
  const profile = await getProfile();
  if (!profile) return { productId, ingredientCost: 0, recipes: [] };
  return getProductCost(profile.tenant_id, productId);
}
