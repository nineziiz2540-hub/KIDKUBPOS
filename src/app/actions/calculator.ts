"use server";

import { getProductCost } from "@/lib/dal";
import type { ProductCost } from "@/lib/dal";

export async function fetchProductCost(productId: string): Promise<ProductCost> {
  return getProductCost(productId);
}
