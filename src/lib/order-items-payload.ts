// The p_items array createOrder hands to order_record (round D1). Pure, so it can be unit-tested.
import type { PricedLine } from "./order-pricing-core.ts";

export function orderItemsPayload(lines: PricedLine[]) {
  return lines.map((line) => ({
    product_id: line.productId,
    product_name: line.productName,
    unit_price: line.unitPrice,
    quantity: line.quantity,
    subtotal: line.lineTotal,
    category_name: line.categoryName,
    modifiers_snapshot: line.modifiersSnapshot,
    note: line.note,
    stock: line.stock.map((s) => ({ material_id: s.materialId, qty: s.qty })),
    choices: line.choicesSnapshot,
  }));
}
